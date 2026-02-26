import "./zLib/tooltip.js"

// theme manager
const THEME_KEY = 'site-theme-preference'
const themes = { SYSTEM: 'system', LIGHT: 'light', DARK: 'dark' }

function getThemePreference() {
  return localStorage.getItem(THEME_KEY) || themes.SYSTEM
}

function setThemePreference(theme) {
  if (!Object.values(themes).includes(theme)) return
  localStorage.setItem(THEME_KEY, theme)
  applyTheme(theme)
}

function applyTheme(theme) {
  const html = document.documentElement
  if (theme === themes.SYSTEM) {
    html.removeAttribute('data-theme')
    html.style.colorScheme = ''
  } else if (theme === themes.LIGHT) {
    html.setAttribute('data-theme', 'light')
    html.style.colorScheme = 'light'
  } else if (theme === themes.DARK) {
    html.setAttribute('data-theme', 'dark')
    html.style.colorScheme = 'dark'
  }
  window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme } }))
}

function getEffectiveTheme() {
  const pref = getThemePreference()
  if (pref === themes.SYSTEM) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? themes.DARK : themes.LIGHT
  }
  return pref
}

const awaitEl = async (id) => new Promise(resolve => {
  const el = document.getElementById(id)
  if (el) return resolve(el)

  const observer = new MutationObserver(() => {
    const found = document.getElementById(id)
    if (!found) return
    observer.disconnect()
    resolve(found)
  })

  observer.observe(document.body, { childList: true, subtree: true })
})

// footer
function injectFooter(opts = {}) {
  const year = opts.year ?? new Date().getFullYear()
  const version = opts.version ?? ''

  const footer = document.createElement('footer')
  footer.className = 'site-footer'
  footer.setAttribute('role', 'contentinfo')

  footer.innerHTML = `
    <span>&copy${year} <a href="https://thatako.net">thatako.net</a>&trade;</span>
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

// search
function initSearch() {
  const input = document.querySelector('.topbar-search input')
  if (!input) return

  document.addEventListener('keydown', e => {
    const isTyping = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)

    if (!isTyping && (e.key === '/' || (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
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

// theme switcher UI
function initThemeSwitcher(containerId = 'theme-switcher') {
  const container = document.getElementById(containerId)
  if (!container) return

  const switcher = document.createElement('div')
  switcher.className = 'theme-switcher-group'
  switcher.setAttribute('aria-label', 'Theme selector')

  const buttons = [
    { class: 'theme-btn-system', icon: 'fa-desktop', label: 'ธีมระบบ', theme: themes.SYSTEM },
    { class: 'theme-btn-light', icon: 'fa-sun', label: 'ธีมสีอ่อน', theme: themes.LIGHT },
    { class: 'theme-btn-dark', icon: 'fa-moon', label: 'ธีมสีเข้ม', theme: themes.DARK }
  ]

  buttons.forEach(btn => {
    const button = document.createElement('button')
    button.className = `theme-btn ${btn.class}`
    button.setAttribute('aria-label', btn.label + ' theme')
    button.setAttribute('title', btn.label)
    button.innerHTML = `<i class="fas ${btn.icon}"></i>`
    button.addEventListener('click', () => {
      setThemePreference(btn.theme)
      updateActive(btn.theme)
    })
    switcher.appendChild(button)
  })

  function updateActive(theme) {
    switcher.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'))
    switcher.querySelector(`.theme-btn-${theme === themes.SYSTEM ? 'system' : theme === themes.LIGHT ? 'light' : 'dark'}`).classList.add('active')
  }

  updateActive(getThemePreference())
  window.addEventListener('theme-changed', e => updateActive(e.detail.theme))
  container.appendChild(switcher)
}

const version = "v0.5-alpha"
const _opts = {
  footer: true,
  search: true,
  themeSwitcher: true,
  footerOpts: { version }
}

// boot & init
function _boot(opts) {
  const {
    footer = true,
    search = true,
    themeSwitcher = true,
    footerOpts = {},
  } = opts

  localStorage.setItem('v', version)
  if (search) initSearch()
  if (themeSwitcher) initThemeSwitcher()
  // (toc) handled by router
  if (footer) injectFooter(footerOpts)
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => _boot(_opts))
else _boot(_opts)

export { injectFooter, initToc, initSearch, initThemeSwitcher, getThemePreference, setThemePreference, getEffectiveTheme }