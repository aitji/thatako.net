export default function handler(req, res) {
    const clientId = process.env.GITHUB_CLIENT_ID
    const returnUrl = req.query.return || '/'

    if (!clientId) return res.status(500).json({ error: 'GITHUB_CLIENT_ID not configured' })

    const state = Buffer.from(returnUrl).toString('base64url')

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: `https://${req.headers.host}/api/callback`,
        scope: 'read:user user:email',
        state,
    })

    res.redirect(302, `https://github.com/login/oauth/authorize?${params}`)
}