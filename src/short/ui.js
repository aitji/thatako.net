export const $ = id => document.getElementById(id)
export const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
export const icon = (name, cls = "") => `<i class="fa-solid fa-${name}${cls ? " " + cls : ""}" aria-hidden="true"></i>`
export const SEP = `<i class="fa-solid fa-circle sep" aria-hidden="true"></i>`
export const joinHtml = parts => parts.filter(Boolean).join(SEP)
export const meta = parts => joinHtml(parts.map(p => (p == null || p === "") ? "" : esc(p)))
export const metaLine = parts => `<span class="meta">${meta(parts)}</span>`
export const dims = (w, h = w) => `${esc(w)}${icon("xmark", "dim")}${esc(h)}`
export const fmtSize = b => {
    const u = ["B", "KB", "MB", "GB", "TB"]
    let i = 0
    while (b >= 1024 && i < 4) { b /= 1024; i++ }
    return `${b >= 100 || !i ? Math.round(b) : b.toFixed(1)} ${u[i]}`
}

export const fmtEta = secs => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`
export const skLine = (w = "100%", cls = "") => `<span class="sk sk-line${cls ? " " + cls : ""}" style="width:${w}"></span>`
export const skInline = (w = "6em") => `<span class="sk sk-line sk-inline" style="width:${w}" aria-hidden="true"></span>`
const SK_W = [["58%", "82%"], ["42%", "68%"], ["66%", "76%"], ["50%", "88%"], ["72%", "60%"]]
export const skRow = i => `
    <tr class="sk-row" aria-hidden="true">
        <td class="link-slug">${skLine(SK_W[i % 5][0])}</td>
        <td class="link-to">${skLine(SK_W[i % 5][1])}${i % 4 === 3 ? skLine("38%", "sm") : ""}</td>
        <td class="link-actions-cell"><div class="link-actions"><span class="sk sk-btn"></span><span class="sk sk-btn"></span><span class="sk sk-btn"></span></div></td>
    </tr>`
export const skRows = (n = 6) => Array.from({ length: n }, (_, i) => skRow(i)).join("")
export const skFileRows = (n = 3) => Array.from({ length: n }, (_, i) =>
    `<li class="sk-li" aria-hidden="true">${skLine(SK_W[i % 5][1])}${skLine("46px", "sm")}<span class="sk sk-btn"></span><span class="sk sk-btn"></span></li>`).join("")
