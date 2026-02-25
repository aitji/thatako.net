import "../short/boostrap.js"
const API_URL = "https://go.thatako.net/api"
const STORAGE_KEY = "short-key"
const MAX_SLUG_LENGTH = 1024
const TOAST_DELAY = 8000

let editing = null
let busy = false
let qr = null
let qrUrl = ''

const $ = id => document.getElementById(id)

/** @param {string} slug */
const validSlug = slug =>
    slug &&
    slug.length <= MAX_SLUG_LENGTH &&
    !slug.startsWith("/") &&
    !slug.startsWith("api/")

/** @param {string} url */
const validUrl = url => {
    try {
        const u = new URL(url)
        return u.protocol === "http:" || u.protocol === "https:"
    } catch { return false }
}

const randomKey = (extraBytes = 16) =>
    crypto.randomUUID().replace(/-/g, "") +
    [...crypto.getRandomValues(new Uint8Array(extraBytes))]
        .map(b => b.toString(16).padStart(2, "0"))
        .join("")

/** @param {string} t */
const truncate = (t, m = 60) => (t.length > m ? t.slice(0, m) + "..." : t)

/** @param {string} msg */
const toast = (msg, ok = true) => {
    const el = document.createElement("div")
    el.className = `toast align-items-center text-bg-${ok ? "success" : "danger"} border-0`
    el.innerHTML = `
        <i class="fa-solid ${!ok ? 'fa-triangle-exclamation' : 'fa-check'}"
            aria-hidden="true"
            style="color:${!ok ? 'var(--color-text-danger)' : 'var(--color-badge-green-text)'}"></i>
        <span>${msg || 'ไม่มีข้อความ'}</span>
        <button class="toast-close" aria-label="ปิด" title="ปิด">
            <i class="fa-solid fa-xmark"></i>
        </button>`
    el.querySelector(".toast-close").onclick = () => el.dispatchEvent(new Event('hidden.bs.toast'))

    $("toasts").appendChild(el)
    new bootstrap.Toast(el, { delay: TOAST_DELAY }).show()
    el.addEventListener("hidden.bs.toast", () => el.remove())
}

const setBusy = v => {
    busy = v
    $("create").disabled = v
    $("refresh").disabled = v
    $("saveEdit").disabled = v
}

/** @param {any[]} links */
const renderList = links => {
    $("list").innerHTML = !links.length
        ? `<tr><td colspan="3" class="text-center text-muted py-4">ยังไม่มีลิงก์</td></tr>`
        : links
            .map(l => `
            <tr>
                <td>
                    <a href="https://go.thatako.net/${l.slug}" target="_blank" title="คัดลอกลิงก์">${l.slug}</a>
                </td>
                <td>${truncate(l.to)}</td>
                <td class="text-end">
                    <button class="btn btn-sm btn-primary mt-2" data-edit="${l.slug}" data-to="${l.to}" title="แก้ไขลิงก์">แก้ไข</button>
                    <button class="btn btn-sm btn-outline-secondary mt-2" data-qr="${l.slug}" title="สร้าง QR CODE">สร้าง QR</button>
                    <button class="btn btn-sm btn-outline-danger mt-2" data-revoke="${l.slug}" title="ลบลิงก์">ลบ</button>
                </td>
            </tr>`)
            .join("")
}

const api = async (path, body) => {
    const res = await fetch(`${API_URL}${path}`, {
        method: body ? "POST" : "GET",
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined
    })
    return res.json()
}

const loadLinks = async () => {
    const key = $("key").value.trim()
    if (!key) return

    setBusy(true)
    try {
        const links = await api(`/list?key=${encodeURIComponent(key)}`)
        renderList(links)
    } catch {
        $("loading").style.display = "none"
        $("loading-text").innerHTML = 'ไม่สามารถโหลดข้อมูลได้ <span class="importance">กรุณาลองใหม่</span>'
        toast("ไม่สามารถโหลดข้อมูลได้", false)
    }
    setBusy(false)
}

const createLink = async () => {
    const slug = $("slug").value.trim()
    const to = $("to").value.trim()
    const key = $("key").value.trim()

    if (!key) return toast("กรุณาใส่รหัสลับ", false)
    if (!validSlug(slug)) return toast("ชื่อลิงก์ย่อไม่ถูกต้อง", false)
    if (!validUrl(to)) return toast("URL ไม่ถูกต้อง", false)

    setBusy(true)
    try {
        const r = await api("/create", { slug, to, key })
        if (!r.ok) return toast(errText(r.msg), false)

        toast("สร้างลิงก์สำเร็จ")
        $("slug").value = ""
        $("to").value = ""
        await loadLinks()
    } catch { toast("การสร้างลิงก์ล้มเหลว", false) }
    setBusy(false)
}

/** @param {string} slug */
const copyLink = async slug => {
    try {
        await navigator.clipboard.writeText(slug)
        toast("คัดลอกลิงก์แล้ว")
    } catch { toast("ไม่สามารถคัดลอกได้", false) }
}

/** @param {string} slug */
const openEdit = dataset => {
    editing = dataset
    $("newSlug").placeholder = dataset.edit
    $("newTo").placeholder = dataset.to
    $("newSlug").value = ''
    $("newTo").value = ''
    new bootstrap.Modal($("editModal")).show()
}

/** @param {string} m */
const errText = m => {
    if (!m) return "เกิดข้อผิดพลาด"
    setBusy(false)
    switch (m) {
        case "duplicate": return "ชื่อนี้ถูกใช้แล้ว ท่านสามารถเพิ่ม '/' ได้เช่น go.thatako.net/tree/apple"
        case "bad slug": return "ชื่อลิงก์ย่อไม่ถูกต้อง"
        case "bad url": return "URL ไม่ถูกต้อง"
        case "missing slug, to, key": return "ข้อมูลไม่ครบ"
        default: return "เกิดข้อผิดพลาดที่ไม่สามารถหาข้อสรุปได้ กรุณาลองใหม่"
    }
}

const saveEdit = async () => {
    if (!editing) return

    const newSlug = $("newSlug").value.trim()
    const newTo = $("newTo").value.trim()
    const key = $("key").value.trim()

    if (newSlug && !validSlug(newSlug)) return toast("ชื่อลิงก์ย่อใหม่ไม่ถูกต้อง", false)
    if (newTo && !validUrl(newTo)) return toast("URL ใหม่ไม่ถูกต้อง", false)

    setBusy(true)
    try {
        const r = await api("/edit", {
            slug: editing.edit,
            newSlug: newSlug || undefined,
            to: newTo || undefined,
            key
        })

        if (!r.ok) return toast(errText(r.msg), false)

        toast("บันทึกสำเร็จแล้ว")
        bootstrap.Modal.getInstance($("editModal")).hide()
        await loadLinks()
    } catch (e) {
        toast(`การบันทึกล้มเหลว`, false)
    }
    setBusy(false)
}

/** @param {string} slug */
const revoke = async slug => {
    if (!confirm(`ต้องการลบลิงก์ "${slug}" หรือไม่?`)) return

    setBusy(true)
    try {
        const r = await api("/revoke", { slug, key: $("key").value.trim() })
        if (!r.ok) return toast(errText(r.msg), false)

        toast("ลบสำเร็จ")
        await loadLinks()
    } catch { toast("การลบล้มเหลว", false) }
    setBusy(false)
}

const saveKey = k => localStorage.setItem(STORAGE_KEY, k)
const loadKeyStore = () => localStorage.getItem(STORAGE_KEY)

const initKey = () => {
    let k = loadKeyStore()
    if (!k) {
        k = randomKey()
        saveKey(k)
    }
    $("key").value = k
}

const initEvents = () => {
    $("downloadQR").onclick = e => {
        e.preventDefault()
        downloadQR()
    }
    $("copyQR").onclick = async e => {
        e.preventDefault()
        await copyQR()
    }

    $("create").onclick = e => {
        e.preventDefault()
        createLink()
    }

    $("refresh").onclick = e => {
        e.preventDefault()
        loadLinks()
    }

    $("saveEdit").onclick = e => {
        e.preventDefault()
        saveEdit()
    }

    $("random").onclick = e => {
        e.preventDefault()
        const k = randomKey()
        saveKey(k)
        $("key").value = k
    }

    $("key").onchange = () => {
        const k = $("key").value.trim()
        if (k) {
            saveKey(k)
            loadLinks()
        }
    }

    $("qrcodeText").onchange = () => updateQR($("qrcodeText").value)
    $("list").onclick = async e => {
        e.preventDefault()
        const b = e.target.closest("button")
        const a = e.target.closest("a")
        if (busy) return

        if (a) {
            console.log(a)
            await copyLink(a.href)
        } else if (b) {
            if (b.dataset.qr) openQR(b.dataset.qr)
            if (b.dataset.edit) openEdit(b.dataset)
            if (b.dataset.revoke) await revoke(b.dataset.revoke)
        }
    }

    $("slug").onkeydown = e => {
        if (e.key === "Enter") createLink()
    }

    $("to").onkeydown = e => {
        if (e.key === "Enter") createLink()
    }
}

const updateQR = qrUrl => {
    qr = new QRCodeStyling({
        width: 240,
        height: 240,
        type: "canvas",
        data: qrUrl,
        margin: 12,
        dotsOptions: {
            type: "square",
            color: "#000000"
        },
        cornersSquareOptions: {
            type: "square",
            color: "#000000"
        },
        cornersDotOptions: {
            type: "square",
            color: "#000000"
        },
        backgroundOptions: {
            color: "#ffffff"
        }
    })

    $("qrPreview").innerHTML = ""
    qr.append($("qrPreview"))
}

// qr code
/** @param {string} slug */
const openQR = slug => {
    qrUrl = `https://go.thatako.net/${slug}`

    updateQR(qrUrl)
    $("qrcodeText").value = qrUrl

    new bootstrap.Modal($("qrModal")).show()
}

const downloadQR = () => {
    if (!qr) return
    qr.download({ name: "qr", extension: "png" })
}

const copyQR = async () => {
    if (!qr) return
    try {
        const blob = await qr.getRawData("png")
        await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob })
        ])
        toast("คัดลอกแล้ว")
    } catch {
        toast("ไม่สามารถคัดลอกได้", false)
    }
}

const init = () => {
    new bootstrap.Tooltip(document.body, { selector: '[data-bs-toggle="tooltip"]' })
    initEvents()
    initKey()
    loadLinks()
}

document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init()
