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

// delete / expire
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
			list.push({ name: t.n || o.customMetadata?.name || `file-${t.i + 1}`, size: o.size, type: String(f.type || '').slice(0, 100) })
		}
		if (await env.LINKS.get('l:' + slug)) throw Object.assign(new Error('dup'), { dup: true })
	} catch (e) {
		if (fid) await purge(env, fid)
		return h.j({ ok: false, msg: e.dup ? 'duplicate' : 'upload failed' })
	}

	const total = list.reduce((a, f) => a + f.size, 0)

	await env.LINKS.put('f:' + fid, JSON.stringify({ files: list, total, exp }), { expiration: Math.floor((exp + 7 * DAY) / 1000) })
	await env.LINKS.put('l:' + slug, JSON.stringify({ to: `https://go.thatako.net/${slug}`, key, type: 'file', fid, count: list.length, total, exp }))
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

	let name = o.customMetadata?.name, exp = +o.customMetadata?.exp
	if (!name || !exp) {
		const m = await env.LINKS.get('f:' + fid, 'json')
		name ||= m?.files?.[i]?.name
		exp ||= +m?.exp
	}
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
	for (const [i, f] of (m.files || []).entries()) {
		const h = await env.FILES.head(rkey(data.fid, i)).catch(() => null)
		exp ||= +h?.customMetadata?.exp || (h ? h.uploaded.getTime() + 30 * DAY : 0)
		files.push({ name: f?.name || h?.customMetadata?.name || `file-${i + 1}`, size: f?.size || h?.size || 0, type: f?.type || '' })
	}
	if (!exp) return null
	const fixed = { files, total: files.reduce((a, f) => a + f.size, 0), exp }
	await env.LINKS.put('f:' + data.fid, JSON.stringify(fixed), { expiration: Math.floor((exp + 7 * DAY) / 1000) })
	if (slug) await env.LINKS.put('l:' + slug, JSON.stringify({ ...data, count: files.length, total: fixed.total, exp }))
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
async function driveLink(req, env, h) {
	const { key, slug: raw, token, files } = await req.json()
	const c = cfg(env)
	if (!key || !token || !Array.isArray(files) || !files.length || files.length > c.maxFiles) return h.j({ ok: false, msg: 'bad files' })

	const ids = files.map(f => String(f?.id || ''))
	if (ids.some(id => !/^[\w-]{10,100}$/.test(id)) || new Set(ids).size !== ids.length) return h.j({ ok: false, msg: 'bad files' })

	const slug = raw ? h.norm(raw) : rand(6)
	if (!h.validSlug(slug)) return h.j({ ok: false, msg: 'bad slug' })
	if (await env.LINKS.get('l:' + slug)) return h.j({ ok: false, msg: 'duplicate' })

	const list = []
	for (const id of ids) {
		const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,size,mimeType,ownedByMe,trashed`, { headers: { authorization: 'Bearer ' + token } })
		if (!r.ok) return h.j({ ok: false, msg: 'drive denied' })
		const d = await r.json()
		if (!d.ownedByMe || d.trashed) return h.j({ ok: false, msg: 'drive denied' })
		list.push({ id: d.id, name: cleanName(d.name), size: +d.size || 0, type: String(d.mimeType || '').slice(0, 100) })
	}

	const fid = rand(12), total = list.reduce((a, f) => a + f.size, 0)
	if (await env.LINKS.get('l:' + slug)) return h.j({ ok: false, msg: 'duplicate' })
	await env.LINKS.put('f:' + fid, JSON.stringify({ files: list, total, exp: 0 }))
	await env.LINKS.put('l:' + slug, JSON.stringify({ to: `https://go.thatako.net/${slug}`, key, type: 'drive', fid, count: list.length, total, exp: 0 }))
	const ul = await h.getUserList(env.LINKS, key)
	if (!ul.includes(slug)) ul.push(slug)
	await h.setUserList(env.LINKS, key, ul)
	return h.j({ ok: true, slug })
}

const PRECONNECT = '<link rel="preconnect" href="https://lh3.googleusercontent.com" crossorigin><link rel="dns-prefetch" href="https://drive.usercontent.google.com">'
const shell = (body, head = '') => `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="color-scheme" content="light dark"><meta name="theme-color" content="#4f5d97"><title>ดาวน์โหลดไฟล์ · go.thatako.net</title><link rel="icon" href="https://thatako.net/img/icon/favicon.ico">${head}<style>${CSS}</style></head><body><main><div class="top"><b>thatako.net</b> / go.thatako.net</div>${body}</main></body></html>`
