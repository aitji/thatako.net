import "../short/boostrap.js"
import { initUpload, isFileMode, startUpload, fmtSize } from "./upload.js"
import { initQR, openQR } from "./qrui.js"
import { initFiles, openFiles } from "./files.js"
const API_URL = "https://go.thatako.net/api"
const STORAGE_KEY = "short-key"
const MAX_SLUG_LENGTH = 1024
const TOAST_DELAY = 8000

let editing = null
let busy = false
let links = []
const view = { q: "", type: "all" }

const $ = id => document.getElementById(id)

/** @param {any} t */
const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
const isFile = l => l.type === "file" || l.type === "drive"

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

/** @param {any} l */
const fileInfo = l => {
    const drive = l.type === "drive"
    const icon = drive ? "fa-brands fa-google-drive" : "fa-solid fa-file"
    let out = `<span class="file-sum"><i class="${icon}" aria-hidden="true"></i> ${l.count} ไฟล์ · ${fmtSize(l.total)}</span>`

    if (l.names?.length) {
        const more = l.count > 2 ? ` +${l.count - 2}` : ""
        out += `<small class="file-names muted" title="${esc(l.names.join(", "))}">${esc(l.names.slice(0, 2).join(", "))}${more}</small>`
    }

    if (drive) return out + `<small class="file-exp muted">Google Drive · ไม่หมดอายุ</small>`
    if (!(l.exp > 0)) return out + `<small class="file-exp muted">ไม่ทราบวันหมดอายุ</small>`
    const dead = l.exp < Date.now()
    const day = new Date(l.exp).toLocaleDateString("th-TH", { dateStyle: "medium" })
    return out + `<small class="file-exp ${dead ? "file-dead" : "muted"}">${dead ? "หมดอายุแล้ว" : "หมดอายุ"} ${day}</small>`
}

/** @param {any} l */
const rowHtml = l => {
    const slug = esc(l.slug)
    const file = isFile(l)
    return `
        <tr>
            <td class="link-slug">
                <a href="https://go.thatako.net/${slug}" target="_blank" title="คัดลอกลิงก์">${slug}</a>
            </td>
            <td class="link-to" title="${file ? "" : esc(l.to)}">${file ? fileInfo(l) : esc(l.to)}</td>
            <td>
                <div class="link-actions">
                    ${file ? `<button class="btn btn-ghost" data-files="${slug}" data-type="${l.type}" title="จัดการไฟล์ (เพิ่ม ลบ เปลี่ยนชื่อ)">
                        <i class="fa-solid fa-folder-open" aria-hidden="true"></i> ไฟล์
                    </button>` : ""}
                    <button class="btn btn-ghost" data-edit="${slug}" data-to="${esc(l.to)}" data-type="${file ? l.type : "url"}" title="แก้ไขลิงก์">
                        <i class="fa-solid fa-pen" aria-hidden="true"></i> แก้ไข
                    </button>
                    <button class="btn btn-ghost" data-qr="${slug}" title="สร้าง QR CODE">
                        <i class="fa-solid fa-qrcode" aria-hidden="true"></i>
                    </button>
                    <button class="btn btn-danger" data-revoke="${slug}" title="ลบลิงก์">
                        <i class="fa-solid fa-trash" aria-hidden="true"></i>
                    </button>
                </div>
            </td>
        </tr>`
}

const emptyRow = (icon, text, extra = "") => `
    <tr>
        <td colspan="3">
            <div class="empty-state">
                <div style="display:flex;justify-content:center">
                    <i class="fa-solid ${icon}" aria-hidden="true" style="font-size:24px;opacity:0.3"></i>
                </div>
                ${text}${extra}
            </div>
        </td>
    </tr>`

const matches = (l, words) => {
    if (!words.length) return true
    const hay = `${l.slug} ${isFile(l) ? "" : l.to} ${(l.names || []).join(" ")}`.toLowerCase()
    return words.every(w => hay.includes(w))
}

const applyView = () => {
    const words = view.q.toLowerCase().split(/\s+/).filter(Boolean)
    const hit = links.filter(l => matches(l, words))
    const count = { all: hit.length, url: hit.filter(l => !isFile(l)).length, file: hit.filter(isFile).length }
    const shown = view.type === "all" ? hit : hit.filter(l => (view.type === "file") === isFile(l))

    document.querySelectorAll("[data-count]").forEach(el => el.textContent = count[el.dataset.count])
    document.querySelectorAll("#filters .chip").forEach(b => {
        const on = b.dataset.filter === view.type
        b.classList.toggle("active", on)
        b.setAttribute("aria-pressed", on)
    })
    $("searchClear").hidden = !view.q

    const filtering = !!words.length || view.type !== "all"
    $("resultCount").hidden = !filtering || !links.length
    $("resultCount").textContent = `แสดง ${shown.length} จาก ${links.length} ลิงก์`

    if (!links.length) $("list").innerHTML = emptyRow("fa-link-slash", "ยังไม่มีลิงก์ - สร้างลิงก์แรกได้เลย")
    else if (!shown.length) $("list").innerHTML = emptyRow("fa-magnifying-glass", "ไม่พบลิงก์ที่ตรงกัน", ` <button type="button" class="btn btn-ghost" data-reset-filter style="margin-left:6px;height:26px">ล้างตัวกรอง</button>`)
    else $("list").innerHTML = shown.map(rowHtml).join("")
}

/** @param {any[]} data */
const renderList = data => {
    links = Array.isArray(data) ? data : []
    applyView()
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
        if ($("loading")) $("loading").style.display = "none"
        if ($("loading-text")) $("loading-text").innerHTML = 'ไม่สามารถโหลดข้อมูลได้ <span class="importance">กรุณาลองใหม่</span>'
        toast("ไม่สามารถโหลดข้อมูลได้", false)
    }
    setBusy(false)
}

const createLink = async () => {
    if (isFileMode()) return startUpload()
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
    $("newToField").hidden = dataset.type === "file" || dataset.type === "drive"
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

    $("list").onclick = async e => {
        e.preventDefault()
        const b = e.target.closest("button")
        const a = e.target.closest("a")

        if (b?.hasAttribute("data-reset-filter")) {
            view.q = ""
            view.type = "all"
            $("search").value = ""
            return applyView()
        }
        if (busy) return

        if (a) await copyLink(a.href)
        else if (b) {
            if (b.dataset.qr) openQR(`https://go.thatako.net/${b.dataset.qr}`)
            if (b.dataset.files) openFiles(b.dataset.files, b.dataset.type)
            if (b.dataset.edit) openEdit(b.dataset)
            if (b.dataset.revoke) await revoke(b.dataset.revoke)
        }
    }

    let timer = 0
    $("search").oninput = e => {
        clearTimeout(timer)
        timer = setTimeout(() => { view.q = e.target.value.trim(); applyView() }, 120)
    }
    $("search").onkeydown = e => {
        if (e.key !== "Escape" || !e.target.value) return
        e.target.value = ""
        view.q = ""
        applyView()
    }
    $("searchClear").onclick = () => {
        $("search").value = ""
        view.q = ""
        applyView()
        $("search").focus()
    }
    $("filters").onclick = e => {
        const b = e.target.closest("button[data-filter]")
        if (!b) return
        view.type = b.dataset.filter
        applyView()
    }
    document.addEventListener("keydown", e => {
        if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.querySelector(".modal-overlay.open")) return
        e.preventDefault()
        $("search").focus()
    })

    $("slug").onkeydown = e => {
        if (e.key === "Enter") createLink()
    }

    $("to").onkeydown = e => {
        if (e.key === "Enter") createLink()
    }
}

const init = () => {
    new bootstrap.Tooltip(document.body, { selector: '[data-bs-toggle="tooltip"]' })
    initEvents()
    initKey()
    initQR({ toast })
    initUpload({ api: API_URL, key: () => $("key").value.trim(), validSlug, toast, reload: loadLinks })
    initFiles({ api: API_URL, key: () => $("key").value.trim(), toast, reload: loadLinks })
    loadLinks()
}

document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init()
