/**
 * schema
 * {
 *   title: string,
 *   href: string,
 *   icon: string,
 *   external: boolean,             // opens in new tab + shows external icon
 *   badge: { text, color },
 *   active: boolean,               // force-active this link on load
 *   section: boolean,              // make this collapsible section header
 *   items: [...],                  // child items when section: active
 *   callout: { type, icon, text }  // inline callout block (no href needed)
 * }
 * ─────────────────────────────────────────────────────────────────────────────
 */

let _router = null
const setRouter = r => { _router = r }

const createDot = (pathname) => {
    var p = pathname || window.location.pathname
    var parts =
        p === '/' || p === '/index.html' || p === './'
            ? []
            : (p.endsWith('.html') ? p.split('/').slice(0, -1) : p.split('/'))
    return parts.length <= 1 ? './' : '../'.repeat(parts.length - 1)
}

let _sectionCounter = 0
const nextSectionId = () => 'sb-section-' + ++_sectionCounter

// dom builder
const el = (tag, attrs, children) => {
    var node = document.createElement(tag)
    if (attrs) {
        Object.keys(attrs).forEach((k) => {
            // apply tag
            switch (tag) {
                case 'p':
                case 'span':
                    node.title = attrs[k]
                    break
                case 'i':
                    node.title = 'ไอคอน'
                    break
                case 'div':
                    if (attrs.className && attrs.className.includes('sb-group-label'))
                        node.title = attrs[k]
                    break
                default: break
            }

            // apply attribute
            switch (k) {
                case 'className':
                    node.className = attrs[k]
                    break
                case 'textContent':
                    node.textContent = attrs[k]
                    break
                case 'innerHTML':
                    node.innerHTML = attrs[k]
                    break
                default:
                    node.setAttribute(k, attrs[k])
                    break
            }

        })
    }

    if (children) children.forEach((c) => (c && node.appendChild(c)))
    return node
}

const icon = (cls) => el('i', { className: cls, 'aria-hidden': 'true' })
const buildBadge = (badge) => (!badge) ? null : el('span', { className: 'sb-badge ' + (badge.color || ''), textContent: badge.text })
const buildExternalIcon = () => el('i', { className: 'fa-solid fa-arrow-up-right-from-square sb-ext', 'aria-hidden': 'true' })
const buildCallout = (callout) => el('div',
    { className: 'callout ' + (callout.type || '') },
    [(callout.icon) ? el('i', { className: callout.icon }) : null, el('p', { textContent: callout.text })]
)

const buildLink = (item) => {
    if (item.callout) return buildCallout(item.callout)

    var attrs = { className: 'sb-link', href: item.href || '#' }
    if (item.external) {
        attrs.target = '_blank'
        attrs.rel = 'noopener'
    }
    if (item.active) attrs.className += ' active'

    var children = [icon(item.icon)]
    children.push(el('span', { textContent: item.title }))
    if (item.badge) children.push(buildBadge(item.badge))
    if (item.external) children.push(buildExternalIcon())

    return el('a', attrs, children)
}

const buildSection = (item) => {
    var id = nextSectionId()
    var chevronId = id + '-chevron'

    var btn = el('button', {
        className: 'sb-section-toggle',
        'data-target': id,
        'aria-expanded': 'false',
    }, [
        icon(item.icon),
        el('span', { textContent: item.title }),
        el('i', { className: 'fa-solid fa-chevron-right sb-chevron', id: chevronId, 'aria-hidden': 'true' }),
    ])

    var body = el('div', { className: 'sb-section-body', id: id, role: 'group' })
        ; (item.items || []).forEach((child) => body.appendChild(child.section ? buildSection(child) : buildLink(child)))

    var wrapper = el('div', { className: 'sb-section' }, [btn, body])
    return wrapper
}

const buildGroup = (group) => {
    var div = el('div', { className: 'sb-group' })
    if (group.label) div.appendChild(el('div', { className: 'sb-group-label', textContent: group.label }))
        ; (group.items || []).forEach((item) => div.appendChild(item.section ? buildSection(item) : buildLink(item)))
    return div
}

const buildSidebar = (config) => {
    var inner = el('div', { className: 'sidebar-inner' })
        ; (config.groups || []).forEach((g) => inner.appendChild(buildGroup(g)))

    var nav = el('nav', {
        className: 'sidebar',
        id: 'sidebar',
        'aria-label': 'เมนูหลัก',
    }, [inner])


    var footer = el('div', { className: 'sidebar-footer' }, [
        el('span', { className: 'sf-dot pulse', 'aria-hidden': 'true' }),
        el('a', { href: '#blogs', className: 'unnoticed-link', textContent: 'all systems up   ·   thatako.net' })
    ])
    nav.appendChild(footer)

    return nav
}

// inject sidebar
const injectSidebar = (config) => {
    var existing = document.getElementById('sidebar')
    if (existing) return existing

    var nav = buildSidebar(config)

    // find <layout>, <main>, or <body>
    var layout =
        document.querySelector('[data-sidebar-host]') ||
        document.querySelector('body > layout') ||
        document.body

    layout.insertBefore(nav, layout.firstChild)
    return nav
}

// overlay & hamburger
const ensureOverlay = () => (!document.getElementById('sidebarOverlay'))
    && document.body.appendChild(el('div', {
        id: 'sidebarOverlay',
        className: 'sidebar-overlay',
        'aria-hidden': 'true'
    }))

const ensureMenuToggle = () => (!document.getElementById('menuToggle'))
    && document.body.insertBefore(
        el('button', {
            id: 'menuToggle',
            className: 'sidebar-menu-toggle',
            'aria-label': 'เปิด/ปิดเมนู',
            'aria-expanded': 'false',
            innerHTML: '<i class="fa-solid fa-bars" aria-hidden="true"></i>',
        }),
        document.body.firstChild
    )

// active link
const setActiveSidebarLink = (el) => {
    document.querySelectorAll('.sb-link').forEach((l) => l.classList.remove('active'))
    el.classList.add('active')

    var sectionBody = el.closest('.sb-section-body')
    if (sectionBody && !sectionBody.classList.contains('open')) openSection(sectionBody)
}

const openSection = (body) => {
    body.classList.add('open')
    var chevron = document.getElementById(body.id + '-chevron')
    if (chevron) chevron.style.transform = 'rotate(90deg)'
    var btn = document.querySelector('[data-target="' + body.id + '"]')
    if (btn) btn.setAttribute('aria-expanded', 'true')
}

const closeSection = (body) => {
    body.classList.remove('open')
    var chevron = document.getElementById(body.id + '-chevron')
    if (chevron) chevron.style.transform = ''
    var btn = document.querySelector('[data-target="' + body.id + '"]')
    if (btn) btn.setAttribute('aria-expanded', 'false')
}

const syncSidebarToUrl = () => {
    var path = window.location.pathname.replace(/\/$/, '') || '/'
    var hash = window.location.hash
    var links = document.querySelectorAll('.sb-link[href]')
    var matched = null

    links.forEach((link) => {
        if (link.getAttribute('target') === '_blank') return
        var href = link.getAttribute('href')
        if (!href) return

        // strip trailing slash ;+relative hrefs
        try {
            var abs = new URL(href, window.location.href)
            var absPath = abs.pathname.replace(/\/$/, '') || '/'
            if (absPath === path && (!hash || abs.hash === hash)) matched = link
            else if (absPath === path && !matched) matched = link
        } catch (e) {
            if (href === path || href === hash) matched = link
        }
    })

    if (matched) setActiveSidebarLink(matched)
}

// event wire
const initEvents = () => {
    // toggle
    document.querySelectorAll('.sb-section-toggle').forEach((btn) => {
        var targetId = btn.dataset.target
        var body = document.getElementById(targetId)
        if (!body) return

        btn.addEventListener('click', () => {
            if (body.classList.contains('open')) closeSection(body)
            else openSection(body)
        })

        // auto open IF child link is active
        if (body.querySelector('.sb-link.active')) openSection(body)
    })

    // link clicks
    document.querySelectorAll('.sb-link').forEach((link) =>
        link.addEventListener('click', (e) => {
            if (link.getAttribute('target') === '_blank') return
            
            const href = link.getAttribute('href')
            if (_router && href && !href.startsWith('http') && !href.startsWith('mailto:')) {
                e.preventDefault()
                setActiveSidebarLink(link)
                _router.navigate(href)
            } else {
                setActiveSidebarLink(link)
            }
        })
    )

    // hamburger & overlay
    var sidebar = document.getElementById('sidebar')
    var menuToggle = document.getElementById('menuToggle')
    var overlay = document.getElementById('sidebarOverlay')

    const closeSidebarMobile = () => {
        sidebar.classList.remove('open')
        overlay.classList.remove('open')
        if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false')
    }

    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            var isOpen = sidebar.classList.contains('open')
            if (isOpen) {
                closeSidebarMobile()
            } else {
                sidebar.classList.add('open')
                overlay.classList.add('open')
                menuToggle.setAttribute('aria-expanded', 'true')
            }
        })
    }

    if (overlay) {
        overlay.addEventListener('click', closeSidebarMobile)
    }

    // close sidebar (on mobile)
    // after link click
    document.querySelectorAll('.sb-link').forEach((link) =>
        link.addEventListener('click', () =>
            (window.innerWidth <= 680 && link.getAttribute('target') !== '_blank')
            && closeSidebarMobile()
        )
    )

    // (esc) --wait but pc cannot close sidebar -.-?
    // whatever maybe mobile have keyboard
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar && sidebar.classList.contains('open')) {
            closeSidebarMobile()
            if (menuToggle) menuToggle.focus()
        }
    })
}

const boot_ = () => {
    // spa routes use absolute paths
    const config = {
        groups: [
            {
                label: 'หน้าหลัก',
                items: [
                    { title: 'หน้าแรก', href: '/', icon: 'fa-solid fa-house', active: true },
                    { title: 'เกี่ยวกับ', href: '/about', icon: 'fa-solid fa-circle-info' },
                ]
            },
            {
                label: 'บริการ',
                items: [
                    { title: 'URL Shortener', href: '/short/', icon: 'fa-solid fa-link', external: false },
                    { title: 'QR Generator', href: '/short/', icon: 'fa-solid fa-qrcode', external: false },
                ]
            },
            {
                label: 'โรงเรียน',
                items: [
                    { title: 'สภานักเรียน', href: 'https://thatako-council.com', icon: 'fa-solid fa-users', external: true },
                    { title: 'ประชาสัมพันธ์', href: 'https://pr.thatako.net', icon: 'fa-solid fa-bullhorn', external: true },
                    {
                        title: 'Subdomains',
                        icon: 'fa-solid fa-earth-asia',
                        section: true,
                        items: [
                            { title: 'council.thatako.net', href: 'https://thatako-council.com', icon: 'fa-solid fa-circle-dot', external: true },
                            { title: 'pr.thatako.net', href: 'https://pr.thatako.net', icon: 'fa-solid fa-circle-dot', external: true },
                            { title: 'go.thatako.net', href: 'https://go.thatako.net', icon: 'fa-solid fa-circle-dot', external: true },
                            { title: '*.id.thatako.net', href: '/id', icon: 'fa-solid fa-circle-dot', badge: { text: 'plan', color: 'muted' } },
                        ]
                    },
                ]
            },
            {
                label: 'Infrastructure',
                items: [
                    { title: 'Cloudflare', href: 'https://www.cloudflare.com', icon: 'fa-solid fa-cloud', external: true },
                    { title: 'Vercel', href: 'https://vercel.com', icon: 'fa-brands fa-node-js', external: true },
                    { title: 'Dragonhispeed', href: 'https://www.dragonhispeed.com', icon: 'fa-solid fa-dragon', external: true },
                ]
            },
            {
                label: 'ติดต่อ',
                items: [
                    { title: 'aitji@duck.com', href: 'mailto:aitji@duck.com', icon: 'fa-solid fa-envelope', external: true },
                    { title: 'Discord', href: 'https://aitji.is-a.dev/discord', icon: 'fa-brands fa-discord', external: true },
                    { title: 'GitHub', href: 'https://github.com/aitji', icon: 'fa-brands fa-github', external: true },
                ]
            },
        ]
    }

    injectSidebar(config)
    ensureOverlay()
    ensureMenuToggle()
    syncSidebarToUrl()
    initEvents()
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot_)
else boot_()

export { setRouter }
