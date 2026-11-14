import { esc, icon } from "./ui.js"

const ID = "confirmModal"
let root = null
let settle = null

const build = () => {
    root = document.createElement("div")
    root.className = "modal-overlay confirm-overlay"
    root.id = ID
    root.setAttribute("role", "alertdialog")
    root.setAttribute("aria-modal", "true")
    root.setAttribute("aria-labelledby", "confirmTitle")
    root.setAttribute("aria-describedby", "confirmMsg")
    root.innerHTML = `
        <div class="modal-box confirm-box">
            <div class="modal-body confirm-body">
                <div class="confirm-ico" id="confirmIco" aria-hidden="true"></div>
                <div class="confirm-text">
                    <h2 class="confirm-title" id="confirmTitle"></h2>
                    <p class="confirm-msg" id="confirmMsg"></p>
                    <p class="confirm-detail" id="confirmDetail" hidden></p>
                </div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-ghost" id="confirmNo"></button>
                <button type="button" class="btn" id="confirmYes"></button>
            </div>
        </div>`
    document.body.appendChild(root)

    root.addEventListener("modal:close", () => finish(false))
    root.querySelector("#confirmNo").onclick = () => finish(false)
    root.querySelector("#confirmYes").onclick = () => finish(true)
}

const finish = ok => {
    const done = settle
    settle = null
    if (!done) return
    window.ModalManager.close(ID)
    done(ok)
}

export const confirmDialog = o => {
    if (!root) build()
    if (settle) finish(false)

    const tone = o.tone || "primary"
    root.querySelector(".confirm-box").className = `modal-box confirm-box ${tone}`
    root.querySelector("#confirmIco").innerHTML = icon(o.icon || (tone === "danger" ? "triangle-exclamation" : "circle-question"))
    root.querySelector("#confirmTitle").textContent = o.title
    const msg = root.querySelector("#confirmMsg")
    msg.hidden = !o.message && !o.html
    if (o.html) msg.innerHTML = o.html
    else msg.textContent = o.message || ""
    const detail = root.querySelector("#confirmDetail")
    detail.hidden = !o.detail
    detail.innerHTML = o.detail ? `${icon("circle-info")}<span>${esc(o.detail)}</span>` : ""

    const no = root.querySelector("#confirmNo")
    const yes = root.querySelector("#confirmYes")
    no.textContent = o.cancelText ?? "ยกเลิก"
    no.hidden = o.cancelText === null
    yes.className = `btn ${tone === "danger" ? "btn-danger-solid" : "btn-primary"}`
    yes.innerHTML = `${o.confirmIcon ? icon(o.confirmIcon) + " " : ""}${esc(o.confirmText || "ยืนยัน")}`
    no.toggleAttribute("data-autofocus", tone === "danger" && !no.hidden)
    yes.toggleAttribute("data-autofocus", !(tone === "danger" && !no.hidden))

    return new Promise(res => {
        settle = res
        window.ModalManager.open(ID)
    })
}

export const alertDialog = o => confirmDialog({ confirmText: "ตกลง", cancelText: null, ...o })
