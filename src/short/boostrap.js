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

;['editModal', 'qrModal'].forEach(id => { // overlay
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

document.addEventListener('keydown', e => { // esc
    if (e.key === 'Escape') {
        ModalManager.close('editModal')
        ModalManager.close('qrModal')
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

// list rendering
const listEl = document.getElementById('list')
if (listEl) {
    const listDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')

    Object.defineProperty(listEl, 'innerHTML', {
        set(html) {
            if (!html) return listDescriptor.set.call(this, html)

            if (html.includes('btn-outline-danger') ||
                html.includes('btn-outline-secondary') ||
                html.includes('data-edit')) {

                const tmp = document.createElement('tbody')
                listDescriptor.set.call(tmp, html)

                const rows = tmp.querySelectorAll('tr')
                let newHtml = ''

                rows.forEach(row => {
                    const cells = row.querySelectorAll('td')
                    if (cells.length < 3) {
                        newHtml += row.outerHTML
                        return
                    }

                    const slugCell = cells[0].innerHTML
                    const toCell = cells[1].textContent.trim()
                    const btns = cells[2].querySelectorAll('button')

                    let actions = ''
                    btns.forEach(btn => {
                        if (btn.dataset.edit !== undefined)
                            actions += `<button class="btn btn-ghost" data-edit="${btn.dataset.edit}" data-to="${btn.dataset.to}">
                                <i class="fa-solid fa-pen" aria-hidden="true"></i> แก้ไข
                            </button>`
                        else if (btn.dataset.qr !== undefined)
                            actions += `<button class="btn btn-ghost" data-qr="${btn.dataset.qr}">
                                <i class="fa-solid fa-qrcode" aria-hidden="true"></i>
                            </button>`
                        else if (btn.dataset.revoke !== undefined)
                            actions += `<button class="btn btn-danger" data-revoke="${btn.dataset.revoke}">
                                <i class="fa-solid fa-trash" aria-hidden="true"></i>
                            </button>`
                    })

                    newHtml += `
                    <tr>
                        <td class="link-slug">${slugCell}</td>
                        <td class="link-to" title="${toCell}">${toCell}</td>
                        <td><div class="link-actions">${actions}</div></td>
                    </tr>`
                })

                listDescriptor.set.call(this, newHtml)
            }
            else if (html.includes('ยังไม่มีลิงก์')) {
                listDescriptor.set.call(this, `
                    <tr>
                        <td colspan="3">
                            <div class="empty-state">
                                <div style="display:flex;justify-content:center">
                                    <i class="fa-solid fa-link-slash"
                                       aria-hidden="true"
                                       style="font-size:24px;opacity:0.3"></i>
                                </div>
                                ยังไม่มีลิงก์ - สร้างลิงก์แรกได้เลย
                            </div>
                        </td>
                    </tr>
                `)
            }
            else {
                listDescriptor.set.call(this, html)
            }
        },
        get() {
            return listDescriptor.get.call(this)
        }
    })
}