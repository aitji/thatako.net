const GB = 1024 ** 3
const DAY = 86_400_000
export const CHUNK = 32 * 1024 * 1024

const cfg = env => ({
	perUpload: +(env.MAX_UPLOAD_GB ?? 4) * GB, // one upload
	perKey: +(env.MAX_KEY_GB ?? 5) * GB, // all live files of one secret key
	total: +(env.MAX_TOTAL_GB ?? 9) * GB, // whole bucket kept margin
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

	const hd = new Headers({
		'content-type': 'application/octet-stream',
		'content-disposition': disp(cleanName(name)),
		'x-content-type-options': 'nosniff',
		'accept-ranges': 'bytes',
		etag: o.httpEtag,
		'cache-control': 'private, no-cache',
		'access-control-allow-origin': '*',
		'access-control-expose-headers': 'content-length, content-range, content-disposition',
	})
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
	'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; img-src data: https://thatako.net; base-uri 'none'; form-action 'none'",
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
	const json = JSON.stringify({ id: data.fid, ...m, drive }).replace(/</g, '\\u003c')
	return new Response(shell(`<div class="card" id="app"></div>
<div class="ft"><span>ไฟล์ถูกแชร์โดยผู้ใช้ ไม่ได้ตรวจสอบโดยทางโรงเรียน</span><a href="mailto:aitji@duck.com?subject=report%20go.thatako.net">รายงานไฟล์ไม่เหมาะสม</a></div>
<script type="application/json" id="m">${json}</script><script>${CLIENT}</script>`), { headers: PAGE_HEADERS })
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

const shell = body => `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="color-scheme" content="light dark"><meta name="theme-color" content="#4f5d97"><title>ดาวน์โหลดไฟล์ · go.thatako.net</title><link rel="icon" href="https://thatako.net/img/icon/favicon.ico"><style>${CSS}</style></head><body><main><div class="top"><b>thatako.net</b> / go.thatako.net</div>${body}</main></body></html>`
const CSS = `:root{--bg:#f6f7fb;--card:#fff;--fg:#1c2033;--mut:#6b7190;--bd:#dfe2ee;--ac:#4f5d97;--acf:#fff}
@media(prefers-color-scheme:dark){:root{--bg:#12141d;--card:#1a1d2a;--fg:#e6e8f2;--mut:#8f94b3;--bd:#2a2e42;--ac:#7b8bd6;--acf:#10121a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,"Noto Sans Thai",sans-serif}
main{max-width:640px;margin:0 auto;padding:24px 16px 48px}.top{font-size:12px;color:var(--mut);margin-bottom:16px}.top b{color:var(--ac)}
.card{background:var(--card);border:1px solid var(--bd);border-radius:10px;overflow:hidden}
.hd{padding:16px;border-bottom:1px solid var(--bd)}.hd h1{margin:0 0 4px;font-size:18px}.hd p{margin:0;color:var(--mut);font-size:13px}
.bar{display:flex;gap:10px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--bd);font-size:13px}.bar label{display:flex;gap:8px;align-items:center;flex:1;cursor:pointer}
ul{list-style:none;margin:0;padding:0}li{display:flex;gap:12px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--bd)}li:last-child{border:0}
.ext{flex:none;width:40px;height:40px;border-radius:8px;background:var(--bg);border:1px solid var(--bd);display:grid;place-items:center;font-size:10px;font-weight:700;color:var(--ac);text-transform:uppercase}
.nm{flex:1;min-width:0}.nm b{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nm small{color:var(--mut)}
.btn{display:inline-flex;align-items:center;justify-content:center;height:34px;padding:0 14px;border-radius:8px;border:1px solid var(--bd);background:none;color:var(--fg);font-family:inherit;font-weight:600;font-size:13px;cursor:pointer;text-decoration:none;white-space:nowrap}
.pri{background:var(--ac);border-color:var(--ac);color:var(--acf)}.btn:disabled{opacity:.4;cursor:not-allowed}
input[type=checkbox]{width:18px;height:18px;accent-color:var(--ac);flex:none}
.ft{margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;justify-content:space-between;font-size:12px;color:var(--mut)}.ft a{color:var(--mut)}`

const CLIENT = `
var M=JSON.parse(document.getElementById('m').textContent),app=document.getElementById('app');
M.files=(M.files||[]).map(function(f,i){f=f||{};return{name:String(f.name||'file-'+(i+1)),size:+f.size||0,id:f.id}});
var sel=new Set(M.files.map(function(_,i){return i}));
function fmt(b){var u=['B','KB','MB','GB','TB'],i=0;while(b>=1024&&i<4){b/=1024;i++}return(b>=100||!i?Math.round(b):b.toFixed(1))+' '+u[i]}
function h(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function href(i){return M.drive?'https://drive.google.com/uc?export=download&id='+encodeURIComponent(M.files[i].id):'/api/dl/'+M.id+'/'+i}
function dl(i){var a=document.createElement('a');a.href=href(i);if(M.drive)a.target='_blank';else a.download='';document.body.appendChild(a);a.click();a.remove()}
var days=Math.max(1,Math.ceil((M.exp-Date.now())/864e5));
var life=M.drive?'ไม่หมดอายุ · เก็บใน Google Drive ของผู้ส่ง':(M.exp>0?'หมดอายุใน '+days+' วัน':'ไม่ทราบวันหมดอายุ');
var hd=h('div','hd');hd.appendChild(h('h1',0,M.files.length+' ไฟล์ พร้อมดาวน์โหลด'));
hd.appendChild(h('p',0,'ขนาดรวม '+fmt(M.total||0)+' · '+life));app.appendChild(hd);
var bar=h('div','bar'),lab=h('label'),all=h('input');all.type='checkbox';all.checked=true;lab.appendChild(all);var cnt=h('span');lab.appendChild(cnt);bar.appendChild(lab);
var cp=h('button','btn','คัดลอกลิงก์');cp.onclick=function(){navigator.clipboard.writeText(location.href).then(function(){cp.textContent='คัดลอกแล้ว'})};bar.appendChild(cp);
var dlAll=h('button','btn pri');bar.appendChild(dlAll);app.appendChild(bar);
var ul=h('ul'),cbs=[];
M.files.forEach(function(f,i){var li=h('li'),cb=h('input');cb.type='checkbox';cb.checked=true;cbs.push(cb);
cb.onchange=function(){cb.checked?sel.add(i):sel.delete(i);upd()};
var parts=f.name.split('.'),ext=(parts.length>1?parts.pop():'file').slice(0,4);
var nm=h('div','nm');nm.appendChild(h('b',0,f.name)).title=f.name;nm.appendChild(h('small',0,fmt(f.size)));
var a=h('a','btn','↓ โหลด');a.href=href(i);if(M.drive)a.target='_blank';else a.setAttribute('download','');
li.appendChild(cb);li.appendChild(h('div','ext',ext));li.appendChild(nm);li.appendChild(a);ul.appendChild(li)});
app.appendChild(ul);
function upd(){var n=sel.size,s=0;sel.forEach(function(i){s+=M.files[i].size});all.checked=n==M.files.length;
cnt.textContent='เลือก '+n+' / '+M.files.length+' ไฟล์';dlAll.disabled=!n;dlAll.textContent='ดาวน์โหลด '+n+' ไฟล์ ('+fmt(s)+')'}
all.onchange=function(){sel.clear();cbs.forEach(function(c,i){c.checked=all.checked;if(all.checked)sel.add(i)});upd()};
dlAll.onclick=async function(){dlAll.disabled=true;var ix=Array.from(sel).sort(function(a,b){return a-b});
for(var k=0;k<ix.length;k++){dl(ix[k]);await new Promise(function(r){setTimeout(r,800)})}upd()};
upd();`
