const PARALLEL = 3
const RETRIES = 3
const NO_RETRY = ['bad token', 'bad part', 'bad size']
const FALLBACK = ['storage full', 'key quota', 'too big', 'not allowed', 'perm full']
const GSI = 'https://accounts.google.com/gsi/client'
const GAPI = 'https://www.googleapis.com/drive/v3'
const FOLDER = 'application/vnd.google-apps.folder'
const G_CHUNK = 16 * 1024 * 1024

const $ = id => document.getElementById(id)
let ctx, mode = 'link', picked = [], busy = false, ctl = null, lim = null, gcfg = null

export const isFileMode = () => mode === 'file'
export const fmtSize = b => {
    const u = ['B', 'KB', 'MB', 'GB'] // hope end at GB
    let i = 0
    while (b >= 1024 && i < 4) { b /= 1024; i++ }
    return `${b >= 100 || !i ? Math.round(b) : b.toFixed(1)} ${u[i]}`
}

const errText = m => ({
    'storage full': 'พื้นที่เก็บไฟล์เต็มแล้ว กรุณาลองใหม่ภายหลัง',
    'key quota': 'โควตาของรหัสลับนี้เต็มแล้ว กรุณาลบไฟล์เก่าก่อน',
    'too big': 'ขนาดไฟล์รวมเกินกำหนดต่อครั้ง',
    'bad files': 'จำนวนหรือขนาดไฟล์ไม่ถูกต้อง',
    'duplicate': 'ชื่อนี้ถูกใช้แล้ว ลองเปลี่ยนชื่อหรือปล่อยว่างให้ระบบสุ่ม',
    'bad slug': 'ชื่อลิงก์ย่อไม่ถูกต้อง',
    'drive bad link': 'ลิงก์ Google Drive ไม่ถูกต้อง',
    'drive no access': 'ระบบเข้าถึงไฟล์นี้ไม่ได้ ตรวจสอบว่าแชร์ให้อีเมลด้านบนแล้ว',
    'drive native': 'ไม่รองรับ Google Docs/Sheets/Slides กรุณาอัปโหลดเป็นไฟล์ปกติ (เช่น PDF)',
    'drive used': 'ไฟล์หรือโฟลเดอร์นี้ถูกใช้สร้างลิงก์แล้ว',
    'drive bad login': 'ยืนยันบัญชี Google ไม่สำเร็จ กรุณาลองใหม่',
    'drive not owner': 'คุณไม่ใช่เจ้าของโฟลเดอร์นี้',
    'login': 'ไม่ได้เข้าสู่ระบบ Google',
}[m] || 'อัปโหลดล้มเหลว กรุณาลองใหม่')

const post = async (path, body) => (await fetch(ctx.api + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
})).json()

// ui
const setMode = (m, note) => {
    if (busy) return
    mode = m
    for (const [id, k] of [['modeLink', 'link'], ['modeFile', 'file'], ['modeDrive', 'drive']]) $(id).classList.toggle('active', k === m)
    $('urlField').hidden = m !== 'link'
    $('fileField').hidden = m !== 'file'
    $('driveField').hidden = m !== 'drive'
    $('create').hidden = m === 'drive'
    $('driveNote').hidden = !note
    if (m !== 'link') $(m === 'file' ? 'fileSlot' : 'driveSlot').append($('pickBox'))
    $('slug').placeholder = m === 'link' ? 'openhouse2026' : 'เว้นว่างเพื่อสุ่มชื่อ'
    $('createLabel').textContent = m === 'file' ? 'อัปโหลดและสร้างลิงก์' : 'สร้างลิงก์ย่อ'
    if (m === 'file') loadUsage()
    if (m === 'drive') loadDrive()
}

const bar = (el, pct) => el.style.width = Math.min(100, pct) + '%'
const loadUsage = async () => {
    try {
        lim = await (await fetch(`${ctx.api}/usage?key=${encodeURIComponent(ctx.key())}`)).json()
        $('limits').textContent = `สูงสุด ${fmtSize(lim.perUpload)} ต่อครั้ง · ${lim.maxFiles} ไฟล์ · เก็บได้ ${lim.maxDays} วัน`
        $('usageText').textContent = `โควตาของคุณ ${fmtSize(lim.mine)} / ${fmtSize(lim.perKey)}` +
            (lim.canPermanent ? ` · ถาวร ${fmtSize(lim.permanent)} / ${fmtSize(lim.permLimit)}` : '')
        bar($('usageBar'), lim.mine / lim.perKey * 100)
        $('usageBar').classList.toggle('warn', lim.mine / lim.perKey > 0.85)
    } catch { /* usage is optional info */ }
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
        rm.textContent = '×'
        rm.onclick = () => { if (!busy) { picked.splice(i, 1); renderPicked() } }
        li.append(name, size, rm)
        ul.appendChild(li)
    })
    const total = picked.reduce((a, f) => a + f.size, 0)
    $('upTotal').textContent = picked.length ? `${picked.length} ไฟล์ · ${fmtSize(total)}` : ''
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
    $('upProg').hidden = !v
    $('create').disabled = $('gUpload').disabled = $('gLink').disabled = v
    $('files').disabled = v
    $('modeLink').disabled = $('modeFile').disabled = $('modeDrive').disabled = v
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
        } catch (e) { // bruh
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

export const startUpload = async () => {
    if (busy) return
    const key = ctx.key(), slug = $('slug').value.trim()
    const total = picked.reduce((a, f) => a + f.size, 0)

    if (!key) return ctx.toast('กรุณาใส่รหัสลับ', false)
    if (!picked.length) return ctx.toast('กรุณาเลือกไฟล์ก่อน', false)
    if (slug && !ctx.validSlug(slug)) return ctx.toast('ชื่อลิงก์ย่อไม่ถูกต้อง', false)
    if (lim && total > lim.perUpload) return ctx.toast(errText('too big'), false)

    ctl = { stop: false, cancelled: false, xhrs: new Set() }
    lock(true)
    $('upText').textContent = 'กำลังเตรียมอัปโหลด...'
    bar($('upBar'), 0)

    let tokens = [], fallback = false
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
            const sp = sent / Math.max(1, (Date.now() - t0) / 1000)
            const eta = sp > 0 ? Math.round((total - sent) / sp) : 0
            bar($('upBar'), sent / total * 100)
            $('upText').textContent = `${fmtSize(sent)} / ${fmtSize(total)} · ${fmtSize(sp)}/s · เหลือ ~${Math.floor(eta / 60)}:${String(eta % 60).padStart(2, '0')}`
        }

        const files = []
        for (const [i, f] of picked.entries()) {
            const parts = await uploadFile(f, tokens[i], init.chunk, onBytes)
            files.push({ token: tokens[i], type: f.type, parts })
        }

        $('upText').textContent = 'กำลังรวมไฟล์...'
        const fin = await post('/file/done', { key, slug: init.slug, files })
        if (!fin.ok) throw new Error(fin.msg)

        ctx.toast(`อัปโหลดสำเร็จ → go.thatako.net/${fin.slug}`)
        picked = []
        renderPicked()
        $('slug').value = ''
        await ctx.reload()
    } catch (e) {
        if (tokens.length) post('/file/abort', { tokens }).catch(() => { })
        fallback = !ctl.cancelled && FALLBACK.includes(e.message)
        if (!fallback) ctx.toast(ctl.cancelled ? 'ยกเลิกการอัปโหลดแล้ว' : errText(e.message), false)
    }
    lock(false)
    if (fallback) setMode('drive', true)
    else loadUsage()
}

// drive
const sleep = ms => new Promise(r => setTimeout(r, ms))
const loadScript = src => new Promise((res, rej) => {
    if (window.google?.accounts) return res()
    const s = document.createElement('script')
    s.src = src; s.onload = res; s.onerror = rej
    document.head.appendChild(s)
})

const loadDrive = async () => {
    if (gcfg) return
    try {
        gcfg = await (await fetch(ctx.api + '/drive/cfg')).json()
        if (!gcfg.ok) throw 0
        $('saMail').textContent = gcfg.sa
        if (gcfg.clientId) loadScript(GSI).catch(() => { })
    } catch { gcfg = null; $('saMail').textContent = 'ยังไม่พร้อมใช้งาน' }
}

// short-lived token
const getToken = async () => {
    await loadScript(GSI)
    return new Promise((res, rej) => google.accounts.oauth2.initTokenClient({
        client_id: gcfg.clientId,
        scope: 'https://www.googleapis.com/auth/drive.file openid email',
        callback: r => r.access_token ? res(r.access_token) : rej(new Error('login')),
        error_callback: () => rej(new Error('login')),
    }).requestAccessToken())
}

const gj = async (url, tok, body) => {
    const r = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (!r.ok) throw new Error('gdrive ' + r.status)
    return r.json()
}

const putG = async (url, blob, range, onBytes) => {
    for (let a = 0; ; a++) {
        let last = 0
        try {
            return await new Promise((res, rej) => {
                const x = new XMLHttpRequest()
                ctl.xhrs.add(x)
                x.open('PUT', url)
                x.setRequestHeader('content-range', range)
                x.upload.onprogress = e => { onBytes(e.loaded - last); last = e.loaded }
                x.onload = () => { ctl.xhrs.delete(x);[200, 201, 308].includes(x.status) ? res() : rej(new Error('gdrive ' + x.status)) }
                x.onerror = x.onabort = () => { ctl.xhrs.delete(x); rej(new Error('network')) }
                x.send(blob)
            })
        } catch (e) {
            onBytes(-last)
            if (ctl.stop || a >= RETRIES) throw e
            await sleep(1000 * 2 ** a)
        }
    }
}

const driveUpload = async (f, parent, tok, onBytes) => {
    const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': f.type || 'application/octet-stream', 'x-upload-content-length': String(f.size) },
        body: JSON.stringify({ name: f.name, parents: [parent] }),
    })
    const url = r.headers.get('location')
    if (!r.ok || !url) throw new Error('gdrive init')
    for (let a = 0; a < f.size; a += G_CHUNK) {
        const end = Math.min(a + G_CHUNK, f.size)
        await putG(url, f.slice(a, end), `bytes ${a}-${end - 1}/${f.size}`, onBytes)
    }
}

const checkForm = needFiles => {
    const key = ctx.key(), slug = $('slug').value.trim()
    if (!key) return ctx.toast('กรุณาใส่รหัสลับ', false)
    if (needFiles && !picked.length) return ctx.toast('กรุณาเลือกไฟล์ก่อน', false)
    if (slug && !ctx.validSlug(slug)) return ctx.toast('ชื่อลิงก์ย่อไม่ถูกต้อง', false)
    return { key, slug }
}

const startDriveUpload = async () => {
    const f = !busy && checkForm(true)
    if (!f) return
    if (!gcfg?.clientId) return ctx.toast('ระบบ Google Drive ยังไม่พร้อมใช้งาน', false)

    ctl = { stop: false, cancelled: false, xhrs: new Set() }
    lock(true)
    bar($('upBar'), 0)
    $('upText').textContent = 'กำลังเข้าสู่ระบบ Google...'
    let tok, sub, slug
    try {
        tok = await getToken()
        $('upText').textContent = 'กำลังเตรียมโฟลเดอร์ go.thatako.net...'
        const q = encodeURIComponent(`name='go.thatako.net' and mimeType='${FOLDER}' and trashed=false`)
        const found = await (await fetch(`${GAPI}/files?q=${q}&fields=files(id)`, { headers: { authorization: 'Bearer ' + tok } })).json()
        const root = found.files?.[0]?.id || (await gj(`${GAPI}/files?fields=id`, tok, { name: 'go.thatako.net', mimeType: FOLDER })).id
        await gj(`${GAPI}/files/${root}/permissions?sendNotificationEmail=false`, tok, { type: 'user', role: 'reader', emailAddress: gcfg.sa })
        sub = (await gj(`${GAPI}/files?fields=id`, tok, {
            name: f.slug || new Date().toISOString().slice(0, 16).replace('T', ' '), mimeType: FOLDER, parents: [root],
        })).id

        let reg
        for (let a = 0; a < 3; a++) {
            reg = await post('/drive/register', { key: f.key, slug: f.slug, target: sub, token: tok })
            if (reg.msg !== 'drive no access') break
            await sleep(1500)
        }
        if (!reg.ok) throw new Error(reg.msg)
        slug = reg.slug

        const total = picked.reduce((a, x) => a + x.size, 0)
        let sent = 0
        const t0 = Date.now()
        const onBytes = d => {
            sent += d
            const sp = sent / Math.max(1, (Date.now() - t0) / 1000)
            const eta = sp > 0 ? Math.round((total - sent) / sp) : 0
            bar($('upBar'), sent / total * 100)
            $('upText').textContent = `${fmtSize(sent)} / ${fmtSize(total)} · ${fmtSize(sp)}/s · เหลือ ~${Math.floor(eta / 60)}:${String(eta % 60).padStart(2, '0')}`
        }
        for (const file of picked) await driveUpload(file, sub, tok, onBytes)

        ctx.toast(`อัปโหลดไป Google Drive สำเร็จ → go.thatako.net/${slug}`)
        picked = []
        renderPicked()
        $('slug').value = ''
        await ctx.reload()
    } catch (e) {
        if (slug) post('/revoke', { slug, key: f.key }).catch(() => { })
        if (sub) fetch(`${GAPI}/files/${sub}`, { method: 'DELETE', headers: { authorization: 'Bearer ' + tok } }).catch(() => { })
        ctx.toast(ctl.cancelled ? 'ยกเลิกการอัปโหลดแล้ว' : errText(e.message), false)
    }
    lock(false)
}

const startDriveLink = async () => {
    const f = !busy && checkForm(false)
    if (!f) return
    const target = $('driveLink').value.trim()
    if (!target) return ctx.toast('กรุณาวางลิงก์ Google Drive', false)
    lock(true)
    $('upProg').hidden = true
    try {
        const r = await post('/drive/register', { key: f.key, slug: f.slug, target })
        if (!r.ok) throw new Error(r.msg)
        ctx.toast(`สร้างลิงก์สำเร็จ → go.thatako.net/${r.slug}`)
        $('driveLink').value = ''
        $('slug').value = ''
        await ctx.reload()
    } catch (e) { ctx.toast(errText(e.message), false) }
    lock(false)
}

export const initUpload = c => {
    ctx = c
    $('modeLink').onclick = () => setMode('link')
    $('modeFile').onclick = () => setMode('file')
    $('modeDrive').onclick = () => setMode('drive')
    $('gUpload').onclick = startDriveUpload
    $('gLink').onclick = startDriveLink
    $('saCopy').onclick = () => gcfg && navigator.clipboard.writeText(gcfg.sa).then(() => ctx.toast('คัดลอกอีเมลแล้ว'))
    $('days').onchange = () => { if (+$('days').value === 0 && !lim?.canPermanent) { $('days').value = '30'; setMode('drive', true) } }
    $('key').addEventListener('change', () => { if (mode === 'file') loadUsage() })
    $('files').onchange = e => { addFiles(e.target.files); e.target.value = '' }
    $('upCancel').onclick = () => { ctl.cancelled = ctl.stop = true; ctl.xhrs.forEach(x => x.abort()) }

    const drop = $('drop')
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over') }
    drop.ondragleave = () => drop.classList.remove('over')
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); if (!busy) addFiles(e.dataTransfer.files) }

    window.addEventListener('beforeunload', e => { if (busy) e.preventDefault() })
}
