const PARALLEL = 3
const RETRIES = 3
const NO_RETRY = ['bad token', 'bad part', 'bad size']

import { $, esc, icon, SEP, joinHtml, meta, fmtSize, fmtEta, skLine } from './ui.js'
export { fmtSize }

const GIS = 'https://accounts.google.com/gsi/client'
const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const DRIVE = 'https://www.googleapis.com/drive/v3'
const DRIVE_UP = 'https://www.googleapis.com/upload/drive/v3/files'
const DRIVE_CHUNK = 16 * 1024 * 1024
const FOLDER = 'go.thatako.net'

let ctx, mode = 'link', store = 'server', picked = [], busy = false, adding = false, ctl = null, lim = null
let gisP = null, tok = null, tokExp = 0, me = null

export const isFileMode = () => mode === 'file'

export const uploadErr = (m, fallback = 'อัปโหลดล้มเหลว กรุณาลองใหม่') => errText(m, fallback)
const errText = (m, fallback = 'อัปโหลดล้มเหลว กรุณาลองใหม่') => ({
    'key quota': 'โควตาของรหัสลับนี้เต็มแล้ว กรุณาลบไฟล์เก่าก่อน',
    'too big': 'ขนาดไฟล์รวมเกินกำหนดต่อครั้ง',
    'bad files': 'จำนวนหรือขนาดไฟล์ไม่ถูกต้อง',
    'duplicate': 'ชื่อนี้ถูกใช้แล้ว ลองเปลี่ยนชื่อหรือปล่อยว่างให้ระบบสุ่ม',
    'bad slug': 'ชื่อลิงก์ย่อไม่ถูกต้อง',
    'storage full': 'พื้นที่เซิร์ฟเวอร์เต็มแล้ว ลองเลือก Google Drive แทน',
    'drive off': 'ยังไม่ได้ตั้งค่า Google Drive บนระบบนี้',
    'drive auth': 'เชื่อมต่อ Google Drive ไม่สำเร็จ กรุณาลองใหม่',
    'drive denied': 'ตรวจสอบไฟล์ใน Google Drive ไม่ผ่าน กรุณาลองใหม่',
    'drive quota': 'พื้นที่ Google Drive ของคุณเต็ม',
    'drive failed': 'อัปโหลดไป Google Drive ล้มเหลว กรุณาลองใหม่',
    'expired': 'ลิงก์นี้หมดอายุแล้ว แก้ไขไม่ได้',
    'too many files': 'จำนวนไฟล์ในลิงก์เกินกำหนด',
    'last file': 'ต้องเหลืออย่างน้อย 1 ไฟล์ ถ้าไม่ต้องการแล้วให้ลบทั้งลิงก์',
    'not found': 'ไม่พบลิงก์นี้ หรือรหัสลับไม่ตรงกัน',
    'no such file': 'ไม่พบไฟล์นี้ในลิงก์ (อาจถูกเอาออกไปแล้ว)',
    'bad name': 'ชื่อไฟล์ไม่ถูกต้อง',
    'cancelled': 'ยกเลิกการอัปโหลดแล้ว',
    'busy': 'กำลังอัปโหลดอยู่ กรุณารอให้เสร็จก่อน',
}[m] || fallback)

const post = async (path, body) => (await fetch(ctx.api + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
})).json()

// ui
const setMode = m => {
    if (busy) return
    mode = m
    $('modeLink').classList.toggle('active', m === 'link')
    $('modeFile').classList.toggle('active', m === 'file')
    $('urlField').hidden = m === 'file'
    $('fileField').hidden = m !== 'file'
    $('slug').placeholder = m === 'file' ? 'เว้นว่างเพื่อสุ่มชื่อ' : 'openhouse2026'
    $('createLabel').textContent = m === 'file' ? 'อัปโหลดและสร้างลิงก์' : 'สร้างลิงก์ย่อ'
    if (m === 'file') {
        if (!lim) $('limits').innerHTML = skLine('60%', 'sm')
        loadUsage().then(syncStore)
    }
}

const syncStore = () => {
    const d = store === 'drive'
    $('driveBox').hidden = !d
    $('ageField').hidden = d
    $('usageBox').hidden = d
    if (!lim) return
    $('limits').innerHTML = d
        ? meta(['ตามพื้นที่ Drive ของคุณ', `สูงสุด ${lim.maxFiles} ไฟล์`, 'ไม่หมดอายุ'])
        : meta([`สูงสุด ${fmtSize(lim.perUpload)} ต่อครั้ง`, `${lim.maxFiles} ไฟล์`, `เก็บได้ ${lim.maxDays} วัน`])
    $('driveConnect').disabled = !lim.driveClientId
    if (d && !lim.driveClientId) $('driveStatus').textContent = 'ยังไม่ได้ตั้งค่า Google Drive บนระบบนี้'
    else if (d && !me && !$('driveStatus').textContent) $('driveStatus').textContent = 'ยังไม่ได้เชื่อมต่อ Google Drive'
}

const setStore = v => {
    if (busy) return
    store = v
    syncStore()
}

const bar = (el, pct) => el.style.width = Math.min(100, pct) + '%'
const setStatus = html => { $('upText').innerHTML = html }
const idleStatus = () => {
    const total = picked.reduce((a, f) => a + f.size, 0)
    setStatus(picked.length ? meta([`เลือกแล้ว ${picked.length} ไฟล์`, fmtSize(total)]) : 'ยังไม่ได้เลือกไฟล์')
}
const progressText = (sent, total, sp) => {
    const eta = sp > 0 ? Math.round((total - sent) / sp) : 0
    setStatus(meta([`${fmtSize(sent)} / ${fmtSize(total)}`, `${fmtSize(sp)}/s`, `เหลือ ~${fmtEta(eta)}`]))
}

const loadUsage = async () => {
    if (!lim) {
        $('usageBox').classList.add('loading')
        $('usageText').innerHTML = skLine('72%', 'sm')
    }

    try {
        lim = await (await fetch(`${ctx.api}/usage?key=${encodeURIComponent(ctx.key())}`)).json()
        $('usageText').innerHTML = meta([`พื้นที่รวม ${fmtSize(lim.used)} / ${fmtSize(lim.limit)}`, `ของคุณ ${fmtSize(lim.mine)} / ${fmtSize(lim.perKey)}`])
        bar($('usageBar'), lim.used / lim.limit * 100)
        $('usageBar').classList.toggle('warn', lim.used / lim.limit > 0.85)
    } catch { if (!lim) $('usageText').textContent = 'โหลดข้อมูลพื้นที่ไม่สำเร็จ' }
    $('usageBox').classList.remove('loading')
}

const renderPicked = () => {
    const ul = $('upList')
    ul.innerHTML = ''
    picked.forEach((f, i) => {
        const li = document.createElement('li')
        const name = document.createElement('span')
        name.className = 'up-name'
        name.textContent = f.name
        name.title = f.name
        const size = document.createElement('small')
        size.textContent = fmtSize(f.size)
        const rm = document.createElement('button')
        rm.type = 'button'
        rm.className = 'up-rm'
        rm.title = 'เอาออก'
        rm.setAttribute('aria-label', `เอา ${f.name} ออก`)
        rm.innerHTML = icon('xmark')
        rm.onclick = () => { if (!busy) { picked.splice(i, 1); renderPicked() } }
        li.append(name, size, rm)
        ul.appendChild(li)
    })
    if (!busy) idleStatus()
}

const addFiles = list => {
    for (const f of list) {
        if (!f.size) { ctx.toast(`ข้ามไฟล์ว่าง: ${f.name}`, false); continue }
        if (!picked.some(p => p.name === f.name && p.size === f.size && p.lastModified === f.lastModified)) picked.push(f)
    }
    renderPicked()
}

const lock = v => {
    busy = v
    $('upProg').classList.toggle('idle', !v)
    $('upCancel').disabled = !v
    $('create').disabled = v
    $('files').disabled = v
    $('modeLink').disabled = $('modeFile').disabled = v
    $('store').disabled = $('driveConnect').disabled = $('driveLogout').disabled = v
}

// upload engine
const putChunk = async (url, blob, onBytes) => {
    for (let a = 0; ; a++) {
        let last = 0
        try {
            return await new Promise((res, rej) => {
                const x = new XMLHttpRequest()
                ctl.xhrs.add(x)
                x.open('PUT', url)
                x.upload.onprogress = e => { onBytes(e.loaded - last); last = e.loaded }
                x.onload = () => {
                    ctl.xhrs.delete(x)
                    let r
                    try { r = JSON.parse(x.responseText) } catch { }
                    r?.ok ? res(r.etag) : rej(new Error(r?.msg || 'http ' + x.status))
                }
                x.onerror = x.onabort = () => { ctl.xhrs.delete(x); rej(new Error('network')) }
                x.send(blob)
            })
        } catch (e) {
            onBytes(-last)
            if (ctl.stop || a >= RETRIES || NO_RETRY.includes(e.message)) throw e
            await new Promise(r => setTimeout(r, 1000 * 2 ** a))
        }
    }
}

const uploadFile = async (file, token, chunk, onBytes) => {
    const n = Math.ceil(file.size / chunk), parts = new Array(n)
    let next = 0
    const lane = async () => {
        while (next < n && !ctl.stop) {
            const i = next++
            try {
                const etag = await putChunk(`${ctx.api}/file/chunk?t=${encodeURIComponent(token)}&n=${i + 1}`,
                    file.slice(i * chunk, (i + 1) * chunk), onBytes)
                parts[i] = { partNumber: i + 1, etag }
            } catch (e) { ctl.stop = true; throw e }
        }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL, n) }, lane))
    if (ctl.stop) throw new Error('stopped')
    return parts
}

// google drive
const loadGIS = () => gisP ??= new Promise((res, rej) => {
    if (window.google?.accounts?.oauth2) return res()
    const s = document.createElement('script')
    s.src = GIS
    s.async = true
    s.onload = res
    s.onerror = () => { gisP = null; rej(new Error('drive auth')) }
    document.head.appendChild(s)
})

const getToken = async (pickAccount = false) => {
    if (!pickAccount && tok && Date.now() < tokExp - 60_000) return tok
    if (!lim?.driveClientId) throw new Error('drive off')
    await loadGIS()
    return new Promise((res, rej) => {
        google.accounts.oauth2.initTokenClient({
            client_id: lim.driveClientId,
            scope: SCOPE,
            callback: r => {
                if (!r.access_token) return rej(new Error('drive auth'))
                tok = r.access_token
                tokExp = Date.now() + (+r.expires_in || 3600) * 1000
                res(tok)
            },
            error_callback: () => rej(new Error('drive auth')),
        }).requestAccessToken(pickAccount ? { prompt: 'select_account' } : { include_granted_scopes: true })
    })
}

const gfetch = async (url, opt = {}) => {
    const t = await getToken()
    return fetch(url, { ...opt, headers: { authorization: `Bearer ${t}`, ...opt.headers } })
}

const driveErr = async r => {
    let reason = ''
    try { reason = (await r.json()).error?.errors?.[0]?.reason || '' } catch { }
    if (/quota|storage/i.test(reason)) return new Error('drive quota')
    return new Error(r.status === 401 ? 'drive auth' : 'drive failed')
}

const showDrive = () => {
    const on = !!me
    $('driveBtnText').textContent = on ? 'เปลี่ยนบัญชี' : 'เชื่อมต่อ Google Drive'
    $('driveLogout').hidden = !on
    if (!on) return
    const q = me.storageQuota
    const free = q?.limit ? `ว่าง ${fmtSize(q.limit - q.usage)}` : ''
    $('driveStatus').innerHTML = `${icon('circle-check', 'ok')} ${meta([`เชื่อมต่อแล้ว: ${me.user?.emailAddress || me.user?.displayName || 'Google'}`, free])}`
}

const connectDrive = async () => {
    const switching = !!me
    const prev = { tok, tokExp, me }
    try {
        $('driveStatus').innerHTML = `<span class="spinner" aria-hidden="true"></span>กำลังเชื่อมต่อ`
        if (switching) tok = null
        await getToken(switching)
        const r = await gfetch(`${DRIVE}/about?fields=user(displayName,emailAddress),storageQuota(limit,usage)`)
        if (!r.ok) throw await driveErr(r)
        me = await r.json()
        showDrive()
    } catch (e) {
        if (switching) ({ tok, tokExp, me } = prev)
        $('driveStatus').textContent = errText(e.message)
        if (switching) setTimeout(showDrive, 2500)
    }
}

const disconnectDrive = async () => {
    const old = tok
    tok = null; tokExp = 0; me = null
    if (old && window.google?.accounts?.oauth2) await new Promise(res => google.accounts.oauth2.revoke(old, res))
    showDrive()
    $('driveStatus').textContent = 'ยังไม่ได้เชื่อมต่อ Google Drive'
}

const ensureFolder = async () => {
    try {
        const q = encodeURIComponent(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`)
        const f = await gfetch(`${DRIVE}/files?q=${q}&fields=files(id)&pageSize=1`)
        if (f.ok) { const id = (await f.json()).files?.[0]?.id; if (id) return id }
        const c = await gfetch(`${DRIVE}/files?fields=id`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' })
        })
        if (c.ok) return (await c.json()).id
    } catch { }
    return null
}

const putDriveChunk = (url, blob, from, total, onBytes) => new Promise((res, rej) => {
    const x = new XMLHttpRequest()
    let last = 0
    ctl.xhrs.add(x)
    x.open('PUT', url)
    x.setRequestHeader('content-range', `bytes ${from}-${from + blob.size - 1}/${total}`)
    x.upload.onprogress = e => { onBytes(e.loaded - last); last = e.loaded }
    x.onload = () => {
        ctl.xhrs.delete(x)
        if (x.status === 308) return res(null)
        if (x.status === 200 || x.status === 201) { try { return res(JSON.parse(x.responseText).id) } catch { } }
        onBytes(-last)
        rej(new Error(x.status === 403 && /quota|storage/i.test(x.responseText) ? 'drive quota' : 'drive failed'))
    }
    x.onerror = x.onabort = () => { ctl.xhrs.delete(x); onBytes(-last); rej(new Error('network')) }
    x.send(blob)
})

const uploadToDrive = async (file, folder, onBytes) => {
    const type = file.type || 'application/octet-stream'
    const r = await gfetch(`${DRIVE_UP}?uploadType=resumable&fields=id`, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': type, 'x-upload-content-length': String(file.size) },
        body: JSON.stringify({ name: file.name, mimeType: type, ...(folder && { parents: [folder] }) })
    })
    if (!r.ok) throw await driveErr(r)
    const url = r.headers.get('location')
    if (!url) throw new Error('drive failed')

    let id = null
    for (let from = 0; from < file.size && !ctl.stop; from += DRIVE_CHUNK) {
        const blob = file.slice(from, from + DRIVE_CHUNK)
        for (let a = 0; ; a++) {
            try { id = await putDriveChunk(url, blob, from, file.size, onBytes); break }
            catch (e) {
                if (ctl.stop || a >= RETRIES || e.message !== 'network') throw e
                await new Promise(r => setTimeout(r, 1000 * 2 ** a))
            }
        }
    }
    if (ctl.stop) throw new Error('stopped')
    if (!id) throw new Error('drive failed')

    const p = await gfetch(`${DRIVE}/files/${id}/permissions`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'reader', type: 'anyone', allowFileDiscovery: false })
    })
    if (!p.ok) throw await driveErr(p)
    return id
}

const startDriveUpload = async () => {
    const key = ctx.key(), slug = $('slug').value.trim()
    const total = picked.reduce((a, f) => a + f.size, 0)

    if (!key) return ctx.toast('กรุณาใส่รหัสลับ', false)
    if (!picked.length) return ctx.toast('กรุณาเลือกไฟล์ก่อน', false)
    if (slug && !ctx.validSlug(slug)) return ctx.toast('ชื่อลิงก์ย่อไม่ถูกต้อง', false)
    if (!lim?.driveClientId) return ctx.toast(errText('drive off'), false)
    if (picked.length > lim.maxFiles) return ctx.toast(errText('bad files'), false)

    ctl = { stop: false, cancelled: false, xhrs: new Set() }
    lock(true)
    setStatus('กำลังเชื่อมต่อ Google Drive')
    bar($('upBar'), 0)

    try {
        await getToken()
        const q = me?.storageQuota
        if (q?.limit && +q.usage + total > +q.limit) throw new Error('drive quota')

        const folder = await ensureFolder()
        let sent = 0
        const t0 = Date.now()
        const onBytes = d => {
            sent += d
            bar($('upBar'), sent / total * 100)
            progressText(sent, total, sent / Math.max(1, (Date.now() - t0) / 1000))
        }

        const files = []
        for (const f of picked) files.push({ id: await uploadToDrive(f, folder, onBytes) })

        setStatus('กำลังสร้างลิงก์')
        const fin = await post('/file/drive', { key, slug, token: await getToken(), files })
        if (!fin.ok) throw new Error(fin.msg)

        ctx.toast(`อัปโหลดสำเร็จ: go.thatako.net/${fin.slug}`)
        picked = []
        renderPicked()
        $('slug').value = ''
        await ctx.reload()
    } catch (e) {
        ctx.toast(ctl.cancelled ? 'ยกเลิกการอัปโหลดแล้ว' : errText(e.message), false)
    }
    lock(false)
}

export const startUpload = async () => {
    if (busy) return
    if (adding) return ctx.toast(errText('busy'), false)
    if (store === 'drive') return startDriveUpload()
    const key = ctx.key(), slug = $('slug').value.trim()
    const total = picked.reduce((a, f) => a + f.size, 0)

    if (!key) return ctx.toast('กรุณาใส่รหัสลับ', false)
    if (!picked.length) return ctx.toast('กรุณาเลือกไฟล์ก่อน', false)
    if (slug && !ctx.validSlug(slug)) return ctx.toast('ชื่อลิงก์ย่อไม่ถูกต้อง', false)
    if (lim && total > lim.perUpload) return ctx.toast(errText('too big'), false)

    ctl = { stop: false, cancelled: false, xhrs: new Set() }
    lock(true)
    setStatus('กำลังเตรียมอัปโหลด')
    bar($('upBar'), 0)

    let tokens = []
    try {
        const init = await post('/file/init', {
            key, slug, days: +$('days').value,
            files: picked.map(f => ({ name: f.name, size: f.size, type: f.type }))
        })
        if (!init.ok) throw new Error(init.msg)
        tokens = init.files.map(f => f.token)

        let sent = 0
        const t0 = Date.now()
        const onBytes = d => {
            sent += d
            bar($('upBar'), sent / total * 100)
            progressText(sent, total, sent / Math.max(1, (Date.now() - t0) / 1000))
        }

        const files = []
        for (const [i, f] of picked.entries()) {
            const parts = await uploadFile(f, tokens[i], init.chunk, onBytes)
            files.push({ token: tokens[i], type: f.type, parts })
        }

        setStatus('กำลังรวมไฟล์')
        const fin = await post('/file/done', { key, slug: init.slug, files })
        if (!fin.ok) throw new Error(fin.msg)

        ctx.toast(`อัปโหลดสำเร็จ: go.thatako.net/${fin.slug}`)
        picked = []
        renderPicked()
        $('slug').value = ''
        await ctx.reload()
    } catch (e) {
        if (tokens.length) post('/file/abort', { tokens }).catch(() => { })
        ctx.toast(ctl.cancelled ? 'ยกเลิกการอัปโหลดแล้ว' : errText(e.message), false)
    }
    lock(false)
    loadUsage()
}

export const uploadMore = async ({ slug, type, files, onProgress }) => {
    if (busy || adding) throw new Error('busy')
    const key = ctx.key()
    const total = files.reduce((a, f) => a + f.size, 0)

    ctl = { stop: false, cancelled: false, xhrs: new Set() }
    adding = true
    let tokens = []
    let sent = 0
    const t0 = Date.now()
    const onBytes = d => { sent += d; onProgress(sent, total, Math.max(1, (Date.now() - t0) / 1000)) }

    try {
        if (type === 'drive') {
            if (!lim) await loadUsage()
            if (!lim?.driveClientId) throw new Error('drive off')
            await getToken()
            const folder = await ensureFolder()
            const ids = []
            for (const f of files) ids.push({ id: await uploadToDrive(f, folder, onBytes) })
            const fin = await post('/file/drive-add', { key, slug, token: await getToken(), files: ids })
            if (!fin.ok) throw new Error(fin.msg)
            return fin
        }

        const init = await post('/file/add-init', { key, slug, files: files.map(f => ({ name: f.name, size: f.size, type: f.type })) })
        if (!init.ok) throw new Error(init.msg)
        tokens = init.files.map(f => f.token)

        const done = []
        for (const [i, f] of files.entries()) {
            const parts = await uploadFile(f, tokens[i], init.chunk, onBytes)
            done.push({ token: tokens[i], type: f.type, parts })
        }
        const fin = await post('/file/add-done', { key, slug, files: done })
        if (!fin.ok) throw new Error(fin.msg)
        return fin
    } catch (e) {
        if (tokens.length) post('/file/abort', { tokens }).catch(() => { })
        throw ctl.cancelled ? new Error('cancelled') : e
    } finally {
        adding = false
        loadUsage()
    }
}

export const cancelMore = () => {
    if (!ctl) return
    ctl.cancelled = ctl.stop = true
    ctl.xhrs.forEach(x => x.abort())
}

export const initUpload = c => {
    ctx = c
    idleStatus()
    $('upCancel').disabled = true
    $('modeLink').onclick = () => setMode('link')
    $('modeFile').onclick = () => setMode('file')
    $('store').onchange = e => setStore(e.target.value)
    $('driveConnect').onclick = connectDrive
    $('driveLogout').onclick = disconnectDrive
    $('files').onchange = e => { addFiles(e.target.files); e.target.value = '' }
    $('upCancel').onclick = () => { ctl.cancelled = ctl.stop = true; ctl.xhrs.forEach(x => x.abort()) }

    const drop = $('drop')
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over') }
    drop.ondragleave = () => drop.classList.remove('over')
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); if (!busy) addFiles(e.dataTransfer.files) }

    window.addEventListener('beforeunload', e => { if (busy || adding) e.preventDefault() })
}
