const GITHUB_REPO = 'aitji/id.thatako.net'
const GITHUB_BRANCH = 'main'
const DOMAINS_DIR = 'domains'

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, X-User-Data, X-Sig',
}

// utils
function json(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json', ...CORS },
	})
}

async function checkSig(userData, sig, secret) {
	const enc = new TextEncoder()
	const key = await crypto.subtle.importKey(
		'raw', enc.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false, ['verify']
	)
	return crypto.subtle.verify('HMAC', key, hexToBuffer(sig), enc.encode(userData))
}

function hexToBuffer(hex) {
	const bytes = new Uint8Array(hex.length / 2)
	for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
	return bytes
}

function parseUserData(userData) {
	const [login, id, ts] = userData.split(':')
	return { login, id: Number(id), ts: Number(ts) }
}

// auth middleware
async function authenticate(request, env) {
	let userData, sig, body = null

	if (request.method === 'GET') {
		userData = request.headers.get('X-User-Data')
		sig = request.headers.get('X-Sig')
	} else {
		try { body = await request.json() } catch { return { ok: false, error: 'Invalid JSON body' } }
		userData = body?.userData
		sig = body?.sig
	}

	if (!userData || !sig) return { ok: false, error: 'Missing userData or sig' }

	const valid = await checkSig(userData, sig, env.SIG_SECRET)
	if (!valid) return { ok: false, error: 'Invalid signature' }

	const parsed = parseUserData(userData)
	if (Date.now() - parsed.ts > 86_400_000) return { ok: false, error: 'Auth token expired, please re-login' }

	return { ok: true, ...parsed, body }
}

function checkPayload(payload) {
	const errors = []
	if (!payload.domain || typeof payload.domain !== 'string') errors.push('domain is required')

	if (!/^[a-z0-9][a-z0-9\-]{0,61}[a-z0-9]?\.id\.thatako\.net$/.test(payload.domain))
		errors.push('domain must match [name].id.thatako.net')
	if (payload.domain.includes('..') || payload.domain.includes('/'))
		errors.push('invalid domain characters')

	if (!Array.isArray(payload.host) || payload.host.length === 0) errors.push('host array required')
	if (!Array.isArray(payload.owner) || payload.owner.length === 0) errors.push('owner array required')

	for (const o of (payload.owner || [])) {
		if (typeof o.github !== 'string' || typeof o['github-id'] !== 'number')
			errors.push('each owner must have github (string) and github-id (number)')
	}

	if (!payload.records || typeof payload.records !== 'object') errors.push('records object required')

	const dangerous = /<script|javascript:|data:|vbscript:/i
	for (const [type, val] of Object.entries(payload.records || {})) {
		const values = Array.isArray(val) ? val : [val]
		for (const v of values) {
			const str = typeof v === 'object' ? JSON.stringify(v) : String(v)
			if (dangerous.test(str)) errors.push(`dangerous value in record ${type}`)
		}
	}

	return errors
}

// github utils
async function githubRequest(path, method, body, token) {
	const res = await fetch(`https://api.github.com${path}`, {
		method,
		headers: {
			Authorization: `token ${token}`,
			'Content-Type': 'application/json',
			Accept: 'application/vnd.github.v3+json',
			'User-Agent': 'thatako-worker',
		},
		body: body ? JSON.stringify(body) : undefined,
	})
	const text = await res.text()
	let parsed
	try { parsed = JSON.parse(text) } catch { parsed = { message: text } }
	return { ok: res.ok, status: res.status, json: parsed }
}

async function getFile(path, token) {
	return githubRequest(`/repos/${GITHUB_REPO}/contents/${path}`, 'GET', null, token)
}

async function upsertFile(path, content, commitMsg, token, existingSha) {
	const body = {
		message: commitMsg,
		content: btoa(unescape(encodeURIComponent(content))),
		branch: GITHUB_BRANCH,
	}

	if (existingSha) body.sha = existingSha
	return githubRequest(`/repos/${GITHUB_REPO}/contents/${path}`, 'PUT', body, token)
}

async function deleteFile(path, sha, commitMsg, token) {
	return githubRequest(`/repos/${GITHUB_REPO}/contents/${path}`, 'DELETE', {
		message: commitMsg, sha, branch: GITHUB_BRANCH,
	}, token)
}

async function listDomainFiles(token) {
	// get branch head
	const branchRes = await githubRequest(
		`/repos/${GITHUB_REPO}/branches/${GITHUB_BRANCH}`, 'GET', null, token
	)
	if (!branchRes.ok) return []

	const treeSha = branchRes.json.commit.commit.tree.sha

	// get recursive tree (avoids paging for small repos)
	const treeRes = await githubRequest(
		`/repos/${GITHUB_REPO}/git/trees/${treeSha}?recursive=1`, 'GET', null, token
	)
	if (!treeRes.ok) return []

	return (treeRes.json.tree || []).filter(
		item => item.type === 'blob' && item.path.startsWith(`${DOMAINS_DIR}/`) && item.path.endsWith('.json')
	)
}

// main handler
export default {
	async fetch(request, env) {
		const url = new URL(request.url)

		if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
		if (url.pathname !== '/dns') return json({ error: 'Not found' }, 404)

		// GET: list of domains owned by auth user
		if (request.method === 'GET') {
			const auth = await authenticate(request, env)
			if (!auth.ok) return json({ error: auth.error }, 401)

			const files = await listDomainFiles(env.GITHUB_TOKEN)
			const settled = await Promise.allSettled(files.map(f => getFile(f.path, env.GITHUB_TOKEN)))

			const domains = []
			for (const result of settled) {
				if (result.status !== 'fulfilled' || !result.value.ok) continue
				try {
					const raw = atob(result.value.json.content.replace(/\n/g, ''))
					const data = JSON.parse(raw)

					// only include domains this user owns
					const isOwner = (data.owner || []).some(o => o['github-id'] === auth.id)
					if (isOwner) domains.push(data)
				} catch { /* skip malformed files */ }
			}

			return json({ ok: true, domains })
		}

		// POST / DELETE: require JSON body
		const auth = await authenticate(request, env)
		if (!auth.ok) return json({ error: auth.error }, 401)

		const { body } = auth
		const { payload } = body || {}
		if (!payload) return json({ error: 'missing payload' }, 400)

		// POST: create or update
		if (request.method === 'POST') {
			const errors = checkPayload(payload)
			if (errors.length) return json({ error: errors.join('; ') }, 400)

			const primaryOwner = payload.owner[0]
			if (primaryOwner['github-id'] !== auth.id || primaryOwner.github !== auth.login)
				return json({ error: 'primary owner must match auth GitHub user' }, 403)

			const subdomain = payload.domain.split('.id.thatako.net')[0]
			const filePath = `${DOMAINS_DIR}/${subdomain}.id.thatako.net.json`
			const fileContent = JSON.stringify(payload, null, 2)

			const existing = await getFile(filePath, env.GITHUB_TOKEN)
			if (existing.ok) {
				try {
					const raw = atob(existing.json.content.replace(/\n/g, ''))
					const existingData = JSON.parse(raw)
					const isOwner = (existingData.owner || []).some(o => o['github-id'] === auth.id)
					if (!isOwner) return json({ error: 'You are not an owner of this domain' }, 403)
				} catch { /* allow overwrite if file is malformed */ }
			}

			const sha = existing.ok ? existing.json.sha : undefined
			const action = sha ? 'update' : 'create'
			const commit = `${action}(${subdomain}): by @${auth.login} [worker]`
			const result = await upsertFile(filePath, fileContent, commit, env.GITHUB_TOKEN, sha)

			if (!result.ok) return json({ error: 'GitHub write failed: ' + result.json.message }, 500)
			return json({ ok: true, action, domain: payload.domain, file: filePath })
		}

		// DELETE
		if (request.method === 'DELETE') {
			const { domain } = payload
			if (!domain) return json({ error: 'domain required' }, 400)

			const subdomain = domain.split('.id.thatako.net')[0]
			const filePath = `${DOMAINS_DIR}/${subdomain}.id.thatako.net.json`

			const existing = await getFile(filePath, env.GITHUB_TOKEN)
			if (!existing.ok) return json({ error: 'Domain not found' }, 404)

			let existingData
			try {
				const raw = atob(existing.json.content.replace(/\n/g, ''))
				existingData = JSON.parse(raw)
			} catch { return json({ error: 'Malformed domain file' }, 500) }

			const isOwner = (existingData.owner || []).some(o => o['github-id'] === auth.id)
			if (!isOwner) return json({ error: 'You are not an owner of this domain' }, 403)

			const result = await deleteFile(
				filePath, existing.json.sha,
				`remove(${subdomain}): deleted by @${auth.login} [worker]`,
				env.GITHUB_TOKEN
			)
			if (!result.ok) return json({ error: 'GitHub delete failed: ' + result.json.message }, 500)

			return json({ ok: true, action: 'delete', domain })
		}

		return json({ error: 'Method not allowed' }, 405)
	},
}
