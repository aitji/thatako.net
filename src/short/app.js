import "../short/boostrap.js"
import { initUpload, isFileMode, startUpload } from "./upload.js"
import { initQR, openQR } from "./qrui.js"
import { initFiles, openFiles } from "./files.js"
import { $, esc, icon, meta, metaLine, fmtSize, skRows, skInline } from "./ui.js"
import { confirmDialog } from "./dialog.js"
import { createVirtualRows } from "./vlist.js"
const API_URL = "https://go.thatako.net/api"
const STORAGE_KEY = "short-key"
const MAX_SLUG_LENGTH = 1024
const TOAST_DELAY = 8000

let editing = null
let busy = false
let links = []
let loadedOnce = false
const view = { q: "", type: "all" }

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

/** @param {string} msg @param {boolean} [ok] */
const toast = (msg, ok = true) => {
    const el = document.createElement("div")
    el.className = `toast text-bg-${ok ? "success" : "danger"}`
    el.setAttribute("role", ok ? "status" : "alert")
    el.innerHTML = `
        ${icon(ok ? "circle-check" : "triangle-exclamation", ok ? "toast-ok" : "toast-err")}
        <span class="toast-msg"></span>
        <button class="toast-close" type="button" aria-label="ปิด" title="ปิด">${icon("xmark")}</button>`
    el.querySelector(".toast-msg").textContent = msg || "ไม่มีข้อความ"
    el.querySelector(".toast-close").onclick = () => el.dispatchEvent(new Event("hidden.bs.toast"))

    $("toasts").appendChild(el)
    new bootstrap.Toast(el, { delay: TOAST_DELAY }).show()
    el.addEventListener("hidden.bs.toast", () => el.remove())
}

const setBusy = v => {
    busy = v
    $("create").disabled = v
    $("refresh").disabled = v
    $("refresh").classList.toggle("is-loading", v)
    $("saveEdit").disabled = v
}

const syncToReset = () => { $("toReset").disabled = !$("to").value }

/** @param {any} l */
const fileInfo = l => {
    const drive = l.type === "drive"
    const head = `<span class="file-sum">${icon(drive ? "cloud" : "file")} ${metaLine([`${l.count} ไฟล์`, fmtSize(l.total)])}</span>`
    let out = head

    if (l.names?.length) {
        const more = l.count > 2 ? ` +${l.count - 2}` : ""
        out += `<small class="file-names" title="${esc(l.names.join(", "))}">${esc(l.names.slice(0, 2).join(", "))}${more}</small>`
    }

    if (drive) return out + `<small class="file-exp">${icon("infinity")} Google Drive, ไม่หมดอายุ</small>`
    if (!(l.exp > 0)) return out + `<small class="file-exp">${icon("clock")} ไม่ทราบวันหมดอายุ</small>`
    const dead = l.exp < Date.now()
    const day = new Date(l.exp).toLocaleDateString("th-TH", { dateStyle: "medium" })
    return out + `<small class="file-exp ${dead ? "file-dead" : ""}">${icon(dead ? "clock-rotate-left" : "clock")} ${dead ? "หมดอายุแล้ว" : "หมดอายุ"} ${day}</small>`
}

const actionBtn = (cls, attrs, title, ico) =>
    `<button type="button" class="btn ${cls} btn-icon" ${attrs} title="${title}" aria-label="${title}">${icon(ico)}</button>`

/** @param {any} l */
const rowHtml = l => {
    const slug = esc(l.slug)
    const file = isFile(l)
    return `
        <tr>
            <td class="link-slug" data-label="ลิงก์ย่อ">
                <a href="https://go.thatako.net/${slug}" target="_blank" rel="noopener" title="คัดลอกลิงก์: ${slug}"><span class="slug-text">${slug}</span>${icon("copy", "slug-copy")}</a>
            </td>
            <td class="link-to" data-label="ปลายทาง" title="${file ? "" : esc(l.to)}">${file ? fileInfo(l) : `<span class="to-text">${esc(l.to)}</span>`}</td>
            <td class="link-actions-cell">
                <div class="link-actions">
                    ${actionBtn("btn-ghost", `data-edit="${slug}" data-to="${esc(l.to)}" data-type="${file ? l.type : "url"}"`, "แก้ไขลิงก์", "pen")}
                    ${actionBtn("btn-ghost", `data-qr="${slug}"`, "สร้าง QR CODE", "qrcode")}
                    ${actionBtn("btn-danger", `data-revoke="${slug}"`, "ลบลิงก์", "trash")}
                </div>
            </td>
        </tr>`
}

const emptyRow = (name, text, extra = "") => `
    <tr>
        <td colspan="3">
            <div class="empty-state">
                ${icon(name, "empty-ico")}
                <div>${text}${extra}</div>
            </div>
        </td>
    </tr>`

const rows = createVirtualRows({
    tbody: $("list"),
    render: rowHtml,
    key: l => `${l.type}:${l.slug}`
})

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
    $("resultCount").textContent = !links.length ? "ยังไม่มีลิงก์"
        : filtering ? `แสดง ${shown.length} จาก ${links.length} ลิงก์`
            : `ทั้งหมด ${links.length} ลิงก์`

    $("list").removeAttribute("aria-busy")
    $("list").classList.remove("is-loading")
    if (!links.length) rows.setHtml(emptyRow("link-slash", "ยังไม่มีลิงก์ - สร้างลิงก์แรกได้เลย"))
    else if (!shown.length) rows.setHtml(emptyRow("magnifying-glass", "ไม่พบลิงก์ที่ตรงกัน", `<br><button type="button" class="btn btn-ghost btn-sm" data-reset-filter>${icon("filter-slash")} ล้างตัวกรอง</button>`))
    else rows.setItems(shown)
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
    if (!loadedOnce) {
        rows.setHtml(skRows(6))
        $("list").setAttribute("aria-busy", "true")
        $("resultCount").innerHTML = `${skInline("110px")}<span class="sr-only">กำลังโหลดข้อมูล</span>`
    } else {
        $("list").classList.add("is-loading")
        $("list").setAttribute("aria-busy", "true")
    }
    try {
        const data = await api(`/list?key=${encodeURIComponent(key)}`)
        loadedOnce = true
        renderList(data)
    } catch {
        $("list").removeAttribute("aria-busy")
        $("list").classList.remove("is-loading")
        if (!loadedOnce || !links.length) {
            $("resultCount").textContent = "โหลดข้อมูลไม่สำเร็จ"
            rows.setHtml(emptyRow("cloud-xmark", "ไม่สามารถโหลดข้อมูลได้", `<br><button type="button" class="btn btn-ghost btn-sm" data-retry>${icon("rotate-right")} ลองใหม่</button>`))
        }
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
        syncToReset()
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
    if (dataset.type === "file" || dataset.type === "drive") return openFiles(dataset.edit, dataset.type)
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
    } catch { toast(`การบันทึกล้มเหลว`, false) }
    setBusy(false)
}

/** @param {string} slug */
const revoke = async slug => {
    const l = links.find(x => x.slug === slug)
    const ok = await confirmDialog({
        tone: "danger",
        title: "ลบลิงก์นี้หรือไม่?",
        html: `ลิงก์ <b>go.thatako.net/${esc(slug)}</b> จะใช้งานไม่ได้อีก และกู้คืนไม่ได้`,
        detail: l?.type === "file" ? "ไฟล์ที่อัปโหลดไว้บนเซิร์ฟเวอร์จะถูกลบถาวรด้วย"
            : l?.type === "drive" ? "ไฟล์ยังอยู่ใน Google Drive ของคุณ"
                : "",
        confirmText: "ลบลิงก์",
        confirmIcon: "trash"
    })
    if (!ok) return

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

        if (b?.hasAttribute("data-retry")) return loadLinks()
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

    $("to").oninput = syncToReset
    $("toReset").onclick = e => {
        e.preventDefault()
        $("to").value = ""
        syncToReset()
        $("to").focus()
    }
}

const init = () => {
    initEvents()
    syncToReset()
    initKey()
    initQR({ toast })
    initUpload({ api: API_URL, key: () => $("key").value.trim(), validSlug, toast, reload: loadLinks })
    initFiles({ api: API_URL, key: () => $("key").value.trim(), validSlug, toast, reload: loadLinks })
    loadLinks()
}

document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init()
