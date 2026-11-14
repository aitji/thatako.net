const ASSET_EXTS = ['js', 'css', 'json', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'woff', 'woff2', 'ttf', 'eot', 'webp', 'mp4', 'webm', 'pdf']
let cacheRoutes = null
const version = 'v0.7-alpha'

const addHeaders = (res, cors = false) => {
  const headers = new Headers(res.headers)

  if (cors) {
    headers.set('Access-Control-Allow-Origin', 'https://go.thatako.net')
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    headers.set('Access-Control-Max-Age', '86400')
    headers.append('Vary', 'Origin')
  }

  const csp = headers.get('content-security-policy')
  if (csp?.includes('connect-src')) headers.set('content-security-policy', csp.replace(/connect-src([^;]*)/, (m) => m.includes('https://thatako.net') ? m : m + ' https://thatako.net'))

  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

async function getSpaRoutes(request) {
  if (cacheRoutes) return cacheRoutes

  try {
    const url = new URL('/routes.json', request.url)
    const res = await fetch(url + "?v=" + version)
    const data = await res.json()
    cacheRoutes = data.routes.map(r => r.path)
    return cacheRoutes
  } catch (e) {
    console.error('failed to load routes:', e)
    return ['/', '/about'] // fallback, if this happens ; it bad tell me
  }
}

export default async function middleware(request) {
  const { pathname, hostname } = new URL(request.url)
  const ext = pathname.split('.').pop()?.toLowerCase()

  if (['thatako.net', 'go.thatako.net'].includes(hostname) && request.method === 'OPTIONS') {
    return addHeaders(new Response(null, { status: 204 }), true)
  }

  const isAsset = ASSET_EXTS.includes(ext) // assets passthrough
  const isSpecial = pathname.startsWith('/.well-known')

  if (isAsset || isSpecial) return null
  const SPA_ROUTES = await getSpaRoutes(request)

  // handle spa routes
  const normalizePath = pathname.replace(/\/$/, '') || '/'
  const isSpaRoute = SPA_ROUTES.some(route => {
    const normalizedRoute = route.replace(/\/$/, '') || '/'
    return normalizedRoute === normalizePath
  })

  // index.html for spa routing
  if (isSpaRoute) return addHeaders(await fetch(new URL('/index.html', request.url)))

  return null
}