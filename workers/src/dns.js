const GITHUB_REPO = 'aitji/id.thatako.net'
const GITHUB_BRANCH = 'main'

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
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
	const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
	const sigBuf = hexToBuffer(sig)
	return crypto.subtle.verify('HMAC', key, sigBuf, enc.encode(userData))
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



function checkPyaLoad(payload) {
	const errors = []
	if (!payload.domain || typeof payload.domain !== 'string') errors.push('domain is required')

	// *.id.thatako.net
	if (!/^[a-z0-9][a-z0-9\-]{0,61}[a-z0-9]?\.id\.thatako\.net$/.test(payload.domain)) errors.push('domain must match [name].id.thatako.net')
	// path traversal guard
	if (payload.domain.includes('..') || payload.domain.includes('/')) errors.push('invalid domain characters')

	if (!Array.isArray(payload.host) || payload.host.length === 0) errors.push('host array required')
	if (!Array.isArray(payload.owner) || payload.owner.length === 0) errors.push('owner array required')

	for (const o of (payload.owner || [])) {
		if (typeof o.github !== 'string' || typeof o['github-id'] !== 'number')
			errors.push('each owner must have github (string) and github-id (number)')
	}

	if (!payload.records || typeof payload.records !== 'object') errors.push('records object required')

	// XSS/injection ; guard on record values
	const dangerous = /<script|javascript:|data:|vbscript:/i;
	for (const [type, val] of Object.entries(payload.records || {})) {
		const values = Array.isArray(val) ? val : [val]
		for (const v of values) if (dangerous.test(v)) errors.push(`dangerous value in record ${type}`)
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
	let json
	try { json = JSON.parse(text) } catch { json = { message: text } }
	return { ok: res.ok, status: res.status, json }
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

async function getFile(path, token) {
	return githubRequest(`/repos/${GITHUB_REPO}/contents/${path}`, 'GET', null, token)
}

async function deleteFile(path, sha, commitMsg, token) {
	return githubRequest(`/repos/${GITHUB_REPO}/contents/${path}`, 'DELETE', {
		message: commitMsg, sha, branch: GITHUB_BRANCH,
	}, token)
}


// handler
export default {
	async fetch(request, env) {
		const url = new URL(request.url)

		if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
		if (url.pathname !== '/dns') return json({ error: 'Not found' }, 404)

		// parse body
		let body
		try { body = await request.json() }
		catch { return json({ error: 'Invalid JSON body' }, 400) }

		const { payload, userData, sig } = body
		if (!userData || !sig || !payload) return json({ error: 'Missing payload, userData, or sig' }, 400)

		// verify sig
		const validSig = await checkSig(userData, sig, env.SIG_SECRET)
		if (!validSig) return json({ error: 'Invalid signature' }, 401)

		// token age
		const { login, id, ts } = parseUserData(userData)
		if (Date.now() - ts > 86_400_000) // 24h, btw
			return json({ error: 'Auth token expired, please re-login' }, 401)


		// valid payload
		if (request.method === 'POST') {
			const errors = checkPyaLoad(payload)
			if (errors.length) return json({ error: errors.join('; ') }, 400)

			const primaryOwner = payload.owner[0]
			if (primaryOwner['github-id'] !== id || primaryOwner.github !== login) return json({ error: 'primary owner must match authenticated GitHub user' }, 403)

			// write file
			const subdomain = payload.domain.split('.id.thatako.net')[0]
			const filePath = `domains/${subdomain}.id.thatako.net.json`
			const fileContent = JSON.stringify(payload, null, 2)

			// is file alr exists (update/create)
			const existing = await getFile(filePath, env.GITHUB_TOKEN)
			const sha = existing.ok ? existing.json.sha : undefined

			const action = sha ? 'update' : 'create'
			const commit = `${action}(${subdomain}): registered by @${login} [worker]`
			const result = await upsertFile(filePath, fileContent, commit, env.GITHUB_TOKEN, sha)

			if (!result.ok) return json({ error: 'GitHub write failed: ' + result.json.message }, 500)
			return json({ ok: true, action, domain: payload.domain, file: filePath })
		}

		if (request.method === 'DELETE') {
			const { domain } = payload
			if (!domain) return json({ error: 'domain required' }, 400)

			const subdomain = domain.split('.id.thatako.net')[0]
			const filePath = `domains/${subdomain}.id.thatako.net.json`

			// check ownership
			const existing = await getFile(filePath, env.GITHUB_TOKEN)
			if (!existing.ok) return json({ error: 'Domain not found' }, 404)

			const fileData = JSON.parse(Buffer.from(existing.json.content, 'base64').toString('utf8'))
			const isOwner = fileData.owner.some(o => o['github-id'] === id)
			if (!isOwner) return json({ error: 'You are not an owner of this domain' }, 403)

			const result = await deleteFile(filePath, existing.json.sha, `remove(${subdomain}): deleted by @${login} [worker]`, env.GITHUB_TOKEN)
			if (!result.ok) return json({ error: 'GitHub delete failed: ' + result.json.message }, 500)

			return json({ ok: true, action: 'delete', domain })
		}

		return json({ error: 'Method not allowed' }, 405)
	},
}
