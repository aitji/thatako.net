import { createHmac } from 'crypto' // is this alr have in nodejs?

export default async function handler(req, res) {
    const { code, state } = req.query
    const clientId = process.env.GITHUB_CLIENT_ID
    const clientSecret = process.env.GITHUB_CLIENT_SECRET
    const sigSecret = process.env.SIG_SECRET

    if (!code) return res.status(400).json({ error: 'missing code' })
    if (!clientId || !clientSecret || !sigSecret) return res.status(500).json({ error: 'server misconfigured' })

    let returnUrl = '/'
    try {
        const decoded = Buffer.from(state || '', 'base64url').toString()
        if (decoded.startsWith('/')) returnUrl = decoded
    } catch { }

    // exchange code for access token
    let accessToken
    try {
        const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify({
                client_id: clientId,
                client_secret: clientSecret,
                code
            })
        })

        if (!tokenRes.ok) throw new Error('github token exchange failed')

        const tokenJson = await tokenRes.json()
        accessToken = tokenJson.access_token
        if (!accessToken) throw new Error('missing access token')
    } catch (e) { return res.status(400).json({ error: e.message }) }

    let ghUser
    let ghEmails

    try {
        const headers = {
            Authorization: `Bearer ${accessToken}`,
            'User-Agent': 'thatako.net'
        }

        const [uRes, eRes] = await Promise.all([
            fetch('https://api.github.com/user', { headers }),
            fetch('https://api.github.com/user/emails', { headers })
        ])

        if (!uRes.ok) throw new Error('user fetch failed')

        ghUser = await uRes.json()
        ghEmails = eRes.ok ? await eRes.json() : []
    } catch { return res.status(500).json({ error: 'github api error' }) }

    const primaryEmail =
        Array.isArray(ghEmails)
            ? ghEmails.find(e => e.primary && e.verified)?.email || null
            : null

    const ts = Date.now()
    const userData = `${ghUser.login}:${ghUser.id}:${ts}`

    const sig = createHmac('sha256', sigSecret)
        .update(userData)
        .digest('hex')

    const user = {
        login: ghUser.login,
        id: ghUser.id,
        avatar_url: ghUser.avatar_url,
        email: primaryEmail
    }

    const payload = encodeURIComponent(JSON.stringify({
        user,
        userData,
        sig
    }))

    res.setHeader('Content-Type', 'text/html')
    res.send(`<!doctype html><meta charset="utf-8"><script>location.href=${JSON.stringify(returnUrl)}+'?authed=1&auth='+${JSON.stringify(payload)}</script>`)
}