const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]):not([hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
const stack = []
const opener = new Map()

const focusables = el => [...el.querySelectorAll(FOCUSABLE)].filter(n => n.offsetParent !== null || n === document.activeElement)
const ModalManager = {
    isOpen: id => stack.includes(id),
    top: () => stack[stack.length - 1],

    open(id, opts = {}) {
        const el = document.getElementById(id)
        if (!el || stack.includes(id)) return
        opener.set(id, document.activeElement)
        el.classList.add("open")
        stack.push(id)
        document.documentElement.classList.add("modal-open")
        const box = el.querySelector(".modal-box") || el
        if (!box.hasAttribute("tabindex")) box.tabIndex = -1
        requestAnimationFrame(() => {
            if (!el.classList.contains("open")) return
            const target = (opts.focus && el.querySelector(opts.focus)) ||
                el.querySelector("[data-autofocus]") || box
            target.focus({ preventScroll: true })
        })
    },
    close(id) {
        const el = document.getElementById(id)
        const at = stack.indexOf(id)
        if (!el || at < 0) return
        el.classList.remove("open")
        stack.splice(at, 1)
        if (!stack.length) document.documentElement.classList.remove("modal-open")

        const back = opener.get(id)
        opener.delete(id)
        if (!stack.length || stack[stack.length - 1] === id) back?.isConnected && back.focus?.({ preventScroll: true })
        el.dispatchEvent(new CustomEvent("modal:close"))
    }
}

let downOn = null
window.ModalManager = ModalManager
document.addEventListener("mousedown", e => { downOn = e.target })
document.addEventListener("click", e => {
    const t = e.target
    if (t.classList?.contains("modal-overlay") && downOn === t) ModalManager.close(t.id)
    downOn = null
})

const bindClose = (btnId, modalId) => {
    const btn = document.getElementById(btnId)
    if (btn) btn.onclick = () => ModalManager.close(modalId)
}
bindClose("editModalClose", "editModal")
bindClose("editModalCancel", "editModal")
bindClose("qrModalClose", "qrModal")
bindClose("filesModalClose", "filesModal")
bindClose("filesModalDone", "filesModal")

document.addEventListener("keydown", e => {
    const id = ModalManager.top()
    if (!id) return

    if (e.key === "Escape") {
        e.preventDefault()
        return ModalManager.close(id)
    }

    if (e.key === "Tab") {
        const el = document.getElementById(id)
        const list = focusables(el.querySelector(".modal-box") || el)
        if (!list.length) return e.preventDefault()
        const first = list[0], last = list[list.length - 1]
        if (!el.contains(document.activeElement)) { e.preventDefault(); first.focus() }
        else if (e.shiftKey && (document.activeElement === first || document.activeElement.classList.contains("modal-box"))) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
})

window.bootstrap = {
    Modal: class {
        constructor(el) { this._id = el?.id }
        show() { if (this._id) ModalManager.open(this._id) }
        hide() { if (this._id) ModalManager.close(this._id) }
        static getInstance(el) {
            return { hide: () => el?.id && ModalManager.close(el.id) }
        }
    },

    Toast: class {
        constructor(el, opts = {}) {
            this._el = el
            this._delay = opts.delay || 2500
        }
        show() {
            if (!this._el) return

            this._el.style.opacity = "0"
            this._el.style.transform = "translateY(8px)"

            requestAnimationFrame(() => {
                this._el.style.transition = "opacity 0.12s, transform 0.12s"
                this._el.style.opacity = "1"
                this._el.style.transform = "translateY(0)"
            })

            setTimeout(() => {
                this._el.style.opacity = "0"
                setTimeout(() => {
                    this._el.dispatchEvent(new Event("hidden.bs.toast"))
                }, 150)
            }, this._delay)
        }
    }
}
