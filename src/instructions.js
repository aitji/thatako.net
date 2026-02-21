// sidebar
function initSidebar() {
  document.querySelectorAll('.sb-section-toggle').forEach(btn => {
    const targetId = btn.dataset.target
    const body = document.getElementById(targetId)
    const chevron = document.getElementById(targetId + '-chevron')
    if (!body) return

    btn.addEventListener('click', () => {
      const isOpen = body.classList.toggle('open')
      if (chevron) chevron.style.transform = isOpen ? 'rotate(90deg)' : ''
    })

    if (body.querySelector('.sb-link.active')) {
      body.classList.add('open')
      if (chevron) chevron.style.transform = 'rotate(90deg)'
    }
  })

  document.querySelectorAll('.sb-link').forEach(link => {
    link.addEventListener('click', function () {
      if (this.getAttribute('target') === '_blank') return
      setActiveSidebarLink(this)
    })
  })

  syncSidebarToUrl()

  const menuToggle = document.getElementById('menuToggle')
  const sidebar = document.getElementById('sidebar')
  const overlay = document.getElementById('sidebarOverlay')
  if (!menuToggle || !sidebar || !overlay) return

  menuToggle.addEventListener('click', () => {
    if (sidebar.classList.contains('open')) return closeSidebar()

    sidebar.classList.add('open')
    overlay.classList.add('open')
    menuToggle.setAttribute('aria-expanded', 'true')
  })

  const closeSidebar = () => {
    sidebar.classList.remove('open')
    overlay.classList.remove('open')
    menuToggle.setAttribute('aria-expanded', 'false')
  }

  overlay.addEventListener('click', closeSidebar)
  sidebar.querySelectorAll('.sb-link').forEach(link =>
    link.addEventListener('click', () =>
      (
        window.innerWidth <= 680 &&
        link.getAttribute('target') !== '_blank'
      ) && closeSidebar()
    )
  )

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) {
      closeSidebar()
      menuToggle.focus()
    }
  })
}

function setActiveSidebarLink(el) {
  document.querySelectorAll('.sb-link').forEach(l => l.classList.remove('active'))
  el.classList.add('active')

  const sectionBody = el.closest('.sb-section-body')
  if (sectionBody && !sectionBody.classList.contains('open')) {
    sectionBody.classList.add('open')
    const chevronId = sectionBody.id + '-chevron'
    const chevron = document.getElementById(chevronId)
    if (chevron) chevron.style.transform = 'rotate(90deg)'
  }
}

function syncSidebarToUrl() {
  const path = window.location.pathname.replace(/\/$/, '') || '/'
  const links = document.querySelectorAll('.sb-link[data-page], .sb-link[href]')

  let matched = null
  links.forEach(link => {
    const page = link.dataset.page || link.getAttribute('href')
    if (!page || link.getAttribute('target') === '_blank') return
    if (page === path || page === window.location.hash) matched = link
  })

  if (matched) setActiveSidebarLink(matched)
}

function injectFooter(opts = {}) {
  const year = opts.year || new Date().getFullYear()
  const version = opts.version || ''

  const footer = document.createElement('footer')
  footer.className = 'site-footer'
  footer.setAttribute('role', 'contentinfo')

  footer.innerHTML = `
    <span>&copy${year} <a href="https://thatako.net">thatako.net</a>&trade</span>
    <span class="footer-dot">·</span>
    <span>not (currently) official - but there's a plan for it <em>*wink*</em></span>
    <div class="footer-right">
      ${version ? `<span>${version}</span><span class="footer-dot">·</span>` : ''}
      <a href="mailto:aitji@duck.com">aitji@duck.com</a>
      <span class="footer-dot">·</span>
      <a href="https://github.com/aitji/thatako.net" target="_blank" rel="noopener">GitHub</a>
    </div>
  `

  if (opts.insertBefore) {
    const ref = document.querySelector(opts.insertBefore)
    if (ref) return ref.parentNode.insertBefore(footer, ref)
  }

  document.body.appendChild(footer)
}

// toc highlight
function initToc() {
  const links = [...document.querySelectorAll('.toc-link[href^="#"]')]
  if (!links.length) return

  const sections = links
    .map(l => {
      const id = l.getAttribute('href').slice(1)
      const el = document.getElementById(id)
      return el ? { id, el } : null
    })
    .filter(Boolean)

  if (!sections.length) return

  const setActive = id => links.forEach(l => l.classList.toggle('active', l.getAttribute('href') === '#' + id))
  const offset = 140

  const onScroll = () => {
    const scrollBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2

    if (scrollBottom) {
      setActive(sections[sections.length - 1].id)
      return
    }

    let current = sections[0].id

    for (const s of sections) {
      const top = s.el.getBoundingClientRect().top - offset
      if (top <= 0) current = s.id
      else break
    }

    setActive(current)
  }

  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
}

/** ---------- search ---------- */
function initSearch() {
  const input = document.querySelector('.topbar-search input')
  if (!input) return

  document.addEventListener('keydown', e => {
    const isTyping = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)

    if (!isTyping && (e.key === '/' || (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'k') || e.key.toLowerCase() === 'f')) {
      e.preventDefault()
      input.focus()
      input.select()
    }

    if (e.key === 'Escape' && document.activeElement === input) input.blur()
  })

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase()
    const groups = document.querySelectorAll('.sb-group')

    if (!q) {
      document.querySelectorAll('.sb-link, .sb-section-toggle').forEach(el => el.style.display = '')
      groups.forEach(g => g.style.display = '')
      return
    }

    groups.forEach(group => {
      let has = false
      group.querySelectorAll('.sb-link').forEach(link => {
        const show = link.textContent.toLowerCase().includes(q)
        link.style.display = show ? '' : 'none'
        if (show) has = true
      })
      group.style.display = has ? '' : 'none'
    })
  })
}

// boot & init
function _boot(opts) {
  const {
    footer = true,
    toc = true,
    search = true,
    footerOpts = {},
  } = opts

  initSidebar()
  if (search) initSearch()
  if (toc) initToc()
  if (footer) injectFooter(footerOpts)
}

const _opts = {
  footer: true,
  toc: true,
  search: true,
  footerOpts: {
    version: 'v0.3-alpha',
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => _boot(_opts))
else _boot(_opts)

export { initSidebar, injectFooter, initToc, initSearch }