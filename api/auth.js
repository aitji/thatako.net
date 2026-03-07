export default function handler(req, res) {
    const clientId = process.env.GITHUB_CLIENT_ID
    const returnUrl = req.query.return || '/'

    if (!clientId) return res.status(500).json({ error: 'GITHUB_CLIENT_ID not configured' })

    const safeReturn = returnUrl.startsWith('/') ? returnUrl : '/'

    const state = Buffer.from(safeReturn).toString('base64url')

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: `https://${req.headers.host}/api/callback`,
        scope: 'read:user user:email',
        state
    })

    res.redirect(`https://github.com/login/oauth/authorize?${params}`)
}