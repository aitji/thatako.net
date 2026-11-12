import { planQr, marginPx, colorIssue } from './qr.js'

const LIB = 'https://unpkg.com/qr-code-styling@1.6.0/lib/qr-code-styling.js'
const LOGO = '/img/icon/logo.svg'
const STORE = 'short-qr'
const PREVIEW = 48
const MAX_BYTES = 2953

const DEFAULTS = { ecc: 'auto', dots: 'square', corner: 'square', fg: '#000000', bg: '#ffffff', quiet: 4, size: 1024, fmt: 'png', logo: false }
const CORNERS = { square: ['square', 'square'], rounded: ['extra-rounded', 'dot'], circle: ['dot', 'dot'] }
const ALLOWED = {
    ecc: ['auto', 'L', 'M', 'Q', 'H'],
    dots: ['square', 'rounded', 'extra-rounded', 'dots', 'classy', 'classy-rounded'],
    corner: Object.keys(CORNERS),
    quiet: [2, 4, 6],
    size: [512, 1024, 2048],
    fmt: ['png', 'svg', 'jpeg']
}

const $ = id => document.getElementById(id)

let st = { ...DEFAULTS }
let qr = null // preview
let libP = null
let timer = 0
let notify = () => { }

/** @param {any} o */
const sanitize = o => {
    const s = { ...DEFAULTS }
    for (const k in ALLOWED) if (ALLOWED[k].includes(o?.[k])) s[k] = o[k]
    for (const k of ['fg', 'bg']) if (/^#[0-9a-f]{6}$/i.test(o?.[k])) s[k] = o[k].toLowerCase()
    s.logo = o?.logo === true
    return s
}

const loadSettings = () => {
    try { return sanitize(JSON.parse(localStorage.getItem(STORE) || '{}')) }
    catch { return { ...DEFAULTS } }
}
const saveSettings = () => { try { localStorage.setItem(STORE, JSON.stringify(st)) } catch { } }

const loadLib = () => libP ??= new Promise((res, rej) => {
    if (window.QRCodeStyling) return res(window.QRCodeStyling)
    const s = document.createElement('script')
    s.src = LIB
    s.async = true
    s.onload = () => window.QRCodeStyling ? res(window.QRCodeStyling) : rej(new Error('qr lib'))
    s.onerror = () => { libP = null; rej(new Error('qr lib')) }
    document.head.appendChild(s)
})

let logoP = null
const logoOk = () => logoP ??= new Promise(res => {
    const i = new Image()
    i.onload = () => res(true)
    i.onerror = () => { logoP = null; res(false) }
    i.src = LOGO
})

const plan = () => planQr($('qrcodeText').value.trim(), { ecc: st.ecc, logo: st.logo })

/** library options for a given plan and pixel size */
const options = (p, size, logo = st.logo) => ({
    type: 'canvas',
    width: size,
    height: size,
    data: p.data,
    margin: marginPx(size, p.modules, st.quiet),
    qrOptions: { typeNumber: 0, mode: p.mode, errorCorrectionLevel: p.ecc },
    dotsOptions: { type: st.dots, color: st.fg },
    cornersSquareOptions: { type: CORNERS[st.corner][0], color: st.fg },
    cornersDotOptions: { type: CORNERS[st.corner][1], color: st.fg },
    backgroundOptions: { color: st.bg },
    image: logo ? LOGO : undefined,
    imageOptions: { crossOrigin: 'anonymous', hideBackgroundDots: true, margin: Math.max(1, Math.round(size / 120)) }
})

const chip = (text, title) => {
    const s = document.createElement('span')
    s.className = 'qr-chip'
    s.textContent = text
    if (title) s.title = title
    return s
}

const eccText = p => ({
    auto: 'เลือกให้อัตโนมัติ',
    logo: 'มีโลโก้ จึงใช้ระดับสูงสุด',
    manual: 'เลือกเอง',
    fallback: 'ข้อมูลยาวเกินระดับที่เลือก จึงลดให้อัตโนมัติ'
}[p.why])

const renderInfo = p => {
    const info = $('qrInfo'), warn = $('qrWarn')
    info.replaceChildren()
    warn.replaceChildren()

    const issues = []
    const ci = colorIssue(st.fg, st.bg)
    if (ci === 'inverted') issues.push('สีจุดอ่อนกว่าพื้นหลัง เครื่องสแกนหลายรุ่นอ่านไม่ได้ ควรใช้จุดเข้มบนพื้นอ่อน')
    if (ci === 'low') issues.push('สีจุดกับพื้นหลังตัดกันน้อย อาจสแกนยาก')
    if (st.quiet < 4) issues.push('ขอบขาวน้อยกว่ามาตรฐาน (4 ช่อง) อาจสแกนยากเมื่อพิมพ์ติดกับสิ่งอื่น')
    if (p && !p.tooLong && st.logo && p.recover < 25) issues.push('โลโก้บังจุดบางส่วน แนะนำใช้ ECC ระดับ Q หรือ H')

    if (!p) info.append(chip('ใส่ URL หรือข้อความเพื่อสร้าง QR'))
    else if (p.tooLong) issues.unshift(`ข้อมูลยาวเกินไป QR เก็บได้สูงสุด ${MAX_BYTES.toLocaleString('th-TH')} ไบต์`)
    else {
        info.append(
            chip(`เวอร์ชัน ${p.version} · ${p.modules}×${p.modules}`, 'จำนวนช่อง ยิ่งน้อยยิ่งสแกนง่าย'),
            chip(`โหมด ${p.mode}`, 'เลือกรูปแบบการเข้ารหัสที่ประหยัดที่สุดให้อัตโนมัติ'),
            chip(`ECC ${p.ecc} · กู้ได้ ~${p.recover}%`, eccText(p)),
            chip('Mask อัตโนมัติ', 'เลือก mask pattern ที่ดีที่สุดจาก 8 แบบ')
        )
    }
    $('eccHint').textContent = p && !p.tooLong
        ? `ข้อมูล ${p.len} ${p.mode === 'Byte' ? 'ไบต์' : 'ตัวอักษร'} · ECC ${p.ecc} (${eccText(p)})`
        : ''

    for (const t of issues) {
        const d = document.createElement('div')
        d.className = 'qr-warn'
        d.textContent = t
        warn.appendChild(d)
    }
}

const render = async () => {
    const p = plan()
    renderInfo(p)

    const box = $('qrPreview')
    if (!p || p.tooLong) { qr = null; box.replaceChildren(); box.classList.add('empty'); return }
    box.classList.remove('empty')

    try {
        const Lib = await loadLib()
        const logo = st.logo && await logoOk()
        if (st.logo && !logo) notify('โหลดโลโก้ไม่สำเร็จ จึงสร้าง QR แบบไม่มีโลโก้', false)
        if (plan()?.data !== p.data) return
        if (qr) qr.update(options(p, PREVIEW, logo))
        else {
            qr = new Lib(options(p, PREVIEW, logo))
            box.replaceChildren()
            qr.append(box)
        }
    } catch {
        notify('โหลดตัวสร้าง QR ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่', false)
    }
}

const schedule = () => { clearTimeout(timer); timer = setTimeout(render, 120) }
const syncControls = () => {
    $('eccTabs').querySelectorAll('button').forEach(b => {
        const on = b.dataset.ecc === st.ecc
        b.classList.toggle('active', on)
        b.setAttribute('aria-pressed', on)
    })
    $('qrDots').value = st.dots
    $('qrCorner').value = st.corner
    $('qrFg').value = st.fg
    $('qrBg').value = st.bg
    $('qrQuiet').value = st.quiet
    $('qrSize').value = st.size
    $('qrFmt').value = st.fmt
    $('qrLogo').checked = st.logo
}

const change = patch => {
    st = { ...st, ...patch }
    saveSettings()
    syncControls()
    schedule()
}

const fileName = () => 'qr-' + ($('qrcodeText').value.trim()
    .replace(/^https?:\/\//, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'code')

/** build a fresh full-size instance for export (the preview is only 480px) */
const exporter = async () => {
    const p = plan()
    if (!p || p.tooLong) throw new Error('empty')
    const Lib = await loadLib()
    return new Lib(options(p, st.size, st.logo && await logoOk()))
}

const downloadQR = async () => {
    try {
        const q = await exporter()
        await q.download({ name: fileName(), extension: st.fmt })
    } catch { notify('สร้างไฟล์ QR ไม่สำเร็จ', false) }
}

const copyQR = async () => {
    try {
        const q = await exporter()
        const blob = await q.getRawData('png')
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        notify('คัดลอกแล้ว')
    } catch { notify('ไม่สามารถคัดลอกได้', false) }
}

export const openQR = url => {
    $('qrcodeText').value = url
    syncControls()
    window.ModalManager.open('qrModal')
    render()
}

/** @param {{ toast: (msg: string, ok?: boolean) => void }} ctx */
export const initQR = ctx => {
    notify = ctx.toast
    st = loadSettings()
    syncControls()

    $('qrcodeText').oninput = schedule
    $('eccTabs').onclick = e => {
        const b = e.target.closest('button[data-ecc]')
        if (b) change({ ecc: b.dataset.ecc })
    }
    $('qrDots').onchange = e => change({ dots: e.target.value })
    $('qrCorner').onchange = e => change({ corner: e.target.value })
    $('qrFg').oninput = e => change({ fg: e.target.value })
    $('qrBg').oninput = e => change({ bg: e.target.value })
    $('qrQuiet').onchange = e => change({ quiet: +e.target.value })
    $('qrSize').onchange = e => change({ size: +e.target.value })
    $('qrFmt').onchange = e => change({ fmt: e.target.value })
    $('qrLogo').onchange = e => change({ logo: e.target.checked })
    $('qrReset').onclick = e => { e.preventDefault(); change({ ...DEFAULTS }) }
    $('downloadQR').onclick = e => { e.preventDefault(); downloadQR() }
    $('copyQR').onclick = e => { e.preventDefault(); copyQR() }
}
