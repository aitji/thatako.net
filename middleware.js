const ASSET_EXTS = ['js', 'css', 'json', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'woff', 'woff2', 'ttf', 'eot', 'webp', 'mp4', 'webm', 'pdf']
let cacheRoutes = null
const version = 'v0.5-alpha'

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
  const { pathname } = new URL(request.url)
  const ext = pathname.split('.').pop()?.toLowerCase()

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
  if (isSpaRoute) return fetch(new URL('/index.html', request.url))

  return null
}