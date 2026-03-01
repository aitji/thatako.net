const AUTH_URL = 'https://dev.thatako.net/api/auth'
const WORKER_URL = 'https://workers.thatako.net'

// auth helpers
function getAuth() { try { return JSON.parse(sessionStorage.getItem('auth') || 'null') } catch { return null } }
function clearAuth() { sessionStorage.removeItem('auth') }
function startLogin() {
    sessionStorage.setItem('oauth_return', window.location.href)
    window.location.href = AUTH_URL + '?return=' + encodeURIComponent(window.location.href)
}

// toast
function toast(msg, type = 'info') {
    const c = document.getElementById('toasts')
    const t = document.createElement('div')
    t.className = 'toast' + (type === 'error' ? ' error' : '')
    const icon = type === 'error' ? 'fa-circle-xmark' : type === 'success' ? 'fa-circle-check' : 'fa-circle-info'
    t.innerHTML = `<i class="fa-solid ${icon}"></i><span>${msg}</span><button class="toast-close"><i class="fa-solid fa-xmark"></i></button>`
    t.querySelector('.toast-close').onclick = () => t.remove()
    c.appendChild(t)
    setTimeout(() => t.remove(), 5000)
}

// record builder
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
}

window.removeRecord = function (id) {
    recordRows = recordRows.filter(r => r.id !== id)
    renderRecords()
}

function renderRecords() {
    const container = document.getElementById('recordsBuilder')
    container.innerHTML = recordRows.map(r => `
    <div class="record-row" id="recrow-${r.id}">
      <span class="record-type-badge">${r.type}</span>
      <input type="text" id="rec-name-${r.id}" placeholder="name (e.g. @)" style="flex:1;">
      <input type="text" id="rec-val-${r.id}" placeholder="value" style="flex:2;">
      <button class="btn btn-danger" onclick="removeRecord(${r.id})" title="ลบ record">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>
  `).join('')
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

// co-owner builder
let coownerRows = []
let coownerCounter = 0

window.addCoowner = function (github = '', githubId = '', email = '') {
    const id = ++coownerCounter
    coownerRows.push({ id })
    renderCoowners()
    if (github) document.getElementById(`co-gh-${id}`).value = github
    if (githubId) document.getElementById(`co-id-${id}`).value = githubId
    if (email) document.getElementById(`co-email-${id}`).value = email
}

window.removeCoowner = function (id) {
    coownerRows = coownerRows.filter(r => r.id !== id)
    renderCoowners()
}

function renderCoowners() {
    const container = document.getElementById('coownersBuilder')
    container.innerHTML = coownerRows.map(r => `
    <div class="owner-row" id="corow-${r.id}">
      <input type="text" id="co-gh-${r.id}" placeholder="GitHub login" autocomplete="off">
      <input type="number" id="co-id-${r.id}" placeholder="GitHub ID" autocomplete="off">
      <input type="email" id="co-email-${r.id}" placeholder="Email" autocomplete="off" style="grid-column:1/-2;">
      <button class="btn btn-danger" onclick="removeCoowner(${r.id})" title="ลบ co-owner">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>`).join('')

    document.querySelectorAll('.owner-row').forEach(row => { row.style.gridTemplateColumns = '1fr 120px 1fr auto' })
}

function getCoownersPayload(auth) {
    const owners = [{
        github: auth.user.login,
        'github-id': auth.user.id,
        email: auth.user.email || ''
    }]

    for (const r of coownerRows) {
        const gh = document.getElementById(`co-gh-${r.id}`)?.value.trim()
        const ghId = parseInt(document.getElementById(`co-id-${r.id}`)?.value.trim())
        const email = document.getElementById(`co-email-${r.id}`)?.value.trim()
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
            method: 'GET',
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
    } catch (e) { tbody.innerHTML = `<tr><td colspan="3"><div class="empty-state"><div style="display:flex;justify-content:center"><i class="fa-solid fa-circle-exclamation"></div></i>${e.message}</div></td></tr>` }
}

function renderDomains() {
    const tbody = document.getElementById('domainsList')
    if (!domainsCache.length) {
        tbody.innerHTML = `<tr><td colspan="3"><div class="empty-state"><div style="display:flex;justify-content:center"><i class="fa-solid fa-globe"></div></i>ยังไม่มีโดเมน</div></td></tr>`
        return
    }
    tbody.innerHTML = domainsCache.map(d => `
    <tr>
      <td class="domain-name"><a href="https://${d.domain}" target="_blank" rel="noopener">${d.domain}</a></td>
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
    document.getElementById('submitLabel').textContent = isEdit ? 'บันทึกการแก้ไข' : 'ลงทะเบียนโดเมน'
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
    setFormMode(null)
}

window.editDomain = function (domain) {
    const d = domainsCache.find(x => x.domain === domain)
    if (!d) return

    resetForm()
    setFormMode(domain)

    // populate subdomain (read)
    const sub = domain.split('.id.thatako.net')[0]
    document.getElementById('subdomain').value = sub

    // host
    const hostVal = (d.host || [])[0] || 'other'
    const sel = document.getElementById('hostSelect')
    for (const opt of sel.options) { if (opt.value === hostVal) { sel.value = hostVal; break } }

    // record
    for (const [type, recs] of Object.entries(d.records || {})) {
        for (const rec of (Array.isArray(recs) ? recs : [recs])) {
            addRecord(type, rec.name || rec, rec.value || rec)
        }
    }

    const coowners = (d.owner || []).slice(1)
    for (const o of coowners) addCoowner(o.github, o['github-id'], o.email)

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
    document.getElementById('deleteModal').classList.remove('open')

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

    const host = [document.getElementById('hostSelect').value]
    const domain = `${subdomain}.id.thatako.net`
    const records = getRecordsPayload()
    const owner = getCoownersPayload(auth)

    if (!Object.keys(records).length) { toast('กรุณาเพิ่มอย่างน้อย 1 DNS record', 'error'); return }

    const payload = { domain, host, owner, records }

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
        toast(data.action === 'update' ? 'อัปเดตโดเมนสำเร็จ' : 'ลงทะเบียนโดเมนสำเร็จ', 'success')
        resetForm()
        loadDomains(auth)
    } catch (e) { toast(e.message, 'error') }
    finally {
        btn.disabled = false
        btn.innerHTML = `<i class="fa-solid fa-check"></i><span id="submitLabel">${editingDomain ? 'บันทึกการแก้ไข' : 'ลงทะเบียนโดเมน'}</span>`
    }
}

// init
function showDashboard(auth) {
    document.getElementById('authGate').classList.add('hidden')
    document.getElementById('dashboard').classList.add('visible')

    // populate user chip
    document.getElementById('userAvatar').src = auth.user.avatar_url
    document.getElementById('userLogin').textContent = auth.user.login
    document.getElementById('primaryOwnerAvatar').src = auth.user.avatar_url
    document.getElementById('primaryOwnerLogin').textContent = '@' + auth.user.login

    // wire-up buttons
    document.getElementById('logoutBtn').onclick = () => { clearAuth(); location.reload() }
    document.getElementById('refreshBtn').onclick = () => loadDomains(auth)
    document.getElementById('submitBtn').onclick = () => submitForm(auth)
    document.getElementById('formResetBtn').onclick = resetForm

    // modal
    document.getElementById('deleteModalClose').onclick = () => document.getElementById('deleteModal').classList.remove('open')
    document.getElementById('deleteModalCancel').onclick = () => document.getElementById('deleteModal').classList.remove('open')
    document.getElementById('deleteModalConfirm').onclick = () => deleteDomain(auth)

    // load domains
    loadDomains(auth)
}

document.addEventListener('DOMContentLoaded', () => {
    // check OAuth
    const params = new URLSearchParams(window.location.search)
    if (params.has('authed')) history.replaceState({}, '', window.location.pathname)

    const auth = getAuth()
    if (auth) showDashboard(auth)
    else document.getElementById('loginBtn').onclick = startLogin
})