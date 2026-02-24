import fs from 'fs'
import http from 'http'
import https from 'https'
import path from 'path'
import { spawn } from 'child_process'

const USE_HTTPS = process.argv.includes('--https')
const PORT = parseInt(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] ?? (USE_HTTPS ? '3443' : '3000'))
const OUT = 'public'

let spaRoutes = []

// fetch spa routes from routes.json
const loadSpaRoutes = () => {
    try {
        const routesFile = path.join('src', 'routes.json')
        if (fs.existsSync(routesFile)) {
            const data = JSON.parse(fs.readFileSync(routesFile, 'utf8'))
            spaRoutes = data.routes.map(r => r.path)
            console.log(`[server] loaded spa routes: ${spaRoutes.join(', ')}`)
        }
    } catch (e) {
        console.error('[server] failed to load routes:', e)
        spaRoutes = ['/', '/about'] // fallback
    }
}

// watch routes.json & reload on change
let routesWatchTimer = null
fs.watch(path.join('src', 'routes.json'), () => {
    clearTimeout(routesWatchTimer)
    routesWatchTimer = setTimeout(() => {
        loadSpaRoutes()
        console.log('[server] routes reloaded')
    }, 250)
})

loadSpaRoutes()

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.pdf': 'application/pdf',
}

const LIVERELOAD_SCRIPT = `
<script>
(function () {
    try { new EventSource('/__livereload').close() }
    catch (e) { return console.warn('[live] EventSource not supported, live reload disabled') }

    try {
        const es = new EventSource('/__livereload')
        es.onmessage = () => { es.close(); location.reload() }
        es.onerror = () => {
            if (es.readyState === EventSource.CLOSED) return
            setTimeout(() => location.reload(), 1000)
        }
        console.log('[live] socket connected successfully')
    } catch (e) {}
})()
</script>`

const clients = new Set()
const broadcastReload = () => {
    for (const res of clients) {
        try { res.write('data: reload\n\n') } catch { }
    }
    console.log(`[live] reload → ${clients.size} client(s)`)
}

let reloadTimer = null
fs.watch(OUT, { recursive: true }, () => {
    clearTimeout(reloadTimer)
    reloadTimer = setTimeout(broadcastReload, 250)
})

const serveHTML = (res, filePath, statusCode = 200) => {
    let html = fs.readFileSync(filePath, 'utf8')
    html = html.includes('</body>')
        ? html.replace('</body>', `${LIVERELOAD_SCRIPT}\n</body>`)
        : html + LIVERELOAD_SCRIPT
    res.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(html)
}

const handler = (req, res) => {
    const url = req.url.split('?')[0]

    if (url === '/__livereload') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        })
        res.write(': connected\n\n')
        clients.add(res)
        req.on('close', () => clients.delete(res))
        return
    }

    let filePath = path.join(OUT, url)

    // validate res-path ; ensure it stays within the root dir (OUT) to prevent path traversal
    try {
        const rootDir = path.resolve(OUT)
        // First resolve the requested path relative to the root directory
        const candidatePath = path.resolve(rootDir, '.' + path.sep + url.replace(/^\//, ''))
        const normalizedPath = fs.existsSync(candidatePath)
            ? fs.realpathSync(candidatePath)
            : candidatePath

        if (!normalizedPath.startsWith(rootDir + path.sep) && normalizedPath !== rootDir) {
            // path escapes root dir ; reject it
            const notFound = path.join(OUT, '404.html')
            if (fs.existsSync(notFound)) serveHTML(res, notFound, 404)
            else {
                res.writeHead(404)
                res.end('404 Not Found')
            }

            return
        }

        filePath = normalizedPath
    } catch (e) {
        // path res fails, reject the request
        const notFound = path.join(OUT, '404.html')
        if (fs.existsSync(notFound)) {
            serveHTML(res, notFound, 404)
        } else {
            res.writeHead(404)
            res.end('404 Not Found')
        }
        return
    }

    // directory → index.html
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html')

    let fileExists = fs.existsSync(filePath) // check if file exists
    if (!fileExists && !path.extname(filePath)) { // extension files → try .html
        const withHtml = filePath + '.html'
        // check .html variant is also within root dir --(CodeQL) prevent path traversal
        const rootDir = path.resolve(OUT)
        const resolvedHtmlPath = path.resolve(withHtml)
        if ((resolvedHtmlPath.startsWith(rootDir + path.sep) || resolvedHtmlPath === rootDir) && fs.existsSync(withHtml)) {
            filePath = withHtml
            fileExists = true
        }
    }

    if (fileExists) { // file exists, serve it
        const ext = path.extname(filePath).toLowerCase()
        const mime = MIME[ext] ?? 'application/octet-stream'

        if (ext === '.html') {
            serveHTML(res, filePath, 200)
        } else {
            const data = fs.readFileSync(filePath)
            res.writeHead(200, { 'Content-Type': mime })
            res.end(data)
        }
        return
    }

    // file not found - check spa routes
    const ext = path.extname(filePath).toLowerCase()
    const isAsset = ext && ['.js', '.css', '.json', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.webp', '.mp4', '.webm', '.pdf'].includes(ext)

    // check spa routes
    const normPath = url.replace(/\/$/, '') || '/'
    const isSpaRoute = spaRoutes.some(route => {
        const normRoute = route.replace(/\/$/, '') || '/'
        return normRoute === normPath
    })

    if (isSpaRoute && !isAsset) {
        const indexPath = path.join(OUT, 'index.html')
        if (fs.existsSync(indexPath)) {
            serveHTML(res, indexPath, 200)
            return
        }
    }

    // 404 not found
    const notFound = path.join(OUT, '404.html')
    if (fs.existsSync(notFound)) {
        serveHTML(res, notFound, 404)
    } else {
        res.writeHead(404)
        res.end('404 Not Found')
    }
}

let server

if (USE_HTTPS) {
    const certFile = process.argv.find(a => a.startsWith('--cert='))?.split('=')[1] ?? 'localhost+2.pem'
    const keyFile = process.argv.find(a => a.startsWith('--key='))?.split('=')[1] ?? 'localhost+2-key.pem'

    if (!fs.existsSync(certFile) || !fs.existsSync(keyFile)) {
        console.error(`[error] SSL cert/key not found: ${certFile}, ${keyFile}`)
        console.error('        Generate with: mkcert localhost')
        process.exit(1)
    }

    server = https.createServer({
        cert: fs.readFileSync(certFile),
        key: fs.readFileSync(keyFile),
    }, handler)
} else server = http.createServer(handler)

server.listen(PORT, () => {
    const proto = USE_HTTPS ? 'https' : 'http'
    console.log(`\n  [live] Server running at ${proto}://localhost:${PORT}`)
    console.log(`  [live] Watching: ${OUT}/`)
    console.log(`  [live] Press Ctrl+C to stop\n`)
})

const builder = spawn('node', ['build.js', '--watch'], { stdio: 'inherit' })
builder.on('close', code => {
    if (code !== 0) console.error(`[build] exited with code ${code}`)
})
process.on('exit', () => builder.kill())
process.on('SIGINT', () => { builder.kill(); process.exit() })