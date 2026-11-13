import { uploadMore, cancelMore, uploadErr } from './upload.js'
import { $, esc, icon, meta, fmtSize, fmtEta } from './ui.js'
const FAIL = 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่'

/** @type {{ slug: string, type: 'file'|'drive', exp: number, maxFiles: number, perUpload: number, files: { k: number, name: string, size: number, isNew?: boolean }[] } | null} */
let cur = null
let picked = []
let busy = false
let ctx

const h = (tag, cls, text) => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text != null) e.textContent = text
    return e
}

const iconBtn = (name, title, cls = 'btn-ghost') => {
    const b = h('button', `btn ${cls}`)
    b.type = 'button'
    b.title = title
    b.setAttribute('aria-label', title)
    b.innerHTML = icon(name)
    return b
}

const post = async (path, body) => (await fetch(ctx.api + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: ctx.key(), ...body })
})).json()

const msg = m => m === 'duplicate' ? 'ไฟล์นี้อยู่ในลิงก์แล้ว' : uploadErr(m, FAIL)

const dateText = exp => new Date(exp).toLocaleDateString('th-TH', { dateStyle: 'medium' })
const room = () => Math.max(0, cur.maxFiles - cur.files.length - picked.length)
const refresh = async () => {
    const r = await post('/file/info', { slug: cur.slug })
    if (!r.ok) throw new Error(r.msg)
    const had = new Set(cur.files.map(f => f.k))
    const first = !cur.loaded
    cur = { ...cur, loaded: true, type: r.type, exp: r.exp, maxFiles: r.maxFiles, perUpload: r.perUpload, files: r.files.map(f => ({ ...f, isNew: !first && !had.has(f.k) })) }
}

const renameRow = (li, f) => {
    const input = h('input')
    input.type = 'text'
    input.value = f.name
    input.maxLength = 200
    input.setAttribute('aria-label', 'ชื่อไฟล์ใหม่')
    const ok = iconBtn('check', 'บันทึกชื่อ', 'btn-primary')
    const no = iconBtn('xmark', 'ยกเลิก')
    li.replaceChildren(input, ok, no)
    input.focus()
    input.setSelectionRange(0, f.name.lastIndexOf('.') > 0 ? f.name.lastIndexOf('.') : f.name.length)

    const save = async () => {
        const name = input.value.trim()
        if (!name) return ctx.toast('กรุณาใส่ชื่อไฟล์', false)
        if (name === f.name) return render()
        ok.disabled = no.disabled = true
        try {
            const r = await post('/file/rename', { slug: cur.slug, k: f.k, name })
            if (!r.ok) throw new Error(r.msg)
            f.name = r.name
            ctx.toast('เปลี่ยนชื่อแล้ว')
            render()
            ctx.reload()
        } catch (e) {
            ctx.toast(msg(e.message), false)
            ok.disabled = no.disabled = false
        }
    }
    ok.onclick = save
    no.onclick = render
    input.onkeydown = e => {
        if (e.key === 'Enter') { e.preventDefault(); save() }
        else if (e.key === 'Escape') { e.stopPropagation(); render() }
    }
}

const removeFile = async f => {
    const note = cur.type === 'drive' ? 'ไฟล์ยังอยู่ใน Google Drive ของคุณ' : 'ไฟล์จะถูกลบถาวร'
    if (!confirm(`เอา "${f.name}" ออกจากลิงก์นี้หรือไม่?\n(${note})`)) return
    try {
        const r = await post('/file/remove', { slug: cur.slug, k: f.k })
        if (!r.ok) throw new Error(r.msg)
        cur.files = cur.files.filter(x => x !== f)
        ctx.toast('เอาไฟล์ออกแล้ว')
        render()
        ctx.reload()
    } catch (e) { ctx.toast(msg(e.message), false) }
}

const fileRow = (f, only) => {
    const li = h('li', f.isNew ? 'fm-new' : '')
    const name = h('span', 'fm-name', f.name)
    name.title = f.name
    const badge = f.isNew ? h('span', 'badge-new', 'ใหม่') : null
    const ren = iconBtn('pen', 'เปลี่ยนชื่อ')
    const del = iconBtn('trash', 'เอาออกจากลิงก์', 'btn-danger')
    ren.onclick = () => renameRow(li, f)
    del.onclick = () => removeFile(f)
    if (only) {
        del.disabled = true
        del.title = 'ต้องเหลืออย่างน้อย 1 ไฟล์ ถ้าไม่ต้องการแล้วให้ลบทั้งลิงก์จากรายการหลัก'
    }
    li.append(...[name, badge, h('small', 0, fmtSize(f.size)), ren, del].filter(Boolean))
    return li
}

const renderPicked = () => {
    const ul = $('fmPicked')
    ul.replaceChildren()
    picked.forEach((f, i) => {
        const li = h('li')
        const rm = h('button', 'up-rm')
        rm.type = 'button'
        rm.title = 'เอาออก'
        rm.setAttribute('aria-label', `เอา ${f.name} ออก`)
        rm.innerHTML = icon('xmark')
        rm.onclick = () => { if (!busy) { picked.splice(i, 1); render() } }
        const n = h('span', 'up-name', f.name)
        n.title = f.name
        li.append(n, h('small', 0, fmtSize(f.size)), rm)
        ul.append(li)
    })
}

const setStatus = html => { $('fmText').innerHTML = html }
const idleStatus = () => {
    const size = picked.reduce((a, f) => a + f.size, 0)
    setStatus(picked.length ? meta([`เลือกแล้ว ${picked.length} ไฟล์`, fmtSize(size)]) : 'ยังไม่ได้เลือกไฟล์')
}

const render = () => {
    if (!cur) return
    const drive = cur.type === 'drive'
    const total = cur.files.reduce((a, f) => a + f.size, 0)

    if (document.activeElement !== $('fmSlug')) $('fmSlug').value = cur.slug
    $('fmSlugSave').disabled = busy || !$('fmSlug').value.trim() || $('fmSlug').value.trim() === cur.slug

    $('fmMeta').innerHTML = drive
        ? `${icon('cloud')} ${meta(['Google Drive', 'ไม่หมดอายุ', `${cur.files.length}/${cur.maxFiles} ไฟล์`])}`
        : `${icon('hard-drive')} ${meta([`${cur.files.length}/${cur.maxFiles} ไฟล์`, fmtSize(total), `หมดอายุ ${dateText(cur.exp)}`])}`
    $('fmHint').textContent = drive
        ? 'การเปลี่ยนชื่อมีผลเฉพาะชื่อในหน้าดาวน์โหลด และการเอาออกไม่ลบไฟล์ใน Google Drive ของคุณ'
        : 'ไฟล์ที่เพิ่มใหม่จะหมดอายุพร้อมลิงก์นี้'

    const ul = $('fmList')
    ul.replaceChildren(...cur.files.map(f => fileRow(f, cur.files.length <= 1)))

    renderPicked()
    const left = room()
    $('fmLimits').innerHTML = drive
        ? meta([`เพิ่มได้อีก ${left} ไฟล์`, 'อัปโหลดเข้า Google Drive ของคุณ'])
        : meta([`เพิ่มได้อีก ${left} ไฟล์`, `สูงสุด ${fmtSize(cur.perUpload)} ต่อครั้ง`])
    const size = picked.reduce((a, f) => a + f.size, 0)
    $('fmUploadLabel').textContent = picked.length ? `เพิ่ม ${picked.length} ไฟล์ (${fmtSize(size)})` : 'เพิ่มไฟล์'
    $('fmUpload').disabled = busy || !picked.length
    $('fmFiles').disabled = busy
    if (!busy) idleStatus()
}

const saveSlug = async () => {
    const newSlug = $('fmSlug').value.trim()
    if (!newSlug || newSlug === cur.slug) return
    if (!ctx.validSlug(newSlug)) return ctx.toast('ชื่อลิงก์ย่อไม่ถูกต้อง', false)
    $('fmSlugSave').disabled = true
    try {
        const r = await post('/edit', { slug: cur.slug, newSlug })
        if (!r.ok) throw new Error(r.msg)
        cur.slug = newSlug
        ctx.toast('บันทึกชื่อลิงก์แล้ว')
        ctx.reload()
    } catch (e) {
        ctx.toast(e.message === 'duplicate' ? 'ชื่อนี้ถูกใช้แล้ว' : msg(e.message), false)
    }
    render()
}

const pick = list => {
    if (!cur || busy) return
    for (const f of list) {
        if (!f.size) { ctx.toast(`ข้ามไฟล์ว่าง: ${f.name}`, false); continue }
        if (picked.some(p => p.name === f.name && p.size === f.size && p.lastModified === f.lastModified)) continue
        if (!room()) { ctx.toast(`ลิงก์นี้มีได้สูงสุด ${cur.maxFiles} ไฟล์`, false); break }
        picked.push(f)
    }
    render()
}

const upload = async () => {
    if (busy || !picked.length) return
    const total = picked.reduce((a, f) => a + f.size, 0)
    if (cur.type === 'file' && total > cur.perUpload) return ctx.toast(uploadErr('too big'), false)

    busy = true
    $('fmProg').classList.remove('idle')
    $('fmCancel').disabled = false
    $('fmBar').style.width = '0%'
    setStatus('กำลังเตรียมอัปโหลด')
    render()

    const slug = cur.slug
    try {
        await uploadMore({
            slug, type: cur.type, files: picked,
            onProgress: (sent, all, secs) => {
                const eta = Math.round((all - sent) / Math.max(1, sent / secs))
                $('fmBar').style.width = Math.min(100, sent / all * 100) + '%'
                setStatus(meta([`${fmtSize(sent)} / ${fmtSize(all)}`, `${fmtSize(sent / secs)}/s`, `เหลือ ~${fmtEta(eta)}`]))
            }
        })
        ctx.toast(`เพิ่ม ${picked.length} ไฟล์แล้ว`)
        picked = []
        if (cur?.slug === slug) await refresh()
        ctx.reload()
    } catch (e) { ctx.toast(msg(e.message), false) }
    busy = false
    $('fmProg').classList.add('idle')
    $('fmCancel').disabled = true
    $('fmBar').style.width = '0%'
    render()
}

/** @param {string} slug @param {'file'|'drive'} type */
export const openFiles = async (slug, type) => {
    if (busy && cur?.slug !== slug) return ctx.toast(uploadErr('busy'), false)
    if (!busy) {
        cur = { slug, type, exp: 0, maxFiles: 0, perUpload: 0, files: [], loaded: false }
        picked = []
        $('fmList').replaceChildren()
        $('fmSlug').value = slug
        $('fmSlugSave').disabled = true
        $('fmMeta').textContent = 'กำลังโหลดข้อมูลไฟล์'
        $('fmLimits').innerHTML = '&nbsp;'
        $('fmUpload').disabled = true
    }
    window.ModalManager.open('filesModal')
    if (busy) return
    try {
        await refresh()
        render()
    } catch (e) {
        window.ModalManager.close('filesModal')
        ctx.toast(msg(e.message), false)
        cur = null
    }
}

/** @param {{ api: string, key: () => string, validSlug: (s: string) => boolean, toast: (m: string, ok?: boolean) => void, reload: () => any }} c */
export const initFiles = c => {
    ctx = c
    $('fmFiles').onchange = e => { pick(e.target.files); e.target.value = '' }
    $('fmUpload').onclick = upload
    $('fmSlugSave').onclick = saveSlug
    $('fmSlug').oninput = () => { const v = $('fmSlug').value.trim(); $('fmSlugSave').disabled = busy || !v || v === cur?.slug }
    $('fmSlug').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); saveSlug() } }
    $('fmCancel').disabled = true
    $('fmCancel').onclick = cancelMore

    const drop = $('fmDrop')
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over') }
    drop.ondragleave = () => drop.classList.remove('over')
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); pick(e.dataTransfer.files) }
}
