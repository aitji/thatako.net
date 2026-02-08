const API_URL = "http://go.thatako.net/api"
const STORAGE_KEY = "short-key"
const MAX_SLUG_LENGTH = 1024
const TOAST_DELAY = 2500

let editing = null
let busy = false
const $ = id => document.getElementById(id)

/** @param {string} slug */
const validSlug = slug =>
    slug &&
    slug.length < MAX_SLUG_LENGTH &&
    !slug.startsWith("/") &&
    !slug.startsWith("api/")

/** @param {string} url */
const validUrl = url => {
    try {
        const u = new URL(url)
        return u.protocol === "http:" || u.protocol === "https:"
    } catch { return false }
}

const randomKey = () =>
    (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2))
        .split("")
        .map(c => (Math.random() > 0.5 ? c.toUpperCase() : c.toLowerCase()))
        .join("")

/** @param {string} t */
const truncate = (t, m = 60) => (t.length > m ? t.slice(0, m) + "..." : t)

/** @param {string} msg */
const toast = (msg, ok = true) => {
    const el = document.createElement("div")
    el.className = `toast align-items-center text-bg-${ok ? "success" : "danger"} border-0`
    el.innerHTML = `
    <div class="d-flex">
        <div class="toast-body">${msg}</div>
        <button class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
    </div>`
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
        ? `<tr><td colspan="3" class="text-center text-muted py-4">ยังไม่มีลิ้งก์</td></tr>`
        : links
            .map(l => `
            <tr>
                <td>
                    <a href="/${l.slug}" target="_blank">${l.slug}</a>
                    <button class="btn btn-sm btn-outline ms-2" data-copy="${l.slug}">คัดลอก</button>
                </td>
                <td>${truncate(l.to)}</td>
                <td class="text-end">
                    <button class="btn btn-sm btn-secondary" data-edit="${l.slug}">แก้ไข</button>
                    <button class="btn btn-sm btn-danger" data-revoke="${l.slug}">ลบ</button>
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
        if (!r.ok) return toast(r.msg || "เกิดข้อผิดพลาด", false)

        toast("สร้างลิ้งก์สำเร็จ")
        $("slug").value = ""
        $("to").value = ""
        await loadLinks()
    } catch { toast("การสร้างลิ้งก์ล้มเหลว", false) }
    setBusy(false)
}

/** @param {string} slug */
const copyLink = async slug => {
    try {
        await navigator.clipboard.writeText(`${location.origin}/${slug}`)
        toast("คัดลอกลิงก์แล้ว")
    } catch { toast("ไม่สามารถคัดลอกได้", false) }
}

/** @param {string} slug */
const openEdit = slug => {
    editing = slug
    $("newSlug").value = ""
    $("newTo").value = ""
    new bootstrap.Modal($("editModal")).show()
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
            slug: editing,
            newSlug: newSlug || undefined,
            to: newTo || undefined,
            key
        })

        toast(r.ok ? "บันทึกสำเร็จ" : "บันทึกล้มเหลว", r.ok)

        if (r.ok) {
            bootstrap.Modal.getInstance($("editModal")).hide()
            await loadLinks()
        }
    } catch { toast("การบันทึกล้มเหลว", false) }
    setBusy(false)
}

/** @param {string} slug */
const revoke = async slug => {
    if (!confirm(`ต้องการลบลิงก์ "${slug}" หรือไม่?`)) return

    setBusy(true)
    try {
        const r = await api("/revoke", { slug, key: $("key").value.trim() })
        toast(r.ok, r.ok)
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
        if (!b || busy) return
        if (b.dataset.copy) await copyLink(b.dataset.copy)
        if (b.dataset.edit) openEdit(b.dataset.edit)
        if (b.dataset.revoke) await revoke(b.dataset.revoke)
    }

    $("slug").onkeypress = e => e.key === "Enter" && createLink()
    $("to").onkeypress = e => e.key === "Enter" && createLink()
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
