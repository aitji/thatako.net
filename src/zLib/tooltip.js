document.addEventListener("DOMContentLoaded", () => {
    const tooltip = document.createElement("div")
    tooltip.className = "aitji-tooltip top"
    const textDiv = document.createElement("div")
    textDiv.className = "aitji-text"
    const arrow = document.createElement("div")
    arrow.className = "aitji-arrow"
    tooltip.appendChild(textDiv)
    tooltip.appendChild(arrow)
    document.body.appendChild(tooltip)

    let currentEl = null
    let showTimeout = null
    let hideTimeout = null
    let isHoveringTooltip = false
    let animFrame = null
    let state = { opacity: 0, y: -4 }
    let touchTimer = null

    function getTooltipText(el) { return el.dataset.tooltip || el.getAttribute("title") || el.dataset._title }
    function calculatePosition(el) {
        const rect = el.getBoundingClientRect()
        const tooltipRect = tooltip.getBoundingClientRect()
        const padding = 12, arrowOffset = 7
        let top, left, direction = "top"
        const spaceAbove = rect.top
        const spaceBelow = window.innerHeight - rect.bottom
        const tooltipHeight = tooltipRect.height || 50
        if (spaceAbove > tooltipHeight + padding || spaceBelow < tooltipHeight + padding) { top = rect.top - tooltipHeight - padding; direction = "top" }
        else { top = rect.bottom + padding; direction = "bottom" }
        left = rect.left + rect.width / 2 - tooltipRect.width / 2
        const rightEdge = window.innerWidth - padding
        if (left < padding) left = padding
        else if (left + tooltipRect.width > rightEdge) left = rightEdge - tooltipRect.width
        const arrowLeft = Math.max(arrowOffset, Math.min(tooltipRect.width - arrowOffset * 2, rect.left + rect.width / 2 - left))
        return { top: top + window.scrollY, left: left + window.scrollX, direction, arrowLeft: arrowLeft - arrowOffset }
    }

    function updateTooltipPosition(el) {
        const text = getTooltipText(el)
        if (!text) return
        textDiv.textContent = text
        const pos = calculatePosition(el)
        tooltip.style.left = pos.left + "px"
        tooltip.style.top = pos.top + "px"
        tooltip.className = "aitji-tooltip " + pos.direction
        arrow.style.left = pos.arrowLeft + "px"
    }

    function animateTo(targetOpacity, targetY, duration = 120, callback) {
        const start = performance.now()
        const initial = { opacity: parseFloat(state.opacity), y: state.y }
        function step(now) {
            const t = Math.min(1, (now - start) / duration)
            state.opacity = initial.opacity + (targetOpacity - initial.opacity) * t
            state.y = initial.y + (targetY - initial.y) * t
            tooltip.style.opacity = state.opacity
            tooltip.style.transform = `translateY(${state.y}px)`
            tooltip.style.visibility = state.opacity > 0 ? "visible" : "hidden"
            if (t < 1) animFrame = requestAnimationFrame(step)
            else if (callback) callback()
        }
        cancelAnimationFrame(animFrame)
        animFrame = requestAnimationFrame(step)
    }

    function showTooltip(el, delay = 100) {
        clearTimeout(showTimeout)
        clearTimeout(hideTimeout)
        const text = el.getAttribute("title")
        if (text && !el.dataset._title) { el.dataset._title = text; el.removeAttribute("title") }
        if (!getTooltipText(el)) return
        currentEl = el
        showTimeout = setTimeout(() => {
            updateTooltipPosition(el)
            animateTo(1, 0)
        }, delay)
    }

    function hideTooltip(immediate = false) {
        clearTimeout(showTimeout)
        if (!currentEl) return
        const fade = () => { state.opacity = 0; state.y = -4; tooltip.style.visibility = "hidden"; currentEl = null }
        if (immediate || !isHoveringTooltip) animateTo(0, -4, 80, fade)
    }

    function attachTooltip(el) {
        if (el.dataset.tooltipAttached) return
        el.dataset.tooltipAttached = true
        el.classList.add("aitji-tooltip-trigger")
        el.addEventListener("mouseenter", () => showTooltip(el))
        el.addEventListener("mouseleave", () => hideTooltip())
        el.addEventListener("focus", () => showTooltip(el, 0))
        el.addEventListener("blur", () => hideTooltip(true))

        el.addEventListener("touchstart", (e) => {
            clearTimeout(touchTimer)
            touchTimer = setTimeout(() => {
                showTooltip(el, 0)
                setTimeout(() => hideTooltip(true), 2000)
            }, 150)
        }, { passive: true })

        el.addEventListener("touchend", () => { clearTimeout(touchTimer) }, { passive: true })
        el.addEventListener("touchmove", () => { clearTimeout(touchTimer) }, { passive: true })
    }

    tooltip.addEventListener("mouseenter", () => { isHoveringTooltip = true })
    tooltip.addEventListener("mouseleave", () => { isHoveringTooltip = false; hideTooltip(true) })

    const observer = new MutationObserver(muts => {
        muts.forEach(m => {
            m.addedNodes.forEach(n => {
                if (n.nodeType === 1) {
                    if (n.hasAttribute("title") || n.hasAttribute("data-tooltip")) attachTooltip(n)
                    n.querySelectorAll("[title],[data-tooltip]").forEach(attachTooltip)
                }
            })
        })
    })
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["title", "data-tooltip"] })
    document.querySelectorAll("[title],[data-tooltip]").forEach(attachTooltip)

    let scrollTimer = null
    window.addEventListener("scroll", () => {
        if (!currentEl) return
        clearTimeout(scrollTimer)
        const rect = currentEl.getBoundingClientRect()
        if (rect.bottom < -10 || rect.top > window.innerHeight + 10) hideTooltip(true)
        else updateTooltipPosition(currentEl)
        scrollTimer = setTimeout(() => { if (currentEl) updateTooltipPosition(currentEl) }, 50)
    }, { passive: true })

    window.addEventListener("resize", () => { if (currentEl) setTimeout(() => updateTooltipPosition(currentEl), 100) }, { passive: true })
    document.addEventListener("click", (e) => { if (currentEl && !currentEl.contains(e.target)) hideTooltip(true) }, { passive: true })
    window.aitjiTooltip = { show: (el) => showTooltip(el, 0), hide: (el) => hideTooltip(true), update: (el) => { if (currentEl === el) updateTooltipPosition(el) } }
})