window.ModalManager = { // modal manager
    open(id) {
        const el = document.getElementById(id)
        if (el) el.classList.add('open')
    },
    close(id) {
        const el = document.getElementById(id)
        if (el) el.classList.remove('open')
    }
}

;['editModal', 'qrModal', 'filesModal'].forEach(id => { // overlay
    const overlay = document.getElementById(id)
    if (!overlay) return
    overlay.addEventListener('click', e => {
        if (e.target === overlay) ModalManager.close(id)
    })
})



// x buttons
const bindClose = (btnId, modalId) => {
    const btn = document.getElementById(btnId)
    if (btn) btn.onclick = () => ModalManager.close(modalId)
}

bindClose('editModalClose', 'editModal')
bindClose('editModalCancel', 'editModal')
bindClose('qrModalClose', 'qrModal')
bindClose('filesModalClose', 'filesModal')
bindClose('filesModalDone', 'filesModal')

document.addEventListener('keydown', e => { // esc
    if (e.key === 'Escape') {
        ModalManager.close('editModal')
        ModalManager.close('qrModal')
        ModalManager.close('filesModal')
    }
})

/**
 * (boostrap shim)

 * what happened?
 * in prototype i use boostrap, but in new design i want to remove boostrap dependency (it too big),
 * so i create this shim to avoid rewrite all js code in prototype
 */
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

            this._el.style.opacity = '0'
            this._el.style.transform = 'translateY(8px)'

            requestAnimationFrame(() => {
                this._el.style.transition = 'opacity 0.12s, transform 0.12s'
                this._el.style.opacity = '1'
                this._el.style.transform = 'translateY(0)'
            })

            setTimeout(() => {
                this._el.style.opacity = '0'
                setTimeout(() => {
                    this._el.dispatchEvent(new Event('hidden.bs.toast'))
                }, 150)
            }, this._delay)
        }
    },

    Tooltip: class { constructor() {} }
}
