import { planQr, snapSize, colorIssue } from './qr.js'
import { $, esc, icon, dims, SEP, joinHtml } from './ui.js'

const LIB = 'https://unpkg.com/qr-code-styling@1.6.0/lib/qr-code-styling.js'
const STORE = 'short-qr'
const PREVIEW = 220
const MAX_BYTES = 2953

const DEFAULTS = { ecc: 'auto', dots: 'square', corner: 'square', fg: '#000000', bg: '#ffffff', eye: '', quiet: 4, size: 1024, fmt: 'png' }
const CORNERS = { square: ['square', 'square'], rounded: ['extra-rounded', 'dot'], circle: ['dot', 'dot'] }
const PRESETS = {
    classic: { dots: 'square', corner: 'square', fg: '#000000', bg: '#ffffff', eye: '' },
    soft: { dots: 'rounded', corner: 'rounded', fg: '#111827', bg: '#ffffff', eye: '' },
    dots: { dots: 'dots', corner: 'circle', fg: '#000000', bg: '#ffffff', eye: '' },
    school: { dots: 'extra-rounded', corner: 'rounded', fg: '#4f5d97', bg: '#ffffff', eye: '#2f3a6b' }
}
const LOOK = ['dots', 'corner', 'fg', 'bg', 'eye']
const ALLOWED = {
    ecc: ['auto', 'L', 'M', 'Q', 'H'],
    dots: ['square', 'rounded', 'extra-rounded', 'dots', 'classy', 'classy-rounded'],
    corner: Object.keys(CORNERS),
    quiet: [2, 4, 6],
    size: [256, 512, 1024, 2048],
    fmt: ['png', 'svg', 'jpeg']
}

let st = { ...DEFAULTS }
let qr = null // preview
let libP = null
let timer = 0
let notify = () => { }

/** @param {any} o */
const sanitize = o => {
    const s = { ...DEFAULTS }
    for (const k in ALLOWED) if (ALLOWED[k].includes(o?.[k])) s[k] = o[k]
    for (const k of ['fg', 'bg', 'eye']) if (/^#[0-9a-f]{6}$/i.test(o?.[k])) s[k] = o[k].toLowerCase()
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

const plan = () => planQr($('qrcodeText').value.trim(), { ecc: st.ecc })
const eyeColor = () => st.eye || st.fg
const options = (p, size, preview = false) => {
    const snap = preview ? null : snapSize(size, p.modules, st.quiet)
    const px = snap ? snap.size : size
    const margin = snap ? snap.margin : Math.round(size * st.quiet / (p.modules + 2 * st.quiet))
    return {
        type: preview ? 'svg' : 'canvas',
        width: px,
        height: px,
        data: p.data,
        margin,
        qrOptions: { typeNumber: 0, mode: p.mode, errorCorrectionLevel: p.ecc },
        dotsOptions: { type: st.dots, color: st.fg },
        cornersSquareOptions: { type: CORNERS[st.corner][0], color: eyeColor() },
        cornersDotOptions: { type: CORNERS[st.corner][1], color: eyeColor() },
        backgroundOptions: { color: st.bg }
    }
}

/** @param {string} html already-safe markup */
const chip = (html, title) => {
    const s = document.createElement('span')
    s.className = 'qr-chip'
    s.innerHTML = html
    if (title) s.title = title
    return s
}

const eccText = p => ({
    auto: 'เลือกให้อัตโนมัติ',
    manual: 'เลือกเอง',
    fallback: 'ข้อมูลยาวเกินระดับที่เลือก จึงลดให้อัตโนมัติ'
}[p.why])

const statusRow = (kind, text) => {
    const d = document.createElement('div')
    d.className = `qr-status ${kind}`
    d.innerHTML = `${icon(kind === 'ok' ? 'circle-check' : kind === 'err' ? 'circle-xmark' : 'triangle-exclamation')}<span>${esc(text)}</span>`
    return d
}

const renderInfo = p => {
    const info = $('qrInfo'), warn = $('qrWarn')
    info.replaceChildren()
    warn.replaceChildren()

    const issues = []
    const ci = colorIssue(st.fg, st.bg)
    if (ci === 'inverted') issues.push('สีจุดอ่อนกว่าพื้นหลัง เครื่องสแกนหลายรุ่นอ่านไม่ได้ ควรใช้จุดเข้มบนพื้นอ่อน')
    if (ci === 'low') issues.push('สีจุดกับพื้นหลังตัดกันน้อย อาจสแกนยาก')
    if (st.quiet < 4) issues.push('ขอบขาวน้อยกว่ามาตรฐาน (4 ช่อง) อาจสแกนยากเมื่อพิมพ์ติดกับสิ่งอื่น')
    if (st.eye) {
        const ei = colorIssue(st.eye, st.bg)
        if (ei === 'inverted') issues.push('สีมุมสแกนอ่อนกว่าพื้นหลัง เครื่องสแกนอาจหาตำแหน่ง QR ไม่เจอ')
        else if (ei === 'low') issues.push('สีมุมสแกนกับพื้นหลังตัดกันน้อย อาจสแกนยาก')
    }

    let tooLong = false
    if (!p) info.append(chip('ใส่ URL หรือข้อความเพื่อสร้าง QR'))
    else if (p.tooLong) {
        tooLong = true
        issues.unshift(`ข้อมูลยาวเกินไป QR เก็บได้สูงสุด ${MAX_BYTES.toLocaleString('th-TH')} ไบต์`)
    } else {
        info.append(
            chip(`${icon('grid-2')} v${p.version}${SEP}${dims(p.modules)}`, 'เวอร์ชันและจำนวนช่อง ยิ่งน้อยยิ่งสแกนง่าย'),
            chip(`${icon('shield-check')} ECC ${p.ecc}${SEP}${p.recover}%`, `กู้คืนได้ ~${p.recover}% (${eccText(p)})`),
            chip(`${icon('code')} ${esc(p.mode)}`, 'เลือกรูปแบบการเข้ารหัสที่ประหยัดที่สุดให้อัตโนมัติ'),
        )
        if (p.optimized) info.append(chip(`${icon('bolt')} ย่อโหมดอัตโนมัติ`, 'ใช้ตัวพิมพ์ใหญ่ใน URL (เบราว์เซอร์ไม่สนตัวพิมพ์ใหญ่เล็กของโดเมน) เพื่อให้ QR เล็กลง'))
    }

    $('eccHint').innerHTML = p && !p.tooLong
        ? `ข้อมูล ${p.len} ${p.mode === 'Byte' ? 'ไบต์' : 'ตัวอักษร'}${SEP}ECC ${p.ecc} (${esc(eccText(p))})`
        : '&nbsp;'

    if (!issues.length) warn.append(statusRow('ok', 'พร้อมสแกน'))
    for (const t of issues) warn.append(statusRow(tooLong ? 'err' : 'warn', t))
}

const fitSvg = box => {
    const svg = box.querySelector('svg')
    if (!svg) return
    svg.setAttribute('viewBox', `0 0 ${PREVIEW} ${PREVIEW}`)
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
    svg.removeAttribute('width')
    svg.removeAttribute('height')
}

const render = async () => {
    const p = plan()
    renderInfo(p)

    const box = $('qrPreview')
    if (!p || p.tooLong) { qr = null; box.replaceChildren(); box.classList.add('empty'); return }
    box.classList.remove('empty')
    box.classList.toggle('crisp', st.dots === 'square' && st.corner === 'square')

    try {
        const Lib = await loadLib()
        if (plan()?.data !== p.data) return
        if (qr) qr.update(options(p, PREVIEW, true))
        else {
            qr = new Lib(options(p, PREVIEW, true))
            box.replaceChildren()
            qr.append(box)
        }
        fitSvg(box)
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
    $('qrEye').value = eyeColor()
    $('qrQuiet').value = st.quiet
    $('qrSize').value = st.size
    $('qrFmt').value = st.fmt
    $('qrPresets').querySelectorAll('button').forEach(b => {
        const on = LOOK.every(k => PRESETS[b.dataset.preset][k] === st[k])
        b.classList.toggle('active', on)
        b.setAttribute('aria-pressed', on)
    })
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

const exporter = async () => {
    const p = plan()
    if (!p || p.tooLong) throw new Error('empty')
    const Lib = await loadLib()
    return new Lib(options(p, st.size))
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
        notify('คัดลอก QR แล้ว')
    } catch { notify('ไม่สามารถคัดลอกได้', false) }
}

const canShareFiles = () => {
    try { return !!navigator.canShare?.({ files: [new File([''], 'qr.png', { type: 'image/png' })] }) }
    catch { return false }
}

const shareQR = async () => {
    try {
        const q = await exporter()
        const blob = await q.getRawData('png')
        const file = new File([blob], `${fileName()}.png`, { type: 'image/png' })
        await navigator.share({ files: [file], title: 'QR Code', text: $('qrcodeText').value.trim() })
    } catch (e) {
        if (e?.name !== 'AbortError') notify('ไม่สามารถแชร์ได้', false)
    }
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
    $('qrEye').oninput = e => change({ eye: e.target.value })
    $('qrPresets').onclick = e => {
        const b = e.target.closest('button[data-preset]')
        if (b) change(PRESETS[b.dataset.preset])
    }
    $('qrReset').onclick = e => { e.preventDefault(); change({ ...DEFAULTS }) }
    $('downloadQR').onclick = e => { e.preventDefault(); downloadQR() }
    $('copyQR').onclick = e => { e.preventDefault(); copyQR() }
    $('shareQR').hidden = !canShareFiles()
    $('shareQR').onclick = e => { e.preventDefault(); shareQR() }
}
