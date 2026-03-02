const AUTH_URL = 'https://dev.thatako.net/api/auth'
const WORKER_URL = 'https://workers.thatako.net'
const GH_PROXY = 'https://dev.thatako.net/api/gh-user'
const GH_API = 'https://api.github.com'

// auth helpers
const AUTH_KEY = 'thatako_auth'
const AUTH_TTL = 24 * 60 * 60 * 1000

const getAuth = () => {
    try {
        const raw = localStorage.getItem(AUTH_KEY)
        if (!raw) return null
        const obj = JSON.parse(raw)
        if (!obj || Date.now() > obj.expires) { clearAuth(); return null }
        return obj.auth
    } catch { return null }
}
const saveAuth = (auth) => localStorage.setItem(AUTH_KEY, JSON.stringify({ auth, expires: Date.now() + AUTH_TTL }))
const clearAuth = () => localStorage.removeItem(AUTH_KEY)
const startLogin = () => {
    const returnUrl = window.location.origin + window.location.pathname
    window.location.href = AUTH_URL + '?return=' + encodeURIComponent(returnUrl)
}

// sanitize helpers
function sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return ''
    const trimmed = url.trim()
    if (/^(javascript|data|vbscript):/i.test(trimmed)) return ''

    // github profile
    if (/^https:\/\/avatars\.githubusercontent\.com\//.test(trimmed)) return trimmed
    return ''
}

function sanitizeLogin(login) {
    if (!login || typeof login !== 'string') return ''

    // github usernames: alphanumeric + hyphens only, max 39 chars
    return login.replace(/[^a-zA-Z0-9\-]/g, '').slice(0, 39)
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

// toast
function toast(msg, type = 'info', duration = 5000) {
    const c = document.getElementById('toasts')
    const t = document.createElement('div')
    t.className = 'toast' + (type === 'error' ? ' error' : type === 'success' ? ' success' : type === 'warn' ? ' warn' : '')
    const icon = type === 'error' ? 'fa-circle-xmark'
        : type === 'success' ? 'fa-circle-check'
            : type === 'warn' ? 'fa-triangle-exclamation'
                : 'fa-circle-info'

    const el = document.createElement('div')
    el.className = t.className
    el.innerHTML = `<i class="fa-solid ${icon}"></i><span></span><button class="toast-close"><i class="fa-solid fa-xmark"></i></button>`
    el.querySelector('span').textContent = msg
    el.querySelector('.toast-close').onclick = () => el.remove()
    c.appendChild(el)
    if (duration > 0) setTimeout(() => el.remove(), duration)
    return el
}

// host&provider template
const HOST_TEMPLATES = {
    vercel: {
        records: [{ type: 'CNAME', name: '@', value: '[USER].vercel-dns-017.com.' }],
        hint: '💡 หลังจากบันทึกแล้วให้ไปที่โปรเจ็กต์ Vercel → Setting → Domain และเพิ่มโดเมนนี้',
        docs: 'https://vercel.com/docs/concepts/projects/custom-domains',
    },
    'github-pages': {
        records: [{ type: 'CNAME', name: '@', value: '[USERNAME].github.io' }],
        hint: '💡 แทนที่ USERNAME ด้วยชื่อผู้ใช้ GitHub ของคุณ จากนั้นเปิดใช้งาน Pages ใน Repository ของคุณ → Setting → Pages',
        docs: 'https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site',
    },
    netlify: {
        records: [{ type: 'CNAME', name: '@', value: 'your-site.netlify.app' }],
        hint: '💡 แทนที่โดเมนย่อยของเว็บไซต์ Netlify ของคุณ (Site settings → Domain management)',
        docs: 'https://docs.netlify.com/domains-https/custom-domains/',
    },
    cloudflare: {
        records: [{ type: 'A', name: '@', value: '192.0.2.1' }],
        hint: '💡 แทนที่ 192.0.2.1 ด้วยที่อยู่ IP ของเซิร์ฟเวอร์ต้นทาง',
        docs: 'https://developers.cloudflare.com/dns/',
    },
    render: {
        records: [{ type: 'CNAME', name: '@', value: 'your-service.onrender.com' }],
        hint: '💡 แทนที่ด้วย Render Service URL ของคุณ (ที่ service dashboard)',
        docs: 'https://render.com/docs/custom-domains',
    },
    railway: {
        records: [{ type: 'CNAME', name: '@', value: 'your-service.up.railway.app' }],
        hint: '💡 แทนที่ด้วย Railway service URL ของคุณ (ที่ Service → Settings → Networking)',
        docs: 'https://docs.railway.app/deploy/custom-domains',
    },
    'fly.io': {
        records: [
            { type: 'A', name: '@', value: '66.241.125.1' },
            { type: 'AAAA', name: '@', value: '2a09:8280:1::1:b3b5' },
        ],
        hint: '💡 หลังจากบันทึกแล้ว, ใช้คำสั่ง: fly certs add [name].id.thatako.net',
        docs: 'https://fly.io/docs/app-guides/custom-domains-with-fly/',
    },
    other: { records: [], hint: '', docs: '' },
}

let pendingTemplateApply = null
function applyHostTemplate(host, forceApply = false) {
    const tpl = HOST_TEMPLATES[host]
    if (!tpl) return

    const doApply = () => {
        recordRows = []
        recordCounter = 0
        renderRecords()
        for (const r of tpl.records) addRecord(r.type, r.name, r.value)
        updateHostHint(tpl)
    }

    if (editingDomain && !forceApply) {
        pendingTemplateApply = doApply
        document.getElementById('templateModalLabel').textContent = host
        document.getElementById('templateModal').classList.add('open')
    } else doApply()
}

function updateHostHint(tpl) {
    let hint = document.getElementById('hostHint')
    if (!hint) {
        hint = document.createElement('div')
        hint.id = 'hostHint'
        hint.style.cssText = [
            'margin-top:8px', 'font-size:12px', 'line-height:1.6',
            'padding:8px 10px', 'border-radius:6px',
            'background:color-mix(in srgb,var(--color-accent,#4f5d97) 10%,transparent)',
            'color:var(--color-text-muted)',
            'display:flex', 'gap:8px', 'align-items:flex-start',
        ].join(';')
        document.getElementById('hostSelect').closest('.field').appendChild(hint)
    }

    if (tpl?.hint) {
        hint.style.display = ''
        const span = document.createElement('span')
        span.style.flex = '1'
        span.textContent = tpl.hint
        hint.innerHTML = ''
        hint.appendChild(span)
        if (tpl.docs) {
            const a = document.createElement('a')
            a.href = tpl.docs
            a.target = '_blank'
            a.rel = 'noopener'
            a.style.cssText = 'white-space:nowrap;font-size:11px;flex-shrink:0;'
            a.innerHTML = 'Docs <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>'
            hint.appendChild(a)
        }
    } else {
        hint.style.display = 'none'
    }
}

// dns reocrd
let recordRows = []
let recordCounter = 0

window.addRecord = function (type, name = '', value = '') {
    const id = ++recordCounter
    recordRows.push({ id, type })
    renderRecords()

    // set values after render
    const nameEl = document.getElementById(`rec-name-${id}`)
    const valEl = document.getElementById(`rec-val-${id}`)
    if (nameEl) nameEl.value = name
    if (valEl) valEl.value = value
    validateRecordConflicts()
}

window.removeRecord = function (id) {
    recordRows = recordRows.filter(r => r.id !== id)
    renderRecords()
    validateRecordConflicts()
}

function renderRecords() {
    const container = document.getElementById('recordsBuilder')

    // build DOM directly; no innerHTML with user data
    container.innerHTML = ''
    for (const r of recordRows) {
        const row = document.createElement('div')
        row.className = 'record-row'
        row.id = `recrow-${r.id}`

        const badge = document.createElement('span')
        badge.className = 'record-type-badge'
        badge.textContent = r.type

        const nameInput = document.createElement('input')
        nameInput.type = 'text'
        nameInput.id = `rec-name-${r.id}`
        nameInput.placeholder = 'name (e.g. @)'
        nameInput.style.flex = '1'
        nameInput.addEventListener('input', validateRecordConflicts)

        const valInput = document.createElement('input')
        valInput.type = 'text'
        valInput.id = `rec-val-${r.id}`
        valInput.placeholder = 'value'
        valInput.style.flex = '2'

        const delBtn = document.createElement('button')
        delBtn.className = 'btn btn-danger'
        delBtn.title = 'ลบ record'
        delBtn.innerHTML = '<i class="fa-solid fa-trash"></i>'
        delBtn.addEventListener('click', () => removeRecord(r.id))

        row.append(badge, nameInput, valInput, delBtn)
        container.appendChild(row)
    }
}

// CNAME can't share name w/ (A | AAAA | MX)
function validateRecordConflicts() {
    const banner = document.getElementById('conflictBanner')
    const submitBtn = document.getElementById('submitBtn')

    const byName = {}
    for (const r of recordRows) {
        const name = document.getElementById(`rec-name-${r.id}`)?.value.trim() || ''
        if (!name) continue
        if (!byName[name]) byName[name] = new Set()
        byName[name].add(r.type)
    }

    const conflicts = []
    for (const [name, types] of Object.entries(byName)) {
        if (!types.has('CNAME')) continue
        if (types.has('A') || types.has('AAAA')) conflicts.push(`"${escHtml(name)}" (CNAME + A/AAAA)`)
        if (types.has('MX')) conflicts.push(`"${escHtml(name)}" (CNAME + MX)`)
    }

    if (conflicts.length) {
        banner.style.display = 'flex'
        banner.innerHTML = `
            <i class="fa-solid fa-triangle-exclamation" style="flex-shrink:0;margin-top:1px;"></i>
            <span><strong>เกิดข้อขัดแย้ง</strong> ${conflicts.join(', ')}
            CNAME ไม่สามารถอยู่ร่วมกับ A, AAAA, หรือ MX ในชื่อเดียวกันได้</span>`
        submitBtn.disabled = true
    } else {
        banner.style.display = 'none'
        submitBtn.disabled = false
    }
}

function getRecordsPayload() {
    const records = {}
    for (const r of recordRows) {
        const name = document.getElementById(`rec-name-${r.id}`)?.value.trim()
        const value = document.getElementById(`rec-val-${r.id}`)?.value.trim()
        if (!name || !value) continue
        if (!records[r.type]) records[r.type] = []
        records[r.type].push({ name, value })
    }
    return records
}

// co-owner
const ghIdCache = {}
const lookupTimers = {}
const GH_DEBOUNCE = 600 // ms

window.scheduleGhLookup = function (rowId) {
    clearTimeout(lookupTimers[rowId])
    lookupTimers[rowId] = setTimeout(() => lookupGhId(rowId), GH_DEBOUNCE)
}

async function lookupGhId(rowId) {
    const row = coownerRows.find(r => r.id === rowId)
    const ghInput = document.getElementById(`co-gh-${rowId}`)
    const statusEl = document.getElementById(`co-status-${rowId}`)
    const manualBox = document.getElementById(`co-manual-${rowId}`)
    const chipEl = document.getElementById(`co-chip-${rowId}`)
    if (!ghInput) return

    const username = ghInput.value.trim()
    if (!username) {
        setCoownerChip(chipEl, null, rowId)
        if (statusEl) statusEl.innerHTML = ''
        if (manualBox) manualBox.style.display = 'none'
        if (row) row.resolved = false
        return
    }

    const key = username.toLowerCase()
    const cached = ghIdCache[key]
    if (cached) { setLookupSuccess(chipEl, statusEl, manualBox, cached, rowId); return }

    setLookupStatus(statusEl, '', '…')

    // 1. proxy serverside
    try {
        const res = await fetch(`${GH_PROXY}?username=${encodeURIComponent(username)}`)
        if (res.ok) {
            const data = await res.json()
            ghIdCache[key] = data
            setLookupSuccess(chipEl, statusEl, manualBox, data, rowId)
            return
        }
        if (res.status === 404) return notFound(chipEl, statusEl, rowId)
    } catch { }

    // 2. auth with oauth token
    const token = getAuth()?.token
    if (token) {
        try {
            const res = await fetch(`${GH_API}/users/${encodeURIComponent(username)}`, {
                headers: {
                    'Accept': 'application/vnd.github+json',
                    'Authorization': `Bearer ${token}`,
                    'X-GitHub-Api-Version': '2022-11-28',
                }
            })
            if (res.ok) {
                const data = await res.json()
                const info = { id: data.id, login: data.login, avatar_url: data.avatar_url }
                ghIdCache[key] = info
                setLookupSuccess(chipEl, statusEl, manualBox, info, rowId)
                return
            }
            if (res.status === 404) return notFound(chipEl, statusEl, rowId)
        } catch { }
    }

    // 3. anonymous
    try {
        const res = await fetch(`${GH_API}/users/${encodeURIComponent(username)}`, {
            headers: { 'Accept': 'application/vnd.github+json' }
        })
        if (res.ok) {
            const data = await res.json()
            const info = { id: data.id, login: data.login, avatar_url: data.avatar_url }
            ghIdCache[key] = info
            setLookupSuccess(chipEl, statusEl, manualBox, info, rowId)
            return
        }
        if (res.status === 404) { notFound(chipEl, statusEl, rowId); return }
    } catch { }

    showManualIdBox(statusEl, manualBox, username)
}

function notFound(chipEl, statusEl, rowId) {
    setCoownerChip(chipEl, null, rowId)
    setLookupStatus(statusEl, 'error', 'ไม่พบผู้ใช้')
    const row = coownerRows.find(r => r.id === rowId)
    if (row) row.resolved = false
}

function setLookupStatus(el, type, text) {
    if (!el) return
    el.style.color = type === 'success' ? 'var(--color-success,#22c55e)'
        : type === 'error' ? 'var(--color-danger,#ef4444)'
            : type === 'warn' ? 'var(--color-warning,#f59e0b)'
                : 'var(--color-text-muted)'
    el.textContent = text
}

function setLookupSuccess(chipEl, statusEl, manualBox, data, rowId) {
    if (manualBox) manualBox.style.display = 'none'
    setLookupStatus(statusEl, 'success', '')
    setCoownerChip(chipEl, data, rowId)
    // persist resolved state
    const row = coownerRows.find(r => r.id === rowId)
    if (row) {
        row.resolved = true
        row.githubId = String(data.id)
        row.github = data.login
    }
}

function setCoownerChip(chipEl, data, rowId) {
    if (!chipEl) return
    if (!data) {
        chipEl.style.display = 'none'
        chipEl.innerHTML = ''
        return
    }
    chipEl.style.display = 'flex'
    // safe DOM construction; no innerHTML w/ user data
    chipEl.innerHTML = ''

    const safeAvatar = sanitizeUrl(data.avatar_url)
    const safeLogin = sanitizeLogin(data.login)
    const safeId = parseInt(data.id) || 0

    if (safeAvatar) {
        const img = document.createElement('img')
        img.src = safeAvatar
        img.alt = ''
        img.width = 18
        img.height = 18
        img.style.borderRadius = '50%'
        chipEl.appendChild(img)
    }

    const strong = document.createElement('strong')
    strong.textContent = '@' + safeLogin
    chipEl.appendChild(strong)

    const badge = document.createElement('span')
    badge.className = 'badge-primary-owner'
    badge.style.cssText = 'background:var(--color-badge-muted-bg);color:var(--color-badge-muted-text);'
    badge.textContent = 'Co-owner'
    chipEl.appendChild(badge)

    // hidden id input for payload extraction
    let hiddenInput = document.getElementById(`co-id-hidden-${rowId}`)
    if (!hiddenInput) {
        hiddenInput = document.createElement('input')
        hiddenInput.type = 'hidden'
        hiddenInput.id = `co-id-hidden-${rowId}`
        chipEl.appendChild(hiddenInput)
    }
    hiddenInput.value = String(safeId)
    chipEl.dataset.rowid = rowId
}

function showManualIdBox(statusEl, manualBox, username) {
    setLookupStatus(statusEl, 'warn', 'rate limited')
    if (!manualBox) return
    const safeUser = escHtml(sanitizeLogin(username))
    const apiUrl = `https://api.github.com/users/${safeUser}`
    const profileUrl = `https://github.com/${safeUser}`
    manualBox.style.display = ''
    // build safely
    manualBox.innerHTML = ''
    const inner = document.createElement('div')
    inner.className = 'manual-id-box-inner'
    inner.innerHTML = `
      <i class="fa-solid fa-triangle-exclamation" style="color:var(--color-warning,#f59e0b);flex-shrink:0;margin-top:2px;"></i>
      <div>
        <strong>GitHub API rate limited.</strong> ค้นหา ID ด้วยตนเอง:<br>
        1. เปิด <a href="${apiUrl}" target="_blank" rel="noopener noreferrer">${apiUrl}</a><br>
        2. คัดลอก <code>"id"</code> แล้ววางในช่ด้านล่าง<br>
        <span class="muted">หรือเข้า <a href="${profileUrl}" target="_blank" rel="noopener noreferrer">${profileUrl}</a>
        แล้วกด <kbd>Ctrl+U</kbd> ค้นหา <code>data-scope-id</code></span>
      </div>`
    const input = document.createElement('input')
    input.type = 'number'
    input.id = `co-manual-id-input-${manualBox.dataset.rowid}`
    input.placeholder = 'GitHub ID'
    input.min = '1'
    input.style.cssText = 'margin-top:6px;max-width:160px;height:30px;font-size:12px;'
    input.addEventListener('input', () => applyManualId(manualBox.dataset.rowid, input.value))
    inner.querySelector('div').appendChild(input)
    manualBox.appendChild(inner)
}

window.applyManualId = function (rowId, value) {
    const id = parseInt(value)
    if (!id) return
    const ghInput = document.getElementById(`co-gh-${rowId}`)
    const chipEl = document.getElementById(`co-chip-${rowId}`)
    const manualBox = document.getElementById(`co-manual-${rowId}`)
    const statusEl = document.getElementById(`co-status-${rowId}`)
    const username = sanitizeLogin(ghInput?.value.trim() || 'unknown')
    const safeAvatar = `https://avatars.githubusercontent.com/u/${id}?v=4`
    const data = { id, login: username, avatar_url: safeAvatar }
    ghIdCache[username.toLowerCase()] = data
    setLookupSuccess(chipEl, statusEl, manualBox, data, Number(rowId))
}

// co-owner rows
let coownerRows = []
let coownerCounter = 0

window.addCoowner = function (github = '', githubId = '', email = '') {
    const id = ++coownerCounter
    _snapshotCoownerValues()
    coownerRows.push({ id, github, githubId, email, resolved: !!(github && githubId) })
    renderCoowners()

    if (github && githubId) {
        const safeId = parseInt(githubId)
        const safeLogin = sanitizeLogin(github)
        const avatarUrl = `https://avatars.githubusercontent.com/u/${safeId}?v=4`
        const data = { id: safeId, login: safeLogin, avatar_url: avatarUrl }
        ghIdCache[safeLogin.toLowerCase()] = data
        const chipEl = document.getElementById(`co-chip-${id}`)
        const statusEl = document.getElementById(`co-status-${id}`)
        const manualBox = document.getElementById(`co-manual-${id}`)
        setLookupSuccess(chipEl, statusEl, manualBox, data, id)
    } else if (github && !githubId) {
        scheduleGhLookup(id)
    }
}

function _snapshotCoownerValues() {
    for (const r of coownerRows) {
        const ghEl = document.getElementById(`co-gh-${r.id}`)
        const emailEl = document.getElementById(`co-email-${r.id}`)
        if (ghEl) r.github = ghEl.value
        if (emailEl) r.email = emailEl.value

        const hiddenId = document.getElementById(`co-id-hidden-${r.id}`)
        if (hiddenId) r.githubId = hiddenId.value
    }
}

window.removeCoowner = function (id) {
    _snapshotCoownerValues()
    coownerRows = coownerRows.filter(r => r.id !== id)
    renderCoowners()
    // re-apply resolved chips after re-render
    for (const r of coownerRows) {
        if (!r.githubId || !r.github) continue
        const data = ghIdCache[r.github.toLowerCase()] || {
            id: parseInt(r.githubId),
            login: r.github,
            avatar_url: `https://avatars.githubusercontent.com/u/${r.githubId}?v=4`
        }
        const chipEl = document.getElementById(`co-chip-${r.id}`)
        const statusEl = document.getElementById(`co-status-${r.id}`)
        const manualBox = document.getElementById(`co-manual-${r.id}`)
        if (chipEl) setLookupSuccess(chipEl, statusEl, manualBox, data, r.id)
    }
}

function renderCoowners() {
    const container = document.getElementById('coownersBuilder')
    container.innerHTML = ''
    for (const r of coownerRows) {
        const row = document.createElement('div')
        row.className = 'owner-row'
        row.id = `corow-${r.id}`

        // input group
        const inputGroup = document.createElement('div')
        inputGroup.className = 'owner-input-group'

        const ghInput = document.createElement('input')
        ghInput.type = 'text'
        ghInput.id = `co-gh-${r.id}`
        ghInput.placeholder = 'GitHub username'
        ghInput.value = r.github || ''
        ghInput.autocomplete = 'off'
        ghInput.addEventListener('input', () => {
            // reset resolved state on edit
            const row = coownerRows.find(x => x.id === r.id)
            if (row) { row.resolved = false; row.githubId = '' }
            scheduleGhLookup(r.id)
        })

        const emailInput = document.createElement('input')
        emailInput.type = 'email'
        emailInput.id = `co-email-${r.id}`
        emailInput.placeholder = 'Email (optional)'
        emailInput.value = r.email || ''
        emailInput.autocomplete = 'off'
        emailInput.style.maxWidth = '200px'

        const delBtn = document.createElement('button')
        delBtn.className = 'btn btn-danger btn-icon'
        delBtn.title = 'ลบ co-owner'
        delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>'
        delBtn.addEventListener('click', () => removeCoowner(r.id))

        inputGroup.append(ghInput, emailInput, delBtn)

        const statusEl = document.createElement('span')
        statusEl.id = `co-status-${r.id}`
        statusEl.className = 'gh-lookup-status'

        // chip hidden until resolved
        const chipEl = document.createElement('div')
        chipEl.className = 'owner-primary'
        chipEl.id = `co-chip-${r.id}`
        chipEl.dataset.rowid = String(r.id)
        chipEl.style.cssText = 'display:none;margin-bottom:0;'

        const manualBox = document.createElement('div')
        manualBox.className = 'manual-id-box'
        manualBox.id = `co-manual-${r.id}`
        manualBox.dataset.rowid = String(r.id)
        manualBox.style.display = 'none'

        const wrap = document.createElement('div')
        wrap.style.cssText = 'display:flex;flex-direction:column;gap:5px;grid-column:1/-1;'
        wrap.append(inputGroup, statusEl, chipEl, manualBox)
        row.appendChild(wrap)
        container.appendChild(row)
    }
}

function getCoownersPayload(auth) {
    _snapshotCoownerValues()
    const owners = [{
        github: sanitizeLogin(auth.user.login),
        'github-id': parseInt(auth.user.id) || 0,
        email: auth.user.email || '',
    }]
    for (const r of coownerRows) {
        const gh = sanitizeLogin(r.github?.trim() || '')
        const ghId = parseInt(r.githubId) || parseInt(document.getElementById(`co-id-hidden-${r.id}`)?.value) || 0
        const email = r.email?.trim() || ''
        if (gh && ghId) owners.push({ github: gh, 'github-id': ghId, email })
    }
    return owners
}

// domain list w/ virtual scroll    || variable note
let domainsCache = []               // full list from server
let filteredDomains = []            // after search + filter
const ROW_HEIGHT = 50               // px; CSS row height
const BUFFER_ROWS = 5               // extra rows above/below viewport

let vsScrollEl = null               // the scrollable container
let vsTableBody = null
let vsFirstRendered = 0
let vsLastRendered = 0

function initVirtualScroll() {
    const wrapper = document.getElementById('domainsScrollWrapper')
    if (!wrapper) return
    vsScrollEl = wrapper
    vsTableBody = document.getElementById('domainsList')
    vsScrollEl.addEventListener('scroll', onVsScroll, { passive: true })
}

function onVsScroll() {
    renderVisibleRows()
}

function setFilteredDomains(list) {
    filteredDomains = list
    // set spacer height so scrollbar is correct
    const total = filteredDomains.length
    const spacer = document.getElementById('domainsSpacerTop')
    const spacerBot = document.getElementById('domainsSpacerBot')
    if (spacer) spacer.style.height = '0px'
    if (spacerBot) spacerBot.style.height = `${total * ROW_HEIGHT}px`
    // reset scroll position
    if (vsScrollEl) vsScrollEl.scrollTop = 0
    renderVisibleRows()
}

function renderVisibleRows() {
    if (!vsScrollEl || !vsTableBody) return
    const scrollTop = vsScrollEl.scrollTop
    const viewHeight = vsScrollEl.clientHeight
    const total = filteredDomains.length

    if (total === 0) {
        document.getElementById('domainsSpacerTop').style.height = '0px'
        document.getElementById('domainsSpacerBot').style.height = '0px'
        vsTableBody.innerHTML = `<tr><td colspan="3">
            <div class="empty-state">
                <div style="display:flex;justify-content:center">
                    <i class="fa-solid fa-globe" style="font-size:24px;opacity:.35;"></i>
                </div>
                <span>ยังไม่มีโดเมน</span>
            </div></td></tr>`
        return
    }

    const firstVisible = Math.floor(scrollTop / ROW_HEIGHT)
    const lastVisible = Math.min(total - 1, Math.floor((scrollTop + viewHeight) / ROW_HEIGHT))

    const first = Math.max(0, firstVisible - BUFFER_ROWS)
    const last = Math.min(total - 1, lastVisible + BUFFER_ROWS)

    // skip if same window
    if (first === vsFirstRendered && last === vsLastRendered && vsTableBody.children.length > 0) return
    vsFirstRendered = first
    vsLastRendered = last

    const topPad = first * ROW_HEIGHT
    const botPad = (total - 1 - last) * ROW_HEIGHT

    document.getElementById('domainsSpacerTop').style.height = `${topPad}px`
    document.getElementById('domainsSpacerBot').style.height = `${botPad}px`

    vsTableBody.innerHTML = ''
    for (let i = first; i <= last; i++) vsTableBody.appendChild(buildDomainRow(filteredDomains[i]))
}

function buildDomainRow(d) {
    const tr = document.createElement('tr')
    tr.style.height = `${ROW_HEIGHT}px`

    // domain cell
    const tdDomain = document.createElement('td')
    tdDomain.className = 'domain-name'
    const link = document.createElement('a')
    // safe: domain validated by server regex; still use textContent
    link.href = 'https://' + encodeURIComponent(d.domain).replace(/%2E/g, '.')
    link.target = '_blank'
    link.rel = 'noopener'
    link.textContent = d.domain
    tdDomain.appendChild(link)

    // host cell
    const tdHost = document.createElement('td')
    const badge = document.createElement('span')
    badge.className = 'host-badge'
    badge.textContent = (d.host || []).join(', ')
    tdHost.appendChild(badge)

    // actions cell
    const tdAct = document.createElement('td')
    const actions = document.createElement('div')
    actions.className = 'domain-actions'

    const editBtn = document.createElement('button')
    editBtn.className = 'btn btn-ghost'
    editBtn.title = 'แก้ไข'
    editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>'
    editBtn.addEventListener('click', () => editDomain(d.domain))

    const delBtn = document.createElement('button')
    delBtn.className = 'btn btn-danger'
    delBtn.title = 'ลบ'
    delBtn.innerHTML = '<i class="fa-solid fa-trash"></i>'
    delBtn.addEventListener('click', () => confirmDelete(d.domain))

    actions.append(editBtn, delBtn)
    tdAct.appendChild(actions)

    tr.append(tdDomain, tdHost, tdAct)
    return tr
}

function applyFilters() {
    const query = document.getElementById('domainSearch')?.value.toLowerCase().trim() || ''
    const hostFilter = document.getElementById('domainFilterHost')?.value || ''
    const ownerFilter = document.getElementById('domainFilterCoowner')?.checked || false

    const auth = getAuth()

    let list = domainsCache.filter(d => {
        if (query && !d.domain.toLowerCase().includes(query)) return false
        if (hostFilter && !(d.host || []).includes(hostFilter)) return false
        if (ownerFilter && auth) {
            // only show where user is co-owner (not primary)
            const owners = d.owner || []
            const isPrimary = owners[0]?.['github-id'] === auth.user?.id
            const isCoowner = owners.slice(1).some(o => o['github-id'] === auth.user?.id)
            if (!isPrimary && !isCoowner) return false
        }
        return true
    })

    setFilteredDomains(list)
    updateDomainCount(list.length)
}

function updateDomainCount(n) {
    const el = document.getElementById('domainCount')
    if (el) el.textContent = n === domainsCache.length ? `${n}` : `${n} / ${domainsCache.length}`
}

function buildHostFilterOptions() {
    const sel = document.getElementById('domainFilterHost')
    if (!sel) return
    const hosts = [...new Set(domainsCache.flatMap(d => d.host || []))]
    sel.innerHTML = '<option value="">ทุก host</option>'
    for (const h of hosts.sort()) {
        const opt = document.createElement('option')
        opt.value = h
        opt.textContent = h
        sel.appendChild(opt)
    }
}

async function loadDomains(auth) {
    const tbody = document.getElementById('domainsList')
    tbody.innerHTML = `<tr><td colspan="3"><div class="loading-state"><span class="spinner"></span><span>กำลังโหลด...</span></div></td></tr>`
    try {
        const res = await fetch(`${WORKER_URL}/dns`, {
            headers: {
                'Content-Type': 'application/json',
                'X-User-Data': auth.userData,
                'X-Sig': auth.sig,
            }
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'ไม่สามารถโหลดข้อมูลได้')
        domainsCache = data.domains || []
        buildHostFilterOptions()
        applyFilters()
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="3">
            <div class="empty-state">
                <div style="display:flex;justify-content:center">
                    <i class="fa-solid fa-circle-exclamation" style="color:var(--color-danger,#ef4444);font-size:20px;"></i>
                </div>
                <span></span>
                <div>
                    <button class="btn btn-ghost" id="retryBtn" style="font-size:11px;height:26px;margin-top:4px;">ลองใหม่</button>
                </div>
            </div>
        </td></tr>`
        const errSpan = tbody.querySelector('.empty-state span')
        if (errSpan) errSpan.textContent = e.message
        document.getElementById('retryBtn')?.addEventListener('click', () => loadDomains(auth))
    }
}

// form state | null = create mode, string = edit mode
let editingDomain = null

function setFormMode(domain = null) {
    editingDomain = domain
    const isEdit = !!domain
    document.getElementById('formIcon').className = isEdit ? 'fa-solid fa-pen' : 'fa-solid fa-plus'
    document.getElementById('formTitle').textContent = isEdit ? 'แก้ไขโดเมน' : 'ลงทะเบียนโดเมนใหม่'
    document.getElementById('submitBtn').innerHTML = isEdit
        ? '<i class="fa-solid fa-check" aria-hidden="true"></i> บันทึกการแก้ไข'
        : '<i class="fa-solid fa-check" aria-hidden="true"></i> ลงทะเบียนโดเมน'
    document.getElementById('formResetBtn').style.display = isEdit ? '' : 'none'
    document.getElementById('formModeHint').style.display = isEdit ? '' : 'none'
    if (isEdit) document.getElementById('editingDomainLabel').textContent = domain
    document.getElementById('subdomain').disabled = isEdit
}

function resetForm() {
    recordRows = []
    recordCounter = 0
    coownerRows = []
    coownerCounter = 0
    renderRecords()
    renderCoowners()
    document.getElementById('subdomain').value = ''
    document.getElementById('subdomain').disabled = false
    document.getElementById('hostSelect').selectedIndex = 0
    document.getElementById('conflictBanner').style.display = 'none'
    document.getElementById('submitBtn').disabled = false
    updateHostHint(null)
    setFormMode(null)
}

window.editDomain = function (domain) {
    const d = domainsCache.find(x => x.domain === domain)
    if (!d) return

    resetForm()
    setFormMode(domain)

    document.getElementById('subdomain').value = domain.replace(/\.id\.thatako\.net$/, '')

    const hostVal = (d.host || [])[0] || 'other'
    document.getElementById('hostSelect').value = hostVal
    updateHostHint(HOST_TEMPLATES[hostVal] || null)

    for (const [type, recs] of Object.entries(d.records || {})) {
        for (const rec of (Array.isArray(recs) ? recs : [recs])) {
            addRecord(type, rec.name ?? rec, rec.value ?? rec)
        }
    }
    for (const o of (d.owner || []).slice(1)) {
        addCoowner(o.github, o['github-id'], o.email)
    }

    document.querySelector('.dash-grid').scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// delete
let pendingDeleteDomain = null
window.confirmDelete = function (domain) {
    pendingDeleteDomain = domain
    document.getElementById('deleteDomainLabel').textContent = domain
    document.getElementById('deleteModal').classList.add('open')
}

async function deleteDomain(auth) {
    if (!pendingDeleteDomain) return
    const domain = pendingDeleteDomain
    closeDeleteModal()
    try {
        const res = await fetch(`${WORKER_URL}/dns`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payload: { domain }, userData: auth.userData, sig: auth.sig })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'ลบไม่สำเร็จ')
        toast('ลบโดเมนสำเร็จ', 'success')
        loadDomains(auth)
        if (editingDomain === domain) resetForm()
    } catch (e) { toast(e.message, 'error') }
}

// submit
async function submitForm(auth) {
    const subdomain = document.getElementById('subdomain').value.trim()
    if (!subdomain) { toast('กรุณากรอกชื่อโดเมน', 'error'); return }

    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) {
        toast('ชื่อโดเมนใช้ได้เฉพาะ a-z, 0-9 และ - และต้องไม่ขึ้นหรือลงท้ายด้วย -', 'error')
        return
    }

    const records = getRecordsPayload()
    if (!Object.keys(records).length) { toast('กรุณาเพิ่มอย่างน้อย 1 DNS record', 'error'); return }

    const payload = {
        domain: `${subdomain}.id.thatako.net`,
        host: [document.getElementById('hostSelect').value],
        owner: getCoownersPayload(auth),
        records,
    }

    const wasEditing = !!editingDomain
    const successMsg = wasEditing ? 'อัปเดตโดเมนสำเร็จ' : 'ลงทะเบียนโดเมนสำเร็จ'

    const btn = document.getElementById('submitBtn')
    btn.disabled = true
    btn.innerHTML = '<span class="spinner"></span> กำลังบันทึก...'

    try {
        const res = await fetch(`${WORKER_URL}/dns`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payload, userData: auth.userData, sig: auth.sig })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด')

        resetForm()
        loadDomains(auth)
        toast(successMsg, 'success')
    } catch (e) {
        toast(e.message, 'error')
        btn.disabled = false
        btn.innerHTML = `<i class="fa-solid fa-check" aria-hidden="true"></i> ${wasEditing ? 'บันทึกการแก้ไข' : 'ลงทะเบียนโดเมน'}`
    }
}

// modal helper
function closeDeleteModal() { document.getElementById('deleteModal').classList.remove('open') }
function closeTemplateModal() { document.getElementById('templateModal').classList.remove('open') }

// init
function showDashboard(auth) {
    document.getElementById('authGate').classList.add('hidden')
    document.getElementById('dashboard').classList.add('visible')

    // safe DOM population; textContent only for user data
    const safeLogin = sanitizeLogin(auth.user.login)
    const safeAvatar = sanitizeUrl(auth.user.avatar_url)

    document.getElementById('userAvatar').src = safeAvatar
    document.getElementById('userLogin').textContent = safeLogin
    document.getElementById('primaryOwnerAvatar').src = safeAvatar
    document.getElementById('primaryOwnerLogin').textContent = '@' + safeLogin

    document.getElementById('logoutBtn').onclick = () => { clearAuth(); location.reload() }
    document.getElementById('refreshBtn').onclick = () => loadDomains(auth)
    document.getElementById('submitBtn').onclick = () => submitForm(auth)
    document.getElementById('formResetBtn').onclick = resetForm

    // host template
    document.getElementById('hostSelect').addEventListener('change', e => applyHostTemplate(e.target.value))

    // search + filter wiring
    document.getElementById('domainSearch')?.addEventListener('input', applyFilters)
    document.getElementById('domainFilterHost')?.addEventListener('change', applyFilters)
    document.getElementById('domainFilterCoowner')?.addEventListener('change', applyFilters)

    // delete modal
    document.getElementById('deleteModalClose').onclick = closeDeleteModal
    document.getElementById('deleteModalCancel').onclick = closeDeleteModal
    document.getElementById('deleteModalConfirm').onclick = () => deleteDomain(auth)

    // template confirm modal
    document.getElementById('templateModalCancel').onclick = closeTemplateModal
    document.getElementById('templateModalConfirm').onclick = () => {
        closeTemplateModal()
        if (pendingTemplateApply) { pendingTemplateApply(); pendingTemplateApply = null }
    }

    // close any modal by clicking the dark overlay
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) overlay.classList.remove('open')
        })
    })

    // close on Escape
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape')
            document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'))
    })

    initVirtualScroll()
    loadDomains(auth)
}

document.addEventListener('DOMContentLoaded', () => {
    // check OAuth
    const params = new URLSearchParams(window.location.search)

    // auth token forwarded OAuth callback
    if (params.has('authed')) {
        const authParam = params.get('auth')
        if (authParam) {
            try {
                const parsed = JSON.parse(decodeURIComponent(authParam))
                // validate shape before saving
                if (parsed?.user?.login && parsed?.user?.id && parsed?.userData && parsed?.sig) {
                    saveAuth(parsed)
                } else {
                    console.warn('invalid auth shape; discarding')
                }
            } catch { /* malformed auth param */ }
        }
        history.replaceState({}, '', window.location.pathname)
    }

    const auth = getAuth()
    if (auth) showDashboard(auth)
    else document.getElementById('loginBtn').onclick = startLogin
})