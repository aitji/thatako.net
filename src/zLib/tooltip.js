const GAP = 10
const EDGE = 8
const ARROW = 5
const HOVER_DELAY = 120
const TOUCH_SHOW = 380
const TOUCH_HIDE = 2200
const SELECTOR = "[data-tooltip],[title],[data-tip-title]"

const init = () => {
    if (window.aitjiTooltip) return

    const tip = document.createElement("div")
    tip.className = "aitji-tooltip"
    tip.setAttribute("role", "tooltip")
    tip.id = "aitji-tooltip"
    const text = document.createElement("div")
    text.className = "aitji-text"
    tip.append(text, Object.assign(document.createElement("div"), { className: "aitji-arrow" }))
    document.body.appendChild(tip)

    let cur = null
    let via = ""
    let showT = 0, touchT = 0, hideT = 0, raf = 0

    const find = n => n?.closest?.(SELECTOR) || null
    const textOf = el => el.dataset.tooltip || el.getAttribute("title") || el.dataset.tipTitle || ""

    const park = el => {
        const t = el.getAttribute("title")
        if (t == null) return
        el.dataset.tipTitle = t
        el.removeAttribute("title")
    }
    const unpark = el => {
        if (!el?.isConnected || el.dataset.tipTitle == null) return
        if (!el.hasAttribute("title")) el.setAttribute("title", el.dataset.tipTitle)
        delete el.dataset.tipTitle
    }

    const place = () => {
        if (!cur) return
        if (!cur.isConnected) return hide(true)
        const r = cur.getBoundingClientRect()
        const vw = document.documentElement.clientWidth, vh = window.innerHeight
        if (!r.width && !r.height) return hide(true)
        if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return hide(true)

        const t = tip.getBoundingClientRect()
        const roomAbove = r.top - GAP - EDGE, roomBelow = vh - r.bottom - GAP - EDGE
        const dir = roomAbove >= t.height || roomAbove >= roomBelow ? "top" : "bottom"
        const y = dir === "top" ? r.top - GAP - t.height : r.bottom + GAP
        const mid = r.left + r.width / 2
        const x = Math.max(EDGE, Math.min(vw - EDGE - t.width, mid - t.width / 2))
        const ax = Math.max(ARROW + 4, Math.min(t.width - ARROW - 4, mid - x))

        tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(Math.max(EDGE, y))}px)`
        tip.style.setProperty("--arrow-x", Math.round(ax) + "px")
        tip.dataset.dir = dir
    }

    const loop = () => {
        raf = 0
        if (!cur) return
        place()
        if (via === "hover" && cur && !cur.matches(":hover") && !cur.matches(":focus-visible")) return hide(true)
        raf = requestAnimationFrame(loop)
    }

    const show = (el, how, delay = 0) => {
        clearTimeout(showT)
        clearTimeout(hideT)
        const t = textOf(el)
        if (!t) return
        if (cur && cur !== el) { unpark(cur); cur = null }
        const go = () => {
            if (!el.isConnected) return
            park(el)
            cur = el
            via = how
            text.textContent = t
            tip.classList.remove("show", "instant")
            place()
            tip.classList.add("show")
            el.setAttribute("aria-describedby", tip.id)
            if (!raf) raf = requestAnimationFrame(loop)
        }
        if (delay) showT = setTimeout(go, delay)
        else go()
    }

    function hide(now = false) {
        clearTimeout(showT)
        clearTimeout(touchT)
        clearTimeout(hideT)
        if (!cur) return tip.classList.remove("show")
        const el = cur
        cur = null
        via = ""
        cancelAnimationFrame(raf)
        raf = 0
        tip.classList.remove("show")
        if (now) tip.classList.add("instant")
        else tip.classList.remove("instant")
        el.removeAttribute("aria-describedby")
        unpark(el)
    }

    document.addEventListener("pointerover", e => {
        if (e.pointerType === "touch") return
        const el = find(e.target)
        if (!el) return cur && via === "hover" && hide()
        if (el === cur) return clearTimeout(hideT)
        show(el, "hover", cur ? 0 : HOVER_DELAY)
    }, true)

    document.addEventListener("pointerout", e => {
        if (e.pointerType === "touch") return
        const el = find(e.target)
        if (!el) return
        if (e.relatedTarget && el.contains(e.relatedTarget)) return
        clearTimeout(showT)
        if (el === cur && via === "hover") hideT = setTimeout(() => hide(), 40)
    }, true)

    document.addEventListener("pointermove", e => {
        if (!cur || via !== "hover" || e.pointerType === "touch") return
        if (!find(e.target) || find(e.target) !== cur) { if (!cur.matches(":hover")) hide() }
    }, { passive: true })

    document.addEventListener("focusin", e => {
        const el = find(e.target)
        if (!el) return
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.type !== "checkbox") return
        if (!el.matches(":focus-visible")) return
        show(el, "focus")
    })

    document.addEventListener("focusout", e => { if (cur && cur === find(e.target) && via === "focus") hide(true) })
    document.addEventListener("keydown", e => { if (e.key === "Escape" && cur) hide(true) }, true)
    document.addEventListener("pointerdown", e => {
        if (e.pointerType === "touch") return
        if (cur && via === "hover") hide(true)
    }, true)

    document.addEventListener("touchstart", e => {
        const el = find(e.target)
        if (!el) return hide()
        clearTimeout(touchT)
        touchT = setTimeout(() => {
            show(el, "touch")
            hideT = setTimeout(() => hide(), TOUCH_HIDE)
        }, TOUCH_SHOW)
    }, { passive: true })
    for (const ev of ["touchend", "touchmove", "touchcancel"]) document.addEventListener(ev, () => clearTimeout(touchT), { passive: true })
    document.addEventListener("scroll", () => { if (cur && via === "touch") hide(true) }, { passive: true, capture: true })

    window.addEventListener("resize", () => cur && place(), { passive: true })
    window.addEventListener("blur", () => hide(true))
    document.addEventListener("visibilitychange", () => document.hidden && hide(true))
    window.addEventListener("pagehide", () => hide(true))

    window.aitjiTooltip = {
        show: el => el && show(el, "api"),
        hide: () => hide(true),
        update: el => { if (el && el === cur) { text.textContent = textOf(el) || text.textContent; place() } }
    }
}

document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init()
