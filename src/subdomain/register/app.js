const AUTH_URL = 'https://dev.thatako.net/api/auth'
const WORKER_URL = 'https://workers.thatako.net'
// github id
const GH_PROXY = 'https://dev.thatako.net/api/gh-user'
const GH_API = 'https://api.github.com'

// auth helpers
const AUTH_KEY = 'thatako_auth'
const AUTH_TTL = 24 * 60 * 60 * 1000  // 24 h

function getAuth() {
    try {
        const raw = localStorage.getItem(AUTH_KEY)
        if (!raw) return null
        const obj = JSON.parse(raw)
        if (!obj || Date.now() > obj.expires) { clearAuth(); return null }
        return obj.auth
    } catch { return null }
}
function saveAuth(auth) {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ auth, expires: Date.now() + AUTH_TTL }))
}
function clearAuth() { localStorage.removeItem(AUTH_KEY) }
function startLogin() {
    sessionStorage.setItem('oauth_return', window.location.href)
    window.location.href = AUTH_URL + '?return=' + encodeURIComponent(window.location.href)
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
    t.innerHTML = `<i class="fa-solid ${icon}"></i><span>${msg}</span><button class="toast-close"><i class="fa-solid fa-xmark"></i></button>`
    t.querySelector('.toast-close').onclick = () => t.remove()
    c.appendChild(t)
    if (duration > 0) setTimeout(() => t.remove(), duration)
    return t
}

// host&provider template
const HOST_TEMPLATES = {
    vercel: {
        records: [{ type: 'CNAME', name: '@', value: '[USER].vercel-dns-017.com.' }],
        hint: '💡 After saving, go to your Vercel project → Settings → Domains and add this domain.',
        docs: 'https://vercel.com/docs/concepts/projects/custom-domains',
    },
    'github-pages': {
        records: [{ type: 'CNAME', name: '@', value: '[USERNAME].github.io' }],
        hint: '💡 Replace USERNAME with your GitHub username. Then enable Pages in your repo → Settings → Pages. ',
        docs: 'https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site',
    },
    netlify: {
        records: [{ type: 'CNAME', name: '@', value: 'your-site.netlify.app' }],
        hint: '💡 Replace with your actual Netlify site subdomain (found in Site settings → Domain management). ',
        docs: 'https://docs.netlify.com/domains-https/custom-domains/',
    },
    cloudflare: {
        records: [{ type: 'A', name: '@', value: '192.0.2.1' }],
        hint: '💡 Replace 192.0.2.1 with your actual origin server IP address. ',
        docs: 'https://developers.cloudflare.com/dns/',
    },
    render: {
        records: [{ type: 'CNAME', name: '@', value: 'your-service.onrender.com' }],
        hint: '💡 Replace with your Render service URL (found in the service dashboard). ',
        docs: 'https://render.com/docs/custom-domains',
    },
    railway: {
        records: [{ type: 'CNAME', name: '@', value: 'your-service.up.railway.app' }],
        hint: '💡 Replace with your Railway service URL (found in service → Settings → Networking). ',
        docs: 'https://docs.railway.app/deploy/custom-domains',
    },
    'fly.io': {
        records: [
            { type: 'A', name: '@', value: '66.241.125.1' },
            { type: 'AAAA', name: '@', value: '2a09:8280:1::1:b3b5' },
        ],
        hint: '💡 After saving, run: fly certs add yourdomain.id.thatako.net ',
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
        hint.innerHTML = `<span style="flex:1;">${tpl.hint}</span> ${tpl.docs ? `<a href="${tpl.docs}" target="_blank" rel="noopener" style="white-space:nowrap;font-size:11px;flex-shrink:0;">Docs <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>` : ''}`
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
    container.innerHTML = recordRows.map(r => `
    <div class="record-row" id="recrow-${r.id}">
      <span class="record-type-badge">${r.type}</span>
      <input type="text" id="rec-name-${r.id}" placeholder="name (e.g. @)" style="flex:1;"
        oninput="validateRecordConflicts()">
      <input type="text" id="rec-val-${r.id}" placeholder="value" style="flex:2;">
      <button class="btn btn-danger" onclick="removeRecord(${r.id})" title="ลบ record">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>`).join('')
}

// CNAME cannot share a name with A / AAAA / MX
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
        if (types.has('A') || types.has('AAAA')) conflicts.push(`"${name}" (CNAME + A/AAAA)`)
        if (types.has('MX')) conflicts.push(`"${name}" (CNAME + MX)`)
    }

    if (conflicts.length) {
        banner.style.display = 'flex'
        banner.innerHTML = `
          <i class="fa-solid fa-triangle-exclamation" style="flex-shrink:0;margin-top:1px;"></i>
          <span><strong>Record conflict:</strong> ${conflicts.join(', ')}
          a CNAME cannot coexist with A, AAAA, or MX on the same name.</span>`
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

const ghIdCache = {}
const lookupTimers = {}
const GH_DEBOUNCE = 600 // ms

window.scheduleGhLookup = function (rowId) {
    clearTimeout(lookupTimers[rowId])
    lookupTimers[rowId] = setTimeout(() => lookupGhId(rowId), GH_DEBOUNCE)
}

async function lookupGhId(rowId) {
    const ghInput = document.getElementById(`co-gh-${rowId}`)
    const statusEl = document.getElementById(`co-status-${rowId}`)
    const manualBox = document.getElementById(`co-manual-${rowId}`)
    const chipEl = document.getElementById(`co-chip-${rowId}`)
    if (!ghInput) return

    const username = ghInput.value.trim()
    if (!username) {
        setCoownerChip(chipEl, null)
        if (statusEl) statusEl.innerHTML = ''
        if (manualBox) manualBox.style.display = 'none'
        return
    }

    const key = username.toLowerCase()
    const cached = ghIdCache[key]
    if (cached) { setLookupSuccess(chipEl, statusEl, manualBox, cached); return }

    setLookupStatus(statusEl, '', '…')

    // 1. proxy serverside
    try {
        const res = await fetch(`${GH_PROXY}?username=${encodeURIComponent(username)}`)
        if (res.ok) {
            const data = await res.json()
            ghIdCache[key] = data
            setLookupSuccess(chipEl, statusEl, manualBox, data)
            return
        }
        if (res.status === 404) return notFound(chipEl, statusEl)
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
                setLookupSuccess(chipEl, statusEl, manualBox, info)
                return
            }
            if (res.status === 404) return notFound(chipEl, statusEl)
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
            setLookupSuccess(chipEl, statusEl, manualBox, info)
            return
        }
        if (res.status === 404) { notFound(chipEl, statusEl); return }
    } catch { }

    showManualIdBox(statusEl, manualBox, username)
}

function notFound(chipEl, statusEl) {
    setCoownerChip(chipEl, null)
    setLookupStatus(statusEl, 'error', 'ไม่พบผู้ใช้')
}

function setLookupStatus(el, type, text) {
    if (!el) return
    el.style.color = type === 'success' ? 'var(--color-success,#22c55e)'
        : type === 'error' ? 'var(--color-danger,#ef4444)'
            : type === 'warn' ? 'var(--color-warning,#f59e0b)'
                : 'var(--color-text-muted)'
    el.textContent = text
}

function setLookupSuccess(chipEl, statusEl, manualBox, data) {
    if (manualBox) manualBox.style.display = 'none'
    setLookupStatus(statusEl, 'success', '')
    setCoownerChip(chipEl, data)
}

// Update the co-owner chip to look like primaryOwnerChip
function setCoownerChip(chipEl, data) {
    if (!chipEl) return
    if (!data) {
        chipEl.style.display = 'none'
        return
    }
    chipEl.style.display = 'flex'
    chipEl.innerHTML = `
        <img src="${data.avatar_url}" alt="" width="18" height="18" style="border-radius:50%;">
        <strong>@${data.login}</strong>
        <span class="badge-primary-owner" style="background:var(--color-badge-muted-bg);color:var(--color-badge-muted-text);">Co-owner</span>
        <input type="hidden" id="co-id-hidden-${chipEl.dataset.rowid}" value="${data.id}">
    `
}

function showManualIdBox(statusEl, manualBox, username) {
    setLookupStatus(statusEl, 'warn', 'rate limited')
    if (!manualBox) return
    const apiUrl = `https://api.github.com/users/${encodeURIComponent(username)}`
    const profileUrl = `https://github.com/${encodeURIComponent(username)}`
    manualBox.style.display = ''
    manualBox.innerHTML = `
      <div class="manual-id-box-inner">
        <i class="fa-solid fa-triangle-exclamation" style="color:var(--color-warning,#f59e0b);flex-shrink:0;margin-top:2px;"></i>
        <div>
          <strong>GitHub API rate limited.</strong> ค้นหา ID ด้วยตนเอง:<br>
          1. เปิด <a href="${apiUrl}" target="_blank" rel="noopener">${apiUrl}</a><br>
          2. คัดลอก <code>"id"</code> ดังกล่าวแล้วนำไปวางในช่อง GitHub ID<br>
          <span class="muted">หรือเข้าไปที่ <a href="${profileUrl}" target="_blank" rel="noopener">${profileUrl}</a>
          และกด <kbd>Ctrl+U</kbd> (view source) ค้นหา <code>data-scope-id</code></span>
          <br><input type="number" id="co-manual-id-input-${manualBox.dataset.rowid}" placeholder="GitHub ID" min="1"
            style="margin-top:6px;max-width:160px;height:30px;font-size:12px;"
            oninput="applyManualId(${manualBox.dataset.rowid}, this.value)">
        </div>
      </div>`
}

window.applyManualId = function (rowId, value) {
    const id = parseInt(value)
    if (!id) return
    const ghInput = document.getElementById(`co-gh-${rowId}`)
    const chipEl = document.getElementById(`co-chip-${rowId}`)
    const manualBox = document.getElementById(`co-manual-${rowId}`)
    const statusEl = document.getElementById(`co-status-${rowId}`)
    const username = ghInput?.value.trim() || 'unknown'
    const data = { id, login: username, avatar_url: `https://avatars.githubusercontent.com/u/${id}?v=4` }
    ghIdCache[username.toLowerCase()] = data
    setLookupSuccess(chipEl, statusEl, manualBox, data)
}

// co-owner builder
let coownerRows = []
let coownerCounter = 0

window.addCoowner = function (github = '', githubId = '', email = '') {
    const id = ++coownerCounter
    _snapshotCoownerValues()
    coownerRows.push({ id, github, githubId, email, resolvedData: null })
    renderCoowners()

    if (github && !githubId) scheduleGhLookup(id)
    if (github && githubId) {
        const avatarUrl = `https://avatars.githubusercontent.com/u/${githubId}?v=4`
        const data = { id: githubId, login: github, avatar_url: avatarUrl }
        ghIdCache[github.toLowerCase()] = data
        const chipEl = document.getElementById(`co-chip-${id}`)
        const statusEl = document.getElementById(`co-status-${id}`)
        const manualBox = document.getElementById(`co-manual-${id}`)
        setLookupSuccess(chipEl, statusEl, manualBox, data)
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

    for (const r of coownerRows) {
        if (r.githubId && r.github) {
            const data = ghIdCache[r.github.toLowerCase()] || {
                id: r.githubId,
                login: r.github,
                avatar_url: `https://avatars.githubusercontent.com/u/${r.githubId}?v=4`
            }
            const chipEl = document.getElementById(`co-chip-${r.id}`)
            const statusEl = document.getElementById(`co-status-${r.id}`)
            const manualBox = document.getElementById(`co-manual-${r.id}`)
            setLookupSuccess(chipEl, statusEl, manualBox, data)
        }
    }
}

function renderCoowners() {
    const container = document.getElementById('coownersBuilder')
    container.innerHTML = coownerRows.map(r => `
    <div class="owner-row" id="corow-${r.id}">
      <div style="display:flex;flex-direction:column;gap:5px;grid-column:1/-1;">
        <div class="owner-input-group">
          <input type="text" id="co-gh-${r.id}" placeholder="GitHub username"
                 value="${r.github || ''}"
                 autocomplete="off" oninput="scheduleGhLookup(${r.id})">
          <input type="email" id="co-email-${r.id}" placeholder="Email (optional)"
                 value="${r.email || ''}"
                 autocomplete="off" style="max-width:200px;">
          <button class="btn btn-danger btn-icon" onclick="removeCoowner(${r.id})" title="ลบ co-owner">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <span id="co-status-${r.id}" class="gh-lookup-status"></span>
        <div class="owner-primary" id="co-chip-${r.id}" data-rowid="${r.id}" style="display:none;margin-bottom:0;"></div>
        <div class="manual-id-box" id="co-manual-${r.id}" data-rowid="${r.id}" style="display:none;"></div>
      </div>
    </div>`).join('')
}

function getCoownersPayload(auth) {
    _snapshotCoownerValues()
    const owners = [{
        github: auth.user.login,
        'github-id': auth.user.id,
        email: auth.user.email || '',
    }]
    for (const r of coownerRows) {
        const gh = r.github?.trim()
        const ghId = parseInt(r.githubId) || parseInt(document.getElementById(`co-id-hidden-${r.id}`)?.value)
        const email = r.email?.trim()
        if (gh && ghId) owners.push({ github: gh, 'github-id': ghId, email: email || '' })
    }
    return owners
}

// domain list
let domainsCache = []

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
        renderDomains()
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="3">
            <div class="empty-state">
                <div style="display:flex;justify-content:center">
                    <i class="fa-solid fa-circle-exclamation" style="color:var(--color-danger,#ef4444);font-size:20px;"></i>
                </div>
                <span>${e.message}</span>
                <div>
                    <button class="btn btn-ghost" onclick="document.getElementById('refreshBtn').click()"
                        style="font-size:11px;height:26px;margin-top:4px;">
                        ลองใหม่
                    </button>
                </div>
            </div>
        </td></tr>`
    }
}

function renderDomains() {
    const tbody = document.getElementById('domainsList')
    if (!domainsCache.length) {
        tbody.innerHTML = `<tr><td colspan="3">
            <div class="empty-state">
                <div style="display:flex;justify-content:center">
                    <i class="fa-solid fa-globe" style="font-size:24px;opacity:.35;"></i>
                </div>
                <span>ยังไม่มีโดเมน</span>
            </div></td></tr>`
        return
    }
    tbody.innerHTML = domainsCache.map(d => `
    <tr>
        <td class="domain-name">
            <a href="https://${d.domain}" target="_blank" rel="noopener">${d.domain}</a>
        </td>
        <td><span class="host-badge">${(d.host || []).join(', ')}</span></td>
        <td>
            <div class="domain-actions">
            <button class="btn btn-ghost" onclick="editDomain('${d.domain}')" title="แก้ไข">
                <i class="fa-solid fa-pen"></i>
            </button>
            <button class="btn btn-danger" onclick="confirmDelete('${d.domain}')" title="ลบ">
                <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
    </tr>`).join('')
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

    // validate: lowercase letters, digits, hyphens; no leading/trailing hyphen
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

    // populate user chip
    document.getElementById('userAvatar').src = auth.user.avatar_url
    document.getElementById('userLogin').textContent = auth.user.login
    document.getElementById('primaryOwnerAvatar').src = auth.user.avatar_url
    document.getElementById('primaryOwnerLogin').textContent = '@' + auth.user.login

    document.getElementById('logoutBtn').onclick = () => { clearAuth(); location.reload() }
    document.getElementById('refreshBtn').onclick = () => loadDomains(auth)
    document.getElementById('submitBtn').onclick = () => submitForm(auth)
    document.getElementById('formResetBtn').onclick = resetForm

    // host template
    document.getElementById('hostSelect').addEventListener('change', e => applyHostTemplate(e.target.value))

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

    loadDomains(auth)
}

document.addEventListener('DOMContentLoaded', () => {
    // check OAuth
    const params = new URLSearchParams(window.location.search)

    // auth token forwarded OAuth callback
    if (params.has('authed')) {
        const authParam = params.get('auth')
        if (authParam) try { saveAuth(JSON.parse(decodeURIComponent(authParam))) } catch { }
        history.replaceState({}, '', window.location.pathname)
    }

    const auth = getAuth()
    if (auth) showDashboard(auth)
    else document.getElementById('loginBtn').onclick = startLogin
})