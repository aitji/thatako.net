let routesConfig = null
const version = localStorage.getItem('v') || 'v0.5-alpha'

const SKELETON_TEMPLATE = `
<div class="skeleton-layout">
  <div>
    <!-- hero section skeleton -->
    <div class="skeleton-hero">
      <div class="skeleton-eyebrow skeleton"></div>
      <div class="skeleton-h1 skeleton"></div>

      <div class="skeleton-meta">
        <div class="skeleton-meta-item skeleton"></div>
        <div class="skeleton-meta-item skeleton"></div>
        <div class="skeleton-meta-item skeleton"></div>
      </div>

      <div class="skeleton-desc">
        <div class="skeleton-desc-line skeleton"></div>
        <div class="skeleton-desc-line skeleton"></div>
        <div class="skeleton-desc-line skeleton"></div>
        <div class="skeleton-desc-line skeleton"></div>
      </div>

      <div class="skeleton-actions">
        <div class="skeleton-btn skeleton"></div>
        <div class="skeleton-btn skeleton"></div>
      </div>
    </div>

    <!-- content sections skeleton -->
    <div class="skeleton-section">
      <div class="skeleton-heading skeleton"></div>
      <div class="skeleton-paragraph">
        <div class="skeleton-line skeleton"></div>
        <div class="skeleton-line skeleton"></div>
        <div class="skeleton-line skeleton"></div>
      </div>
    </div>

    <div class="skeleton-section">
      <div class="skeleton-heading skeleton"></div>
      <div class="skeleton-paragraph">
        <div class="skeleton-line skeleton"></div>
        <div class="skeleton-line skeleton"></div>
        <div class="skeleton-line skeleton"></div>
      </div>
    </div>

    <div class="skeleton-section">
      <div class="skeleton-heading skeleton"></div>
      <div class="skeleton-paragraph">
        <div class="skeleton-line skeleton"></div>
        <div class="skeleton-line skeleton"></div>
        <div class="skeleton-line skeleton"></div>
      </div>
    </div>
  </div>

  <!-- toc skeleton (hidden on mobile) -->
  <aside class="skeleton-toc">
    <div class="skeleton-toc-item main skeleton"></div>
    <div class="skeleton-toc-item sub skeleton"></div>
    <div class="skeleton-toc-item sub skeleton"></div>
    <div class="skeleton-toc-item main skeleton"></div>
    <div class="skeleton-toc-item main skeleton"></div>
  </aside>
</div>`

const router = {
  contentEl: null,
  mainEl: null,
  currentRoute: null,
  cache: new Map(),
  skeletonContainer: null,

  async init(mainSelector = '.main') {
    this.mainEl = document.querySelector(mainSelector)
    this.contentEl = document.querySelector('.content') || this.mainEl

    if (!this.contentEl) {
      console.error('router: .content element not found')
      return
    }

    // load routes configuration
    try {
      const res = await fetch('/routes.json?v=' + version)
      if (!res.ok) throw new Error(`Failed to load routes.json`)
      routesConfig = await res.json()
    } catch (err) {
      console.error('router: Could not load routes.json', err)
      return
    }

    // back/forward buttons
    window.addEventListener('popstate', () => { this.navigateToUrl(window.location.pathname, false) })

    // init load ; nav not already loaded
    const initialPath = window.location.pathname
    if (this.getRouteFile(initialPath)) {
      this.navigateToUrl(initialPath, false)
    }
  },

  getRouteFile(path) {
    path = path.replace(/\/$/, '') || '/'
    if (!routesConfig?.routes) return null
    return routesConfig.routes.find(r => r.path === path)?.file ?? null
  },

  async navigateToUrl(path, updateHistory = true) {
    if (typeof path !== 'string') {
      console.error('router: path not string:', path)
      return
    }

    path = path.replace(/\/$/, '') || '/'

    // skip if already loaded
    if (this.currentRoute === path) return

    this.currentRoute = path
    const file = this.getRouteFile(path)

    if (!file) {
      // route not in spa config, fall back to server
      console.warn(`router: "${path}" not in routes, fallback to server`)
      window.location.href = path
      return
    }

    // show skeleton
    if (!this.cache.has(file)) this.showSkeleton()

    try {
      const html = await this.loadHTML(file)
      this.renderContent(html, path, updateHistory)
    } catch (error) {
      console.error(`router: Failed to load ${file}`, error)
      this.hideSkeleton()
      // this.render404(path)
    }
  },

  async loadHTML(filePath) {
    if (this.cache.has(filePath)) return this.cache.get(filePath)

    const response = await fetch(filePath)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const html = await response.text()
    this.cache.set(filePath, html)
    return html
  },

  renderContent(html, path, updateHistory = true) {
    if (updateHistory && window.location.pathname !== path) history.pushState({ path }, '', path)

    // parse html & extract toc
    const tempDiv = document.createElement('div')
    tempDiv.innerHTML = html

    // get inline toc
    const inlineToc = tempDiv.querySelector('.toc-inline')
    let tocContent = null
    if (inlineToc) {
      tocContent = inlineToc.innerHTML
      inlineToc.remove()
    }

    this.contentEl.innerHTML = tempDiv.innerHTML
    this.hideSkeleton()

    // main toc
    const mainToc = document.querySelector('.toc')
    if (mainToc && tocContent) mainToc.innerHTML = tocContent
    else if (mainToc) mainToc.innerHTML = '<div class="toc-label">on this page</div><p style="color: var(--text-muted); font-size: 0.9rem;">no headings</p>'

    // re-init features
    setTimeout(() => {
      if (window.initToc) initToc()
      if (window.initSearch) initSearch()
      if (window.syncSidebarToUrl) syncSidebarToUrl()
    }, 0)
    window.scrollTo(0, 0)
  },

  render404(path) {
    return null // normal path
    const html = `
      <div class="hero">
        <h1><span class="status-code">404</span> Not Found</h1>
        <p>ไม่พบหน้าสำหรับ <code>${this.escape(path)}</code></p>
      </div>
      <div class="callout warn">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <p>เส้นทางนี้ไม่มีไฟล์เอกสาร โปรดตรวจสอบ URL หรือใช้ Sidebar เพื่อนำทาง</p>
      </div>`
    this.contentEl.innerHTML = html
  },

  escape(str) {
    const div = document.createElement('div')
    div.textContent = str
    return div.innerHTML
  },

  navigate(path) {
    this.navigateToUrl(path, true)
  },

  showSkeleton() {
    // remove existing skeleton if any
    if (this.skeletonContainer) this.skeletonContainer.remove()

    // create and insert skeleton
    this.skeletonContainer = document.createElement('div')
    this.skeletonContainer.className = 'skeleton-container'
    this.skeletonContainer.innerHTML = SKELETON_TEMPLATE

    this.contentEl.innerHTML = ''
    this.contentEl.appendChild(this.skeletonContainer)
  },

  hideSkeleton() {
    if (this.skeletonContainer) {
      this.skeletonContainer.classList.add('fade-out')
      setTimeout(() => {
        if (this.skeletonContainer && this.skeletonContainer.parentNode) {
          this.skeletonContainer.remove()
          this.skeletonContainer = null
        }
      }, 300)
    }
  },
}

export { router }
