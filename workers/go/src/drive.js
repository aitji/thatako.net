import { b64u, rand, disp, gone, view } from './files.js'

const API = 'https://www.googleapis.com/drive/v3/files'
const NATIVE = 'application/vnd.google-apps'
const FOLDER = NATIVE + '.folder'
const ID = /^[\w-]{10,100}$/
const enc = new TextEncoder()
const sa = env => JSON.parse(env.GOOGLE_SA_JSON)

let tok = { v: '', exp: 0 }
async function saToken(env) {
	if (tok.exp > Date.now() + 60_000) return tok.v
	const k = sa(env), now = Math.floor(Date.now() / 1000)
	const head = b64u(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
	const body = b64u(enc.encode(JSON.stringify({
		iss: k.client_email, scope: 'https://www.googleapis.com/auth/drive.readonly',
		aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
	})))
	const der = Uint8Array.from(atob(k.private_key.replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0))
	const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
	const sig = b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(head + '.' + body)))
	const r = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${body}.${sig}` }),
	})
	const j = await r.json()
	if (!j.access_token) throw new Error('sa token')
	tok = { v: j.access_token, exp: Date.now() + j.expires_in * 1000 }
	return tok.v
}

const gget = async (env, url, headers = {}) => fetch(url, { headers: { ...headers, authorization: 'Bearer ' + await saToken(env) } })
const meta = async (env, id) => {
	const r = await gget(env, `${API}/${id}?supportsAllDrives=true&fields=id,name,mimeType,size,parents,trashed,owners(emailAddress),sharingUser(emailAddress)`)
	if (!r.ok) return null
	const m = await r.json()
	return m.trashed ? null : m
}

const kidsCache = new Map()
async function kids(env, id) {
	const c = kidsCache.get(id)
	if (c && c.at > Date.now() - 30_000) return c.files
	const q = encodeURIComponent(`'${id}' in parents and trashed=false and not mimeType contains '${NATIVE}'`)
	const r = await gget(env, `${API}?q=${q}&pageSize=200&orderBy=name&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,size)`)
	if (!r.ok) throw new Error('list')
	const files = (await r.json()).files
	kidsCache.set(id, { at: Date.now(), files })
	return files
}

const parseId = s => {
	s = String(s || '').trim()
	return (s.match(/\/(?:file\/d|folders|d)\/([\w-]{10,})/) || s.match(/[?&]id=([\w-]{10,})/) || s.match(/^([\w-]{20,})$/))?.[1]
}

// api
export async function handleDrive(req, env, path, h) {
	try {
		if (path === 'api/drive/cfg') return h.j({ ok: true, clientId: env.GOOGLE_CLIENT_ID || '', sa: sa(env).client_email })
		if (req.method === 'POST' && path === 'api/drive/register') return await register(req, env, h)
		if (path.startsWith('api/dv/')) return await download(req, env, path)
	} catch (e) {
		console.error('[drive]', path, e?.message)
		return h.j({ ok: false, msg: 'drive failed' })
	}
	return new Response('bad', { status: 400 })
}

async function register(req, env, h) {
	const { key, slug: raw, target, token } = await req.json()
	if (!key) return h.j({ ok: false, msg: 'missing key' })
	const id = parseId(target)
	if (!id || !ID.test(id)) return h.j({ ok: false, msg: 'drive bad link' })

	const m = await meta(env, id)
	if (!m) return h.j({ ok: false, msg: 'drive no access' })
	const folder = m.mimeType === FOLDER
	if (!folder && m.mimeType.startsWith(NATIVE)) return h.j({ ok: false, msg: 'drive native' })

	let owner = m.sharingUser?.emailAddress || m.owners?.[0]?.emailAddress || '', verified = false
	if (token) { // signed in with google
		const t = await (await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token))).json()
		if (t.aud !== env.GOOGLE_CLIENT_ID || String(t.email_verified) !== 'true' || !t.email) return h.j({ ok: false, msg: 'drive bad login' })
		if (!m.owners?.some(o => o.emailAddress?.toLowerCase() === t.email.toLowerCase())) return h.j({ ok: false, msg: 'drive not owner' })
		owner = t.email; verified = true
	}

	if (await env.LINKS.get('d:' + id)) return h.j({ ok: false, msg: 'drive used' })
	const slug = raw ? h.norm(raw) : rand(6)
	if (!h.validSlug(slug)) return h.j({ ok: false, msg: 'bad slug' })
	if (await env.LINKS.get('l:' + slug)) return h.j({ ok: false, msg: 'duplicate' })

	await env.LINKS.put('d:' + id, slug)
	await env.LINKS.put('l:' + slug, JSON.stringify({
		to: `https://go.thatako.net/${slug}`, key, type: 'drive', did: id,
		kind: folder ? 'folder' : 'file', name: m.name, owner, verified, exp: 0,
	}))
	const ul = await h.getUserList(env.LINKS, key)
	if (!ul.includes(slug)) ul.push(slug)
	await h.setUserList(env.LINKS, key, ul)
	return h.j({ ok: true, slug, name: m.name })
}

// o.o
async function download(req, env, path) {
	const [, , did, fid] = path.split('/')
	if (!ID.test(did || '') || !ID.test(fid || '') || !await env.LINKS.get('d:' + did)) return new Response('not found', { status: 404 })

	const m = await meta(env, fid)
	if (!m || m.mimeType.startsWith(NATIVE) || (fid !== did && !m.parents?.includes(did))) return new Response('not found', { status: 404 })

	const range = req.headers.get('range')
	const r = await gget(env, `${API}/${fid}?alt=media&supportsAllDrives=true`, range ? { range } : {})
	if (r.status !== 200 && r.status !== 206) {
		const e = await r.json().catch(() => ({}))
		const quota = e.error?.errors?.some(x => x.reason === 'downloadQuotaExceeded')
		return new Response(quota ? 'ไฟล์นี้ถูกดาวน์โหลดมากเกินโควตาชั่วคราวของ Google กรุณาลองใหม่ภายหลัง' : 'unavailable', {
			status: quota ? 429 : r.status === 404 ? 404 : 502,
			headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '3600' },
		})
	}

	const hd = new Headers({
		'content-type': 'application/octet-stream',
		'content-disposition': disp(m.name.replace(/[\u0000-\u001f\\/:*?"<>|]+/g, '_')),
		'x-content-type-options': 'nosniff',
		'accept-ranges': 'bytes',
		'cache-control': 'private, no-cache',
		'access-control-allow-origin': '*',
		'access-control-expose-headers': 'content-length, content-range, content-disposition',
	})
	if (!r.headers.get('content-encoding')) for (const k of ['content-length', 'content-range']) if (r.headers.get(k)) hd.set(k, r.headers.get(k))
	return new Response(req.method === 'HEAD' ? null : r.body, { status: r.status, headers: hd })
}

// download page
export async function drivePage(env, data) {
	let files = []
	try {
		if (data.kind === 'folder') files = await kids(env, data.did)
		else { const m = await meta(env, data.did); if (m) files = [m] }
	} catch { }
	if (!files.length) return gone('ไม่พบไฟล์', 'เจ้าของอาจยกเลิกการแชร์ ย้าย หรือลบไฟล์ หรือโฟลเดอร์ยังว่างอยู่')
	return view({
		id: data.did, base: `/api/dv/${data.did}/`, ids: files.map(f => f.id),
		files: files.map(f => ({ name: f.name, size: +f.size || 0 })),
		total: files.reduce((a, f) => a + (+f.size || 0), 0), exp: 0, note: 'แชร์จาก Google Drive',
	})
}
