export default async function handler(req, res) {
    const origin = req.headers.origin || ''
    const allowed = ['https://id.thatako.net', 'https://thatako.net', 'http://localhost']
    if (allowed.some(o => origin.startsWith(o))) res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') return res.status(204).end()
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

    const { username } = req.query
    if (!username || !/^[a-zA-Z0-9_-]{1,39}$/.test(username))
        return res.status(400).json({ error: 'Invalid username' })

    const headers = {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'thatako-id-proxy/1.0',
    }

    if (process.env.GITHUB_ACCOUNT_AUTH)
        headers['Authorization'] = `Bearer ${process.env.GITHUB_ACCOUNT_AUTH}`

    try {
        const ghRes = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, { headers })

        // pass rate-limit headers  client adapt
        const remaining = ghRes.headers.get('x-ratelimit-remaining')
        const reset = ghRes.headers.get('x-ratelimit-reset')
        if (remaining !== null) res.setHeader('X-RateLimit-Remaining', remaining)
        if (reset !== null) res.setHeader('X-RateLimit-Reset', reset)

        if (ghRes.status === 404) return res.status(404).json({ error: 'User not found' })
        if (ghRes.status === 403 || ghRes.status === 429) return res.status(429).json({ error: 'rate_limit', retryAfter: reset })
        if (!ghRes.ok) return res.status(ghRes.status).json({ error: 'GitHub API error' })

        const data = await ghRes.json()

        // don't expose full profile
        return res.status(200).json({
            id: data.id,
            login: data.login,
            avatar_url: data.avatar_url,
            name: data.name || null,
        })
    } catch (e) {
        return res.status(502).json({ error: 'Proxy error', detail: e.message })
    }
}