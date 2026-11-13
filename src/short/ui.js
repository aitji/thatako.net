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
