const SPACER = '<tr class="vs-spacer" aria-hidden="true"><td colspan="{c}"></td></tr>'

export const createVirtualRows = ({ tbody, render, key, colspan = 3, estimate = 80, overscan = 600, threshold = 40 }) => {
    let items = []
    let est = estimate
    let heights = new Map()
    let offsets = [0]
    let nodes = new Map()
    let from = 0, to = 0
    let raf = 0
    let top = null, bottom = null

    const makeSpacer = () => {
        const t = document.createElement("template")
        t.innerHTML = SPACER.replace("{c}", colspan)
        return t.content.firstElementChild
    }

    const calc = () => {
        offsets = new Array(items.length + 1)
        offsets[0] = 0
        for (let i = 0; i < items.length; i++) offsets[i + 1] = offsets[i] + (heights.get(key(items[i])) ?? est)
    }

    const indexAt = y => {
        let lo = 0, hi = items.length
        while (lo < hi) {
            const mid = (lo + hi) >> 1
            offsets[mid + 1] > y ? hi = mid : lo = mid + 1
        }
        return lo
    }

    const range = () => {
        if (items.length <= threshold) return [0, items.length]
        const rel = tbody.getBoundingClientRect().top
        const s = indexAt(-rel - overscan)
        const e = Math.min(items.length, indexAt(-rel + window.innerHeight + overscan) + 1)
        return [Math.min(s, e), e]
    }

    const setSpacer = (which, px) => {
        let el = which === "top" ? top : bottom
        if (px < 1) { el?.remove(); if (which === "top") top = null; else bottom = null; return }
        if (!el) {
            el = makeSpacer()
            if (which === "top") { top = el; tbody.prepend(el) } else { bottom = el; tbody.append(el) }
        }
        el.firstElementChild.style.height = px + "px"
    }

    const make = (a, b) => {
        const t = document.createElement("template")
        t.innerHTML = items.slice(a, b).map(render).join("")
        return [...t.content.children]
    }

    const measure = (a, b) => {
        let changed = false
        const sample = []
        for (let i = a; i < b; i++) {
            const n = nodes.get(i)
            if (!n) continue
            const next = nodes.get(i + 1)
            const r = n.getBoundingClientRect()
            const h = Math.round((next ? next.getBoundingClientRect().top : r.bottom) - r.top)
            if (h <= 0) continue
            const k = key(items[i])
            if (heights.get(k) !== h) { heights.set(k, h); changed = true }
            sample.push(h)
        }
        if (sample.length > 3) est = Math.round(sample.reduce((x, y) => x + y, 0) / sample.length)
        return changed
    }

    const sync = (force = false) => {
        const [s, e] = range()
        if (!force && s === from && e === to) return

        const rel0 = tbody.getBoundingClientRect().top
        const anchor = Math.min(items.length - 1, indexAt(-rel0))
        const anchorY = rel0 + (offsets[anchor] ?? 0)

        if (force) {
            nodes.clear()
            top = bottom = null
            from = to = 0
            for (const c of [...tbody.children]) c.remove()
        } else for (const [i, n] of nodes) if (i < s || i >= e) { n.remove(); nodes.delete(i) }

        const have = [...nodes.keys()]
        const lo = have.length ? Math.min(...have) : s
        const hi = have.length ? Math.max(...have) + 1 : s
        const before = make(s, Math.min(lo, e))
        const after = make(Math.max(hi, s), e)
        if (before.length) {
            const ref = nodes.get(lo) || bottom
            before.forEach((n, k) => { nodes.set(s + k, n); tbody.insertBefore(n, ref) })
        }
        if (after.length) {
            const start = Math.max(hi, s)
            after.forEach((n, k) => { nodes.set(start + k, n); tbody.insertBefore(n, bottom) })
        }
        from = s
        to = e

        const hadCache = heights.size
        setSpacer("top", offsets[s])
        setSpacer("bottom", offsets[items.length] - offsets[e])
        const changed = measure(s, e)
        if (changed || !hadCache) {
            calc()
            setSpacer("top", offsets[s])
            setSpacer("bottom", offsets[items.length] - offsets[e])
        }

        if (changed && items.length > threshold) {
            const delta = tbody.getBoundingClientRect().top + (offsets[anchor] ?? 0) - anchorY
            if (Math.abs(delta) > 1) window.scrollBy(0, delta)
        }
    }

    const tick = () => { raf = 0; sync() }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(tick) }
    window.addEventListener("scroll", schedule, { passive: true })
    window.addEventListener("resize", schedule, { passive: true })

    let width = 0
    const ro = new ResizeObserver(([e]) => {
        const w = Math.round(e.contentRect.width)
        if (width && w !== width) { heights.clear(); est = estimate; calc(); sync(true) }
        width = w
    })
    ro.observe(tbody.closest(".links-wrap") || tbody.parentElement)

    return {
        setItems(list) {
            items = list
            calc()
            sync(true)
        },
        refresh() { calc(); sync(true) },
        setHtml(html) {
            items = []
            offsets = [0]
            nodes.clear()
            top = bottom = null
            from = to = 0
            tbody.innerHTML = html
        },
        destroy() {
            window.removeEventListener("scroll", schedule)
            window.removeEventListener("resize", schedule)
            ro.disconnect()
        }
    }
}
