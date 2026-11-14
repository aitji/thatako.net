import CSS from './page.css'
import CLIENT from './page.client.js'
const GB = 1024 ** 3
const DAY = 86_400_000
export const CHUNK = 32 * 1024 * 1024

const cfg = env => ({
	perUpload: +(env.MAX_UPLOAD_GB ?? 4) * GB,
	perKey: +(env.MAX_KEY_GB ?? 5) * GB,
	total: +(env.MAX_TOTAL_GB ?? 9) * GB,
	maxFiles: +(env.MAX_FILES ?? 20),
	maxDays: +(env.MAX_DAYS ?? 90),
})

// helpers
const enc = new TextEncoder()
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const ALPH = 'abcdefghijkmnpqrstuvwxyz23456789'
const rand = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => ALPH[b % 32]).join('')
const cleanName = n => String(n || 'file').replace(/[\u0000-\u001f\u007f\\/:*?"<>|]+/g, '_').trim().slice(0, 200) || 'file'
const rkey = (fid, i) => `u/${fid}/${i}`

const NAMES_MAX = 20
const nameList = files => files.slice(0, NAMES_MAX).map(f => f.name)

// signed token
const mac = async (env, d) => b64u(await crypto.subtle.sign('HMAC',
	await crypto.subtle.importKey('raw', enc.encode(env.UPLOAD_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
	enc.encode(d)))
const sign = async (env, p) => { const d = b64u(enc.encode(JSON.stringify(p))); return d + '.' + await mac(env, d) }
const verify = async (env, t) => {
	const [d, s] = String(t || '').split('.')
	if (!d || !s || s !== await mac(env, d)) return null
	try {
		const bin = atob(d.replace(/-/g, '+').replace(/_/g, '/'))
		const p = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))))
		return p.x > Date.now() ? p : null
	} catch { return null }
}

// usage quota
let cache = { at: 0, bytes: 0, count: 0 }
export async function usage(env, force = false) {
	if (!force && Date.now() - cache.at < 60_000) return cache
	let bytes = 0, count = 0, cursor
	do {
		const l = await env.FILES.list({ prefix: 'u/', cursor })
		for (const o of l.objects) { bytes += o.size; count++ }
		cursor = l.truncated ? l.cursor : undefined
	} while (cursor)
	return cache = { at: Date.now(), bytes, count }
}

async function keyUsage(env, key, h) {
	let sum = 0
	for (const s of await h.getUserList(env.LINKS, key)) {
		const d = await env.LINKS.get('l:' + s, 'json')
		if (d?.type === 'file' && d.exp > Date.now()) sum += d.total
	}
	return sum
}

const metaCache = new Map()
const META_TTL = 10_000

async function getMeta(env, fid, fresh = false) {
	const c = metaCache.get(fid)
	if (!fresh && c && Date.now() - c.at < META_TTL) return c.m
	const m = await env.LINKS.get('f:' + fid, 'json')
	if (metaCache.size > 500) metaCache.clear()
	metaCache.set(fid, { m, at: Date.now() })
	return m
}

const normMeta = m => {
	const files = (m.files || []).map((f, i) => ({ ...f, i: f?.i ?? i }))
	return { ...m, files, next: Math.max(+m.next || 0, ...files.map(f => f.i + 1)) }
}

async function putMeta(env, data, m) {
	const total = m.files.reduce((a, f) => a + (+f.size || 0), 0)
	const meta = { files: m.files, total, exp: data.type === 'file' ? m.exp : 0, next: m.next }
	await env.LINKS.put('f:' + data.fid, JSON.stringify(meta), data.type === 'file' ? { expiration: Math.floor((meta.exp + 7 * DAY) / 1000) } : undefined)
	metaCache.set(data.fid, { m: meta, at: Date.now() })
	return meta
}

// meta link
async function saveLink(env, slug, data, m) {
	const meta = await putMeta(env, data, m)
	await env.LINKS.put('l:' + slug, JSON.stringify({ ...data, count: m.files.length, total: meta.total, exp: meta.exp, names: nameList(m.files) }))
	cache.at = 0
	return meta
}

async function own(env, h, key, rawSlug) {
	const slug = h.norm(String(rawSlug || ''))
	if (!key || !slug) return null
	const data = await env.LINKS.get('l:' + slug, 'json')
	if (!data || data.key !== key || (data.type !== 'file' && data.type !== 'drive')) return null
	return { slug, data }
}

async function live(env, data) {
	const raw = await getMeta(env, data.fid, true)
	if (!raw) return { msg: 'expired' }
	const m = normMeta(raw)
	if (data.type === 'file' && !(m.exp > Date.now())) return { msg: 'expired' }
	return { m }
}

export async function purge(env, fid) {
	let cursor
	do {
		const l = await env.FILES.list({ prefix: `u/${fid}/`, cursor })
		if (l.objects.length) await env.FILES.delete(l.objects.map(o => o.key))
		cursor = l.truncated ? l.cursor : undefined
	} while (cursor)
	cache.at = 0
}

// cron job
export async function sweepExpired(env) {
	const dead = []
	let cursor
	do {
		const l = await env.FILES.list({ prefix: 'u/', cursor, include: ['customMetadata'] })
		for (const o of l.objects) {
			const e = +o.customMetadata?.exp
			if (e ? e < Date.now() : o.uploaded.getTime() < Date.now() - (cfg(env).maxDays + 10) * DAY) dead.push(o.key)
		}
		cursor = l.truncated ? l.cursor : undefined
	} while (cursor)
	for (let i = 0; i < dead.length; i += 1000) await env.FILES.delete(dead.slice(i, i + 1000))
	cache.at = 0
	return dead.length
}

// apis
export async function handleFile(req, env, path, h) {
	try {
		if (path === 'api/usage') return await getUsage(req, env, h)
		if (path.startsWith('api/dl/')) return await download(req, env, path)
		if (req.method === 'POST' && path === 'api/file/init') return await init(req, env, h)
		if (req.method === 'PUT' && path === 'api/file/chunk') return await chunk(req, env, h)
		if (req.method === 'POST' && path === 'api/file/done') return await done(req, env, h)
		if (req.method === 'POST' && path === 'api/file/abort') return await abort(req, env, h)
		if (req.method === 'POST' && path === 'api/file/drive') return await driveLink(req, env, h)
		if (req.method === 'POST' && path === 'api/file/info') return await info(req, env, h)
		if (req.method === 'POST' && path === 'api/file/rename') return await rename(req, env, h)
		if (req.method === 'POST' && path === 'api/file/remove') return await remove(req, env, h)
		if (req.method === 'POST' && path === 'api/file/add-init') return await addInit(req, env, h)
		if (req.method === 'POST' && path === 'api/file/add-done') return await addDone(req, env, h)
		if (req.method === 'POST' && path === 'api/file/drive-add') return await driveAdd(req, env, h)
	} catch (e) {
		console.error('[files]', path, e?.message)
		return h.j({ ok: false, msg: 'upload failed' })
	}
	return new Response('bad', { status: 400 })
}

async function getUsage(req, env, h) {
	const c = cfg(env), key = new URL(req.url).searchParams.get('key')
	const [u, mine] = await Promise.all([usage(env), key ? keyUsage(env, key, h) : 0])
	return h.j({ used: u.bytes, files: u.count, mine, limit: c.total, perUpload: c.perUpload, perKey: c.perKey, maxFiles: c.maxFiles, maxDays: c.maxDays, chunk: CHUNK, driveClientId: env.GOOGLE_CLIENT_ID || '' })
}

async function init(req, env, h) {
	const { key, slug: raw, files, days } = await req.json()
	const c = cfg(env)
	if (!key) return h.j({ ok: false, msg: 'missing key' })
	if (!Array.isArray(files) || !files.length || files.length > c.maxFiles) return h.j({ ok: false, msg: 'bad files' })

	const sizes = files.map(f => Math.floor(+f.size))
	if (sizes.some(s => !(s > 0))) return h.j({ ok: false, msg: 'bad files' })
	const total = sizes.reduce((a, b) => a + b, 0)
	if (total > c.perUpload) return h.j({ ok: false, msg: 'too big' })

	const [u, mine] = await Promise.all([usage(env), keyUsage(env, key, h)])
	if (u.bytes + total > c.total) return h.j({ ok: false, msg: 'storage full' })
	if (mine + total > c.perKey) return h.j({ ok: false, msg: 'key quota' })

	const slug = raw ? h.norm(raw) : rand(6)
	if (!h.validSlug(slug)) return h.j({ ok: false, msg: 'bad slug' })
	if (await env.LINKS.get('l:' + slug)) return h.j({ ok: false, msg: 'duplicate' })

	const exp = Date.now() + Math.min(Math.max(Math.floor(+days) || 30, 1), c.maxDays) * DAY
	const fid = rand(12)
	const out = await Promise.all(files.map(async (f, i) => {
		const name = cleanName(f.name)
		const mp = await env.FILES.createMultipartUpload(rkey(fid, i), {
			customMetadata: { name, exp: String(exp) },
		})
		return { token: await sign(env, { f: fid, i, u: mp.uploadId, s: sizes[i], n: name, e: exp, x: Date.now() + DAY }) }
	}))
	return h.j({ ok: true, slug, exp, chunk: CHUNK, files: out })
}

async function chunk(req, env, h) {
	const q = new URL(req.url).searchParams
	const t = await verify(env, q.get('t'))
	if (!t) return h.j({ ok: false, msg: 'bad token' })

	const n = +q.get('n'), parts = Math.ceil(t.s / CHUNK)
	if (!Number.isInteger(n) || n < 1 || n > parts) return h.j({ ok: false, msg: 'bad part' })

	const want = n < parts ? CHUNK : t.s - CHUNK * (parts - 1)
	if (+req.headers.get('content-length') !== want) return h.j({ ok: false, msg: 'bad size' })

	const p = await env.FILES.resumeMultipartUpload(rkey(t.f, t.i), t.u).uploadPart(n, req.body)
	return h.j({ ok: true, etag: p.etag })
}

async function done(req, env, h) {
	const { key, slug: raw, files } = await req.json()
	const slug = h.norm(raw || '')
	if (!key || !Array.isArray(files) || !files.length) return h.j({ ok: false, msg: 'bad files' })
	if (!h.validSlug(slug)) return h.j({ ok: false, msg: 'bad slug' })

	let fid, exp = 0
	const list = []
	try {
		for (const f of files) {
			const t = await verify(env, f.token)
			if (!t || (fid && t.f !== fid)) return h.j({ ok: false, msg: 'bad token' })
			fid = t.f
			const parts = [...f.parts].sort((a, b) => a.partNumber - b.partNumber)
			const o = await env.FILES.resumeMultipartUpload(rkey(t.f, t.i), t.u).complete(parts)
			if (o.size !== t.s) throw new Error('size mismatch')
			exp = t.e || +o.customMetadata?.exp || Date.now() + 30 * DAY
			list.push({ i: t.i, name: t.n || o.customMetadata?.name || `file-${t.i + 1}`, size: o.size, type: String(f.type || '').slice(0, 100) })
		}
		if (await env.LINKS.get('l:' + slug)) throw Object.assign(new Error('dup'), { dup: true })
	} catch (e) {
		if (fid) await purge(env, fid)
		return h.j({ ok: false, msg: e.dup ? 'duplicate' : 'upload failed' })
	}

	const total = list.reduce((a, f) => a + f.size, 0)

	await putMeta(env, { type: 'file', fid }, { files: list, exp, next: list.length })
	await env.LINKS.put('l:' + slug, JSON.stringify({ to: `https://go.thatako.net/${slug}`, key, type: 'file', fid, count: list.length, total, exp, names: nameList(list) }))
	const ul = await h.getUserList(env.LINKS, key)
	if (!ul.includes(slug)) ul.push(slug)
	await h.setUserList(env.LINKS, key, ul)

	cache.at = 0
	return h.j({ ok: true, slug })
}

async function abort(req, env, h) {
	const { tokens } = await req.json()
	for (const tk of tokens || []) {
		const t = await verify(env, tk)
		if (t) try { await env.FILES.resumeMultipartUpload(rkey(t.f, t.i), t.u).abort() } catch { }
	}
	return h.j({ ok: true })
}

async function info(req, env, h) {
	const { key, slug } = await req.json()
	const o = await own(env, h, key, slug)
	if (!o) return h.j({ ok: false, msg: 'not found' })
	const r = await live(env, o.data)
	if (!r.m) return h.j({ ok: false, msg: r.msg })
	const c = cfg(env)
	return h.j({
		ok: true, type: o.data.type, exp: r.m.exp || 0, maxFiles: c.maxFiles, perUpload: c.perUpload,
		files: r.m.files.map(f => ({ k: f.i, name: f.name, size: f.size, type: f.type || '' })),
	})
}

async function rename(req, env, h) {
	const { key, slug, k, name } = await req.json()
	const o = await own(env, h, key, slug)
	if (!o) return h.j({ ok: false, msg: 'not found' })
	if (!String(name || '').trim()) return h.j({ ok: false, msg: 'bad name' })
	const r = await live(env, o.data)
	if (!r.m) return h.j({ ok: false, msg: r.msg })
	const f = r.m.files.find(x => x.i === +k)
	if (!f) return h.j({ ok: false, msg: 'no such file' })
	f.name = cleanName(name)
	await saveLink(env, o.slug, o.data, r.m)
	return h.j({ ok: true, name: f.name })
}

async function remove(req, env, h) {
	const { key, slug, k } = await req.json()
	const o = await own(env, h, key, slug)
	if (!o) return h.j({ ok: false, msg: 'not found' })
	const r = await live(env, o.data)
	if (!r.m) return h.j({ ok: false, msg: r.msg })
	const f = r.m.files.find(x => x.i === +k)
	if (!f) return h.j({ ok: false, msg: 'no such file' })
	if (r.m.files.length <= 1) return h.j({ ok: false, msg: 'last file' })

	r.m.files = r.m.files.filter(x => x !== f)
	await saveLink(env, o.slug, o.data, r.m)
	if (o.data.type === 'file') await env.FILES.delete(rkey(o.data.fid, f.i)).catch(e => console.error('[files] remove', e?.message))
	cache.at = 0
	return h.j({ ok: true })
}

async function addInit(req, env, h) {
	const { key, slug, files } = await req.json()
	const c = cfg(env)
	const o = await own(env, h, key, slug)
	if (!o || o.data.type !== 'file') return h.j({ ok: false, msg: 'not found' })
	const r = await live(env, o.data)
	if (!r.m) return h.j({ ok: false, msg: r.msg })
	const m = r.m

	if (!Array.isArray(files) || !files.length) return h.j({ ok: false, msg: 'bad files' })
	if (m.files.length + files.length > c.maxFiles) return h.j({ ok: false, msg: 'too many files' })
	const sizes = files.map(f => Math.floor(+f.size))
	if (sizes.some(s => !(s > 0))) return h.j({ ok: false, msg: 'bad files' })
	const total = sizes.reduce((a, b) => a + b, 0)
	if (total > c.perUpload) return h.j({ ok: false, msg: 'too big' })

	const [u, mine] = await Promise.all([usage(env), keyUsage(env, key, h)])
	if (u.bytes + total > c.total) return h.j({ ok: false, msg: 'storage full' })
	if (mine + total > c.perKey) return h.j({ ok: false, msg: 'key quota' })

	const start = m.next
	m.next += files.length
	await putMeta(env, o.data, m)

	const out = await Promise.all(files.map(async (f, n) => {
		const name = cleanName(f.name), i = start + n
		const mp = await env.FILES.createMultipartUpload(rkey(o.data.fid, i), { customMetadata: { name, exp: String(m.exp) } })
		return { token: await sign(env, { f: o.data.fid, i, u: mp.uploadId, s: sizes[n], n: name, e: m.exp, x: Date.now() + DAY }) }
	}))
	return h.j({ ok: true, chunk: CHUNK, files: out })
}

async function addDone(req, env, h) {
	const { key, slug, files } = await req.json()
	const o = await own(env, h, key, slug)
	if (!o || o.data.type !== 'file') return h.j({ ok: false, msg: 'not found' })
	if (!Array.isArray(files) || !files.length) return h.j({ ok: false, msg: 'bad files' })
	const r = await live(env, o.data)
	if (!r.m) return h.j({ ok: false, msg: r.msg })
	const m = r.m

	const jobs = []
	for (const f of files) {
		const t = await verify(env, f.token)
		if (!t || t.f !== o.data.fid) return h.j({ ok: false, msg: 'bad token' })
		if (m.files.some(x => x.i === t.i) || jobs.some(x => x.t.i === t.i)) return h.j({ ok: false, msg: 'duplicate' })
		jobs.push({ t, f })
	}

	const added = []
	try {
		for (const { t, f } of jobs) {
			const parts = [...f.parts].sort((a, b) => a.partNumber - b.partNumber)
			const obj = await env.FILES.resumeMultipartUpload(rkey(t.f, t.i), t.u).complete(parts)
			if (obj.size !== t.s) throw new Error('size mismatch')
			added.push({ i: t.i, name: t.n || obj.customMetadata?.name || `file-${t.i + 1}`, size: obj.size, type: String(f.type || '').slice(0, 100) })
		}
	} catch (e) {
		for (const { t } of jobs) {
			try { await env.FILES.resumeMultipartUpload(rkey(t.f, t.i), t.u).abort() } catch { }
			try { await env.FILES.delete(rkey(t.f, t.i)) } catch { }
		}
		cache.at = 0
		return h.j({ ok: false, msg: 'upload failed' })
	}

	m.files.push(...added)
	await saveLink(env, o.slug, o.data, m)
	return h.j({ ok: true, count: m.files.length })
}

async function driveAdd(req, env, h) {
	const { key, slug, token, files } = await req.json()
	const c = cfg(env)
	const o = await own(env, h, key, slug)
	if (!o || o.data.type !== 'drive') return h.j({ ok: false, msg: 'not found' })
	if (!token || !Array.isArray(files) || !files.length) return h.j({ ok: false, msg: 'bad files' })

	const ids = files.map(f => String(f?.id || ''))
	if (ids.some(id => !/^[\w-]{10,100}$/.test(id)) || new Set(ids).size !== ids.length) return h.j({ ok: false, msg: 'bad files' })

	const r = await live(env, o.data)
	if (!r.m) return h.j({ ok: false, msg: r.msg })
	const m = r.m
	if (m.files.length + ids.length > c.maxFiles) return h.j({ ok: false, msg: 'too many files' })
	if (ids.some(id => m.files.some(f => f.id === id))) return h.j({ ok: false, msg: 'duplicate' })

	const list = await driveVerify(ids, token)
	if (!list) return h.j({ ok: false, msg: 'drive denied' })
	for (const f of list) m.files.push({ i: m.next++, ...f })
	await saveLink(env, o.slug, o.data, m)
	return h.j({ ok: true, count: m.files.length })
}

const TEXT = 'text/plain; charset=utf-8'
const KINDS = {
	image: { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp' },
	video: { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg' },
	audio: { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', weba: 'audio/webm' },
	text: Object.fromEntries('txt md csv tsv json log yml yaml toml ini js mjs ts py c h cpp java go rs sh sql css'.split(' ').map(e => [e, TEXT])),
}
const INLINE = new Map(Object.values(KINDS).flatMap(m => Object.entries(m)))
const KIND_EXTS = Object.fromEntries(Object.entries(KINDS).map(([k, m]) => [k, Object.keys(m)]))

// download
const disp = name => {
	const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
	return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16))}`
}

async function download(req, env, path) {
	const [, , fid, i] = path.split('/')
	if (!/^[a-z0-9]{12}$/.test(fid || '') || !/^\d+$/.test(i || '')) return new Response('not found', { status: 404 })

	const o = await env.FILES.get(rkey(fid, i), { range: req.headers, onlyIf: req.headers })
	if (!o) return new Response('gone', { status: 410 })

	const m = await getMeta(env, fid)
	const entry = m?.files?.find((f, n) => (f?.i ?? n) === +i)
	if (m && !entry) return new Response('gone', { status: 410 })
	const name = entry?.name || o.customMetadata?.name
	const exp = +o.customMetadata?.exp || +m?.exp
	if (!(exp > Date.now())) return new Response('gone', { status: 410 })

	const safe = cleanName(name), dot = safe.lastIndexOf('.')
	const mime = new URL(req.url).searchParams.has('inline') && dot > 0 ? INLINE.get(safe.slice(dot + 1).toLowerCase()) : null

	const hd = new Headers({
		'content-type': mime || 'application/octet-stream',
		'content-disposition': mime ? 'inline' : disp(safe),
		'x-content-type-options': 'nosniff',
		'accept-ranges': 'bytes',
		etag: o.httpEtag,
		'cache-control': mime ? 'private, max-age=3600' : 'private, no-cache',
		'access-control-allow-origin': '*',
		'access-control-expose-headers': 'content-length, content-range, content-disposition',
	})
	if (mime) hd.set('content-security-policy', "default-src 'none'; sandbox")
	if (!o.body) return new Response(null, { status: 304, headers: hd })

	let status = 200
	if (o.range) {
		let { offset, length, suffix } = o.range
		if (suffix != null) { offset = o.size - suffix; length = suffix }
		offset ??= 0
		length ??= o.size - offset
		hd.set('content-range', `bytes ${offset}-${offset + length - 1}/${o.size}`)
		hd.set('content-length', String(length))
		status = 206
	} else hd.set('content-length', String(o.size))

	return new Response(req.method === 'HEAD' ? null : o.body, { status, headers: hd })
}

// download page, hard code
const PAGE_HEADERS = {
	'content-type': 'text/html; charset=utf-8',
	'cache-control': 'no-store',
	'referrer-policy': 'no-referrer',
	'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; img-src 'self' data: https://thatako.net https://lh3.googleusercontent.com https://drive.google.com https://*.googleusercontent.com; media-src 'self' https://drive.usercontent.google.com https://drive.google.com https://*.googleusercontent.com; base-uri 'none'; form-action 'none'",
}

async function repair(env, slug, data, m) {
	const files = []
	let exp = +m.exp || 0
	for (const [n, f] of (m.files || []).entries()) {
		const k = f?.i ?? n
		const h = await env.FILES.head(rkey(data.fid, k)).catch(() => null)
		exp ||= +h?.customMetadata?.exp || (h ? h.uploaded.getTime() + 30 * DAY : 0)
		files.push({ i: k, name: f?.name || h?.customMetadata?.name || `file-${k + 1}`, size: f?.size || h?.size || 0, type: f?.type || '' })
	}
	if (!exp) return null
	const fixed = { files, total: files.reduce((a, f) => a + f.size, 0), exp, next: Math.max(+m.next || 0, ...files.map(f => f.i + 1)) }
	await env.LINKS.put('f:' + data.fid, JSON.stringify(fixed), { expiration: Math.floor((exp + 7 * DAY) / 1000) })
	metaCache.delete(data.fid)
	if (slug) await env.LINKS.put('l:' + slug, JSON.stringify({ ...data, count: files.length, total: fixed.total, exp, names: nameList(files) }))
	return fixed
}

const gone = () => new Response(shell('<div class="card"><div class="hd"><h1>ลิงก์หมดอายุแล้ว</h1><p>ไฟล์ชุดนี้ถูกลบออกจากระบบแล้ว กรุณาติดต่อผู้ส่งเพื่อขอลิงก์ใหม่</p></div></div>'), { status: 410, headers: PAGE_HEADERS })
export async function filePage(env, data, slug) {
	let m = await env.LINKS.get('f:' + data.fid, 'json')
	if (!m) return gone()
	const drive = data.type === 'drive'
	if (!drive && (!m.exp || m.files.some(f => !f?.name))) m = await repair(env, slug, data, m)
	if (!m || (!drive && m.exp < Date.now())) return gone()
	const json = JSON.stringify({ id: data.fid, ...m, drive, kinds: KIND_EXTS }).replace(/</g, '\\u003c')
	return new Response(shell(`<div class="card" id="app"></div>
<div class="ft"><span>ไฟล์ถูกแชร์โดยผู้ใช้ ไม่ได้ตรวจสอบโดยทางโรงเรียน</span><a href="mailto:aitji@duck.com?subject=report%20go.thatako.net">รายงานไฟล์ไม่เหมาะสม</a></div>
<script type="application/json" id="m">${json}</script><script>${CLIENT}</script>`, drive ? PRECONNECT : ''), { headers: PAGE_HEADERS })
}

// google drive link
async function driveVerify(ids, token) {
	const list = []
	for (const id of ids) {
		const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,size,mimeType,ownedByMe,trashed`, { headers: { authorization: 'Bearer ' + token } })
		if (!r.ok) return null
		const d = await r.json()
		if (!d.ownedByMe || d.trashed) return null
		list.push({ id: d.id, name: cleanName(d.name), size: +d.size || 0, type: String(d.mimeType || '').slice(0, 100) })
	}
	return list
}

async function driveLink(req, env, h) {
	const { key, slug: raw, token, files } = await req.json()
	const c = cfg(env)
	if (!key || !token || !Array.isArray(files) || !files.length || files.length > c.maxFiles) return h.j({ ok: false, msg: 'bad files' })

	const ids = files.map(f => String(f?.id || ''))
	if (ids.some(id => !/^[\w-]{10,100}$/.test(id)) || new Set(ids).size !== ids.length) return h.j({ ok: false, msg: 'bad files' })

	const slug = raw ? h.norm(raw) : rand(6)
	if (!h.validSlug(slug)) return h.j({ ok: false, msg: 'bad slug' })
	if (await env.LINKS.get('l:' + slug)) return h.j({ ok: false, msg: 'duplicate' })

	const list = await driveVerify(ids, token)
	if (!list) return h.j({ ok: false, msg: 'drive denied' })
	list.forEach((f, i) => f.i = i)

	const fid = rand(12), total = list.reduce((a, f) => a + f.size, 0)
	if (await env.LINKS.get('l:' + slug)) return h.j({ ok: false, msg: 'duplicate' })
	await env.LINKS.put('f:' + fid, JSON.stringify({ files: list, total, exp: 0, next: list.length }))
	await env.LINKS.put('l:' + slug, JSON.stringify({ to: `https://go.thatako.net/${slug}`, key, type: 'drive', fid, count: list.length, total, exp: 0, names: nameList(list) }))
	const ul = await h.getUserList(env.LINKS, key)
	if (!ul.includes(slug)) ul.push(slug)
	await h.setUserList(env.LINKS, key, ul)
	return h.j({ ok: true, slug })
}

const PRECONNECT = '<link rel="preconnect" href="https://lh3.googleusercontent.com" crossorigin><link rel="dns-prefetch" href="https://drive.usercontent.google.com">'
const shell = (body, head = '') => `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="color-scheme" content="light dark"><meta name="theme-color" content="#4f5d97"><title>ดาวน์โหลดไฟล์ · go.thatako.net</title><link rel="icon" href="https://thatako.net/img/icon/favicon.ico"><link rel="stylesheet" href="https://thatako.net/zStyles/webfonts/font-awesome.css">${head}<style>${CSS}</style></head><body><main><div class="top"><b>thatako.net</b> / go.thatako.net</div>${body}</main></body></html>`
