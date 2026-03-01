import { createHmac } from 'crypto' // is this alr have in nodejs?

export default async function handler(req, res) {
    const { code, state } = req.query
    const clientId = process.env.GITHUB_CLIENT_ID
    const clientSecret = process.env.GITHUB_CLIENT_SECRET
    const sigSecret = process.env.SIG_SECRET

    if (!code) return res.status(400).json({ error: 'missing code' })
    if (!clientId || !clientSecret || !sigSecret) return res.status(500).json({ error: 'server misconfigured, try again later' })

    // exchange code for access token
    let accessToken
    try {
        const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
        })
        const tokenJson = await tokenRes.json()
        if (tokenJson.error) throw new Error(tokenJson.error_description || tokenJson.error)
        accessToken = tokenJson.access_token
    } catch (e) {
        return res.status(400).json({ error: 'token exchange failed: ' + e.message })
    }

    // fetch github user
    let ghUser, ghEmails
    try {
        const [uRes, eRes] = await Promise.all([
            fetch('https://api.github.com/user', { headers: { Authorization: `token ${accessToken}`, 'User-Agent': 'thatako.net' } }),
            fetch('https://api.github.com/user/emails', { headers: { Authorization: `token ${accessToken}`, 'User-Agent': 'thatako.net' } }),
        ])
        ghUser = await uRes.json()
        ghEmails = await eRes.json()
    } catch (e) {
        return res.status(500).json({ error: 'GitHub API error' })
    }

    const primaryEmail = Array.isArray(ghEmails)
        ? (ghEmails.find(e => e.primary && e.verified)?.email || null)
        : null

    // build user data + sig
    // userData format: github_login:github_id:timestamp
    const ts = Date.now()
    const userData = `${ghUser.login}:${ghUser.id}:${ts}`
    const sig = createHmac('sha256', sigSecret).update(userData).digest('hex')

    // decode url
    let returnUrl = '/'
    try { returnUrl = Buffer.from(state || '', 'base64url').toString('utf8') || '/' } catch { }

    const user = {
        login: ghUser.login,
        id: ghUser.id,
        avatar_url: ghUser.avatar_url,
        email: primaryEmail,
    }

    // A: application/json
    if (req.headers.accept?.includes('application/json')) return res.json({ user, userData, sig, token: accessToken })

    const authPayload = encodeURIComponent(JSON.stringify({
        user,
        userData,
        sig,
        token: accessToken,
    }))

    res.setHeader('Content-Type', 'text/html')
    res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>auth...</title></head>
<body><script>
  window.location.href = ${JSON.stringify(returnUrl)} + '?authed=1&auth=' + ${JSON.stringify(authPayload)}
</script></body></html>`)
}