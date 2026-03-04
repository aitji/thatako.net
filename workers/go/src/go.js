const mem = new Map()
const recentlyEdited = new Set()
let lastSweep = 0

const HOT_TTL = 90 * 1000
const COOL_TTL = 60 * 60 * 1000
const MAX_MEM = 10_000
const EDIT_GRACE_PERIOD = 5 * 1000

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
}

// slug normalizer
const norm = s => {
	try {
		let prev
		do {
			prev = s
			s = decodeURIComponent(s)
		} while (s !== prev)
	} catch { }
	if (s.endsWith('/')) s = s.slice(0, -1)
	return s
}

const preflight = () => new Response(null, { status: 204, headers: CORS })

const j = (d) => new Response(JSON.stringify(d), {
	headers: { 'content-type': 'application/json', ...CORS }
})

const r = (to, cacheable = true) => new Response(null, {
	status: 302,
	headers: {
		Location: to,
		'Cache-Control': cacheable
			? 'public, max-age=3'
			: 'no-store, no-cache, must-revalidate, max-age=0',
		...CORS
	}
})

const validSlug = s =>
	s &&
	s.length < 1024 &&
	!s.startsWith('/') &&
	!s.startsWith('api/') &&
	!s.includes('..') &&
	!s.includes('\\')

const validUrl = u => {
	try {
		const x = new URL(u)
		return x.protocol === 'http:' || x.protocol === 'https:'
	} catch { return false }
}

function hot(slug, to) {
	const now = Date.now()
	mem.set(slug, {
		to,
		exp: now + HOT_TTL,
		cool: now + COOL_TTL
	})
}

function markEdited(slug, ctx) {
	recentlyEdited.add(slug)

	if (ctx?.waitUntil) ctx.waitUntil(
		new Promise(resolve => {
			setTimeout(() => {
				recentlyEdited.delete(slug)
				resolve()
			}, EDIT_GRACE_PERIOD)
		})
	)
}

function sweep() {
	const now = Date.now()
	if (now - lastSweep < 10 * 60 * 1000) return
	lastSweep = now

	if (mem.size > MAX_MEM) {
		let i = 0
		for (const k of mem.keys()) {
			mem.delete(k)
			if (++i > MAX_MEM / 4) break
		}
	}

	for (const [k, v] of mem) if (v.cool < now) mem.delete(k)
}

const getUserList = async (kv, key) => (await kv.get('u:' + key, 'json')) || []
const setUserList = (kv, key, list) => kv.put('u:' + key, JSON.stringify(list))

async function api(req, env, path, ctx) {
	// create
	if (path === 'api/create' && req.method === 'POST') {
		let { slug, to, key } = await req.json()

		if (!slug || !to || !key) return j({ ok: false, msg: 'missing slug, to, key' })

		slug = norm(slug)

		if (!validSlug(slug)) return j({ ok: false, msg: 'bad slug' })
		if (!validUrl(to)) return j({ ok: false, msg: 'bad url' })
		if (await env.KV_LINKS.get('l:' + slug)) return j({ ok: false, msg: 'duplicate' })

		await env.KV_LINKS.put('l:' + slug, JSON.stringify({ to, key }))

		const list = await getUserList(env.KV_LINKS, key)
		if (!list.includes(slug)) list.push(slug)
		await setUserList(env.KV_LINKS, key, list)

		hot(slug, to)
		return j({ ok: true })
	}

	// revoke
	if (path === 'api/revoke' && req.method === 'POST') {
		const { slug, key } = await req.json()
		if (!slug || !key) return j({ ok: false })

		const clean = norm(slug)

		const data = await env.KV_LINKS.get('l:' + clean, 'json')
		if (!data || data.key !== key) return j({ ok: false })

		await env.KV_LINKS.delete('l:' + clean)

		const list = await getUserList(env.KV_LINKS, key)
		const next = list.filter(s => s !== clean)
		await setUserList(env.KV_LINKS, key, next)

		mem.delete(clean)
		markEdited(clean, ctx)

		return j({ ok: true })
	}

	// edit
	if (path === 'api/edit' && req.method === 'POST') {
		let { slug, newSlug, to, key } = await req.json()
		if (!slug || !key) return j({ ok: false })

		slug = norm(slug)
		if (newSlug) newSlug = norm(newSlug)

		const data = await env.KV_LINKS.get('l:' + slug, 'json')
		if (!data || data.key !== key) return j({ ok: false })

		const finalSlug = newSlug || slug

		if (!validSlug(finalSlug)) return j({ ok: false, msg: 'bad slug' })
		if (to && !validUrl(to)) return j({ ok: false, msg: 'bad url' })
		if (newSlug && newSlug !== slug)
			if (await env.KV_LINKS.get('l:' + newSlug))
				return j({ ok: false, msg: 'duplicate' })

		const updated = { ...data, to: to || data.to }
		await env.KV_LINKS.put('l:' + finalSlug, JSON.stringify(updated))

		const list = await getUserList(env.KV_LINKS, key)

		if (finalSlug !== slug) {
			await env.KV_LINKS.delete('l:' + slug)

			const i = list.indexOf(slug)
			if (i !== -1) list[i] = finalSlug

			mem.delete(slug)
			markEdited(slug, ctx)
			markEdited(finalSlug, ctx)
		} else {
			mem.delete(slug)
			markEdited(slug, ctx)
		}

		await setUserList(env.KV_LINKS, key, list)

		return j({ ok: true, slug: finalSlug })
	}

	// list
	if (path.startsWith('api/list')) {
		const key = new URL(req.url).searchParams.get('key')
		if (!key) return j([])

		const list = await getUserList(env.KV_LINKS, key)
		const out = []

		for (const slug of list) {
			const d = await env.KV_LINKS.get('l:' + slug, 'json')
			if (d) out.push({ slug, ...d })
		}

		return j(out)
	}

	return new Response('bad', { status: 400, headers: CORS })
}

export default {
	async fetch(req, env, ctx) {
		if (req.method === 'OPTIONS') return preflight()

		sweep()

		const url = new URL(req.url)
		let slug = url.pathname.slice(1)
		slug = norm(slug)

		if (slug.startsWith('api/')) return api(req, env, slug, ctx)
		if (!slug) return r('https://thatako.net/short', true)

		const now = Date.now()
		const wasEdited = recentlyEdited.has(slug)

		const m = mem.get(slug)
		if (!wasEdited && m && m.exp > now) {
			m.cool = now + COOL_TTL
			return r(m.to, true)
		}

		const data = await env.KV_LINKS.get('l:' + slug, 'json')

		if (!data) {
			const debug = {
				ok: false,
				error: 'not found',
				path: url.pathname,
				slug,
				in_mem: mem.has(slug),
				recently_edited: recentlyEdited.has(slug)
			}

			return new Response(
				JSON.stringify(debug, null, 2),
				{
					status: 404,
					headers: { 'content-type': 'application/json', ...CORS }
				}
			)
		}

		mem.set(slug, {
			to: data.to,
			exp: now + HOT_TTL,
			cool: now + COOL_TTL
		})

		return r(data.to, !wasEdited)
	}
}
