(() => {
	'use strict'
	const M = JSON.parse(document.getElementById('m').textContent)
	const app = document.getElementById('app')
	const files = (M.files || []).map((f, i) => ({ i, k: f?.i ?? i, name: String(f?.name || 'file-' + (i + 1)), size: +f?.size || 0, id: f?.id, type: String(f?.type || '') }))
	const sel = new Set(files.map(f => f.i))

	// helpers
	const fmt = b => { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++ } return (b >= 100 || !i ? Math.round(b) : b.toFixed(1)) + ' ' + u[i] }
	const h = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e }
	const extOf = n => { const p = n.split('.'); return p.length > 1 ? p.pop().toLowerCase() : '' }
	const enc = encodeURIComponent

	const kindOf = f => {
		if (M.drive) {
			if (/^image\//.test(f.type)) return 'image'
			if (/^video\//.test(f.type)) return 'video'
			if (/^audio\//.test(f.type)) return 'audio'
			return 'doc'
		}
		const e = extOf(f.name)
		for (const k in M.kinds) if (M.kinds[k].includes(e)) return k
		return ''
	}
	files.forEach(f => f.kind = kindOf(f))

	const R2_TILE_MAX = 6 * 1024 * 1024
	const dlUrl = f => M.drive ? 'https://drive.google.com/uc?export=download&id=' + enc(f.id) : '/api/dl/' + M.id + '/' + f.k
	const rawUrl = f => M.drive ? 'https://drive.usercontent.google.com/download?id=' + enc(f.id) + '&export=download&confirm=t' : '/api/dl/' + M.id + '/' + f.k + '?inline=1'
	const pic = (f, w, crop) => M.drive
		? ['https://lh3.googleusercontent.com/d/' + enc(f.id) + '=w' + w + (crop ? '-h' + w + '-c' : ''), 'https://drive.google.com/thumbnail?id=' + enc(f.id) + '&sz=w' + w]
		: f.kind === 'image' ? [rawUrl(f)] : []
	const tileSrcs = f => {
		if (f.kind === 'audio' || f.kind === 'text' || !f.kind) return []
		if (!M.drive && (f.kind !== 'image' || f.size > R2_TILE_MAX)) return []
		return pic(f, files.length === 1 ? 1000 : 400, files.length > 1)
	}
	const fullW = () => Math.min(2560, Math.ceil(Math.max(innerWidth, innerHeight) * Math.min(devicePixelRatio || 1, 2) / 320) * 320)

	// try url
	const load = (img, srcs, ok, fail) => {
		let k = 0
		const next = () => k >= srcs.length ? fail && fail() : (img.src = srcs[k++])
		img.onerror = next
		img.onload = () => ok && ok()
		next()
	}

	// header/toolbar
	const days = Math.max(1, Math.ceil((M.exp - Date.now()) / 864e5))
	const life = M.drive ? 'ไม่หมดอายุ · เก็บใน Google Drive ของผู้ส่ง' : (M.exp > 0 ? 'หมดอายุใน ' + days + ' วัน' : 'ไม่ทราบวันหมดอายุ')
	const hd = h('div', 'hd')
	hd.append(h('h1', 0, files.length + ' ไฟล์ พร้อมดาวน์โหลด'), h('p', 0, 'ขนาดรวม ' + fmt(M.total || 0) + ' · ' + life))
	app.append(hd)

	const bar = h('div', 'bar'), lab = h('label'), all = h('input'), cnt = h('span')
	all.type = 'checkbox'; all.checked = true
	lab.append(all, cnt)
	const cp = h('button', 'btn', 'คัดลอกลิงก์'); cp.type = 'button'
	cp.onclick = () => navigator.clipboard.writeText(location.origin + location.pathname).then(() => { cp.textContent = 'คัดลอกแล้ว' })
	const dlAll = h('button', 'btn pri'); dlAll.type = 'button'
	bar.append(lab, cp, dlAll)
	app.append(bar)

	// grid
	const grid = h('ul', 'grid' + (files.length === 1 ? ' one' : ''))
	const cbs = []
	files.forEach(f => {
		const li = h('li', 'tile')
		const th = h('button', 'thumb'); th.type = 'button'
		th.disabled = M.drive ? false : !f.kind
		th.setAttribute('aria-label', 'ดูตัวอย่าง ' + f.name)
		th.append(h('span', 'ext', (extOf(f.name) || 'file').slice(0, 4)))
		const srcs = tileSrcs(f)
		if (!srcs.length) th.classList.add('no')
		else {
			const im = h('img'); im.alt = ''; im.loading = 'lazy'; im.decoding = 'async'; im.referrerPolicy = 'no-referrer'
			load(im, srcs, () => { f.thumb = im.currentSrc || im.src; th.classList.add('has') }, () => { im.remove(); th.classList.add('no') })
			th.append(im)
		}
		if (f.kind === 'video') th.append(h('span', 'play', '▶'))
		th.onclick = () => open(f.i)

		const sl = h('label', 'sel'), cb = h('input'); cb.type = 'checkbox'; cb.checked = true
		cb.setAttribute('aria-label', 'เลือก ' + f.name)
		cb.onchange = () => { cb.checked ? sel.add(f.i) : sel.delete(f.i); upd() }
		cbs.push(cb); sl.append(cb)

		const nm = h('div', 'nm'), b = h('b', 0, f.name); b.title = f.name
		nm.append(b, h('small', 0, fmt(f.size)))
		const a = h('a', 'btn ic', '↓'); a.href = dlUrl(f); a.title = 'ดาวน์โหลด ' + f.name; a.setAttribute('aria-label', a.title)
		if (M.drive) { a.target = '_blank'; a.rel = 'noopener' } else a.setAttribute('download', '')
		const meta = h('div', 'meta'); meta.append(nm, a)
		li.append(th, sl, meta)
		grid.append(li)
	})
	app.append(grid)

	const upd = () => {
		let s = 0; sel.forEach(i => s += files[i].size)
		all.checked = sel.size === files.length
		cnt.textContent = 'เลือก ' + sel.size + ' / ' + files.length + ' ไฟล์'
		dlAll.disabled = !sel.size
		dlAll.textContent = 'ดาวน์โหลด ' + sel.size + ' ไฟล์ (' + fmt(s) + ')'
	}
	all.onchange = () => { sel.clear(); cbs.forEach((c, i) => { c.checked = all.checked; if (all.checked) sel.add(i) }); upd() }
	dlAll.onclick = async () => {
		dlAll.disabled = true
		for (const i of [...sel].sort((a, b) => a - b)) {
			const a = h('a'); a.href = dlUrl(files[i])
			if (M.drive) { a.target = '_blank'; a.rel = 'noopener' } else a.download = ''
			document.body.append(a); a.click(); a.remove()
			await new Promise(r => setTimeout(r, 800))
		}
		upd()
	}
	upd()

	// lightbox
	let lb, stage, ttl, num, dlA, closeB, prevB, nextB
	let cur = -1, token = 0, zoomed = false, pushed = false, lastFocus = null, drag = null

	const isOn = () => !!lb && lb.classList.contains('on')
	const stopMedia = () => stage && stage.querySelectorAll('video,audio').forEach(m => { m.pause(); m.removeAttribute('src'); m.load() })
	const clear = () => { stopMedia(); stage.replaceChildren(); stage.classList.remove('zoom'); zoomed = false; stage.scrollTo(0, 0) }

	const none = (f, msg) => {
		clear()
		const m = h('div', 'lb-msg')
		const a = h('a', 'lb-btn', '↓ ดาวน์โหลด'); a.href = dlUrl(f)
		if (M.drive) { a.target = '_blank'; a.rel = 'noopener' } else a.setAttribute('download', '')
		m.append(h('div', 'ext', (extOf(f.name) || 'file').slice(0, 4)), h('p', 0, msg || 'ไม่มีตัวอย่างสำหรับไฟล์นี้'), a)
		stage.append(m)
	}

	const showImage = (f, my) => {
		const img = h('img', 'main'); img.alt = f.name; img.draggable = false
		const sp = h('div', 'sp'); sp.hidden = true
		const t = setTimeout(() => sp.hidden = false, 200)
		stage.append(img, sp)
		if (M.drive && f.thumb) { img.src = f.thumb; img.classList.add('lo') }
		const big = new Image(); big.decoding = 'async'; big.referrerPolicy = 'no-referrer'
		load(big, M.drive ? pic(f, fullW()) : [rawUrl(f)], () => {
			if (my !== token) return
			clearTimeout(t); sp.remove()
			img.src = big.currentSrc || big.src; img.classList.remove('lo')
			preload(cur + 1); preload(cur - 1)
		}, () => { if (my === token) { clearTimeout(t); none(f, 'โหลดตัวอย่างไม่สำเร็จ') } })
		img.onclick = () => { if (!drag?.moved) zoom() }
		if (f.kind === 'doc') stage.append(h('div', 'lb-cap', 'แสดงตัวอย่างหน้าแรก'))
	}

	const mediaFail = (f, my, m) => { m.onerror = () => { if (my === token) none(f, 'เล่นไฟล์นี้ในหน้านี้ไม่ได้ (ไฟล์ใหญ่หรือรูปแบบไม่รองรับ) ลองดาวน์โหลดแทน') } }
	const showVideo = (f, my) => {
		const v = h('video'); v.controls = true; v.playsInline = true; v.preload = 'metadata'
		if (M.drive) v.poster = pic(f, fullW())[0]
		mediaFail(f, my, v)
		v.src = rawUrl(f)
		stage.append(v)
	}

	const showAudio = (f, my) => {
		const m = h('div', 'lb-msg'), a = h('audio'); a.controls = true; a.preload = 'metadata'
		mediaFail(f, my, a)
		a.src = rawUrl(f)
		m.append(h('div', 'ext', '♪'), h('p', 0, f.name), a)
		stage.append(m)
	}

	const showText = (f, my) => {
		const pre = h('pre', 0, 'กำลังโหลด...'); pre.tabIndex = 0
		stage.append(pre)
		fetch(rawUrl(f), { headers: { Range: 'bytes=0-65535' } })
			.then(r => r.ok ? r.text() : Promise.reject())
			.then(t => { if (my === token) { pre.textContent = t + (f.size > 65536 ? '\n\n… แสดง 64 KB แรก ดาวน์โหลดเพื่ออ่านทั้งหมด' : '') } })
			.catch(() => { if (my === token) none(f, 'โหลดตัวอย่างไม่สำเร็จ') })
	}

	const preload = i => {
		if (navigator.connection?.saveData) return
		const f = files[(i + files.length) % files.length]
		if (!f || f.kind !== 'image' || (!M.drive && f.size > R2_TILE_MAX)) return
		new Image().src = (M.drive ? pic(f, fullW()) : [rawUrl(f)])[0]
	}

	const show = i => {
		cur = i
		const f = files[i], my = ++token
		clear()
		ttl.textContent = f.name; ttl.title = f.name
		num.textContent = files.length > 1 ? (i + 1) + ' / ' + files.length : ''
		dlA.href = dlUrl(f)
		if (M.drive) { dlA.target = '_blank'; dlA.rel = 'noopener'; dlA.removeAttribute('download') } else { dlA.removeAttribute('target'); dlA.setAttribute('download', '') }
		prevB.hidden = nextB.hidden = files.length < 2
		const fn = { image: showImage, doc: showImage, video: showVideo, audio: showAudio, text: showText }[f.kind]
		fn ? fn(f, my) : none(f)
	}

	const zoom = on => {
		const img = stage.querySelector('img.main')
		if (!img || img.classList.contains('lo')) return
		zoomed = on ?? !zoomed
		stage.classList.toggle('zoom', zoomed)
		if (zoomed) requestAnimationFrame(() => {
			stage.scrollLeft = (stage.scrollWidth - stage.clientWidth) / 2
			stage.scrollTop = (stage.scrollHeight - stage.clientHeight) / 2
		})
	}

	const go = d => { if (files.length > 1) open((cur + d + files.length) % files.length) }

	const build = () => {
		if (lb) return
		lb = h('div', 'lb'); lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true'); lb.setAttribute('aria-label', 'ตัวอย่างไฟล์')
		const top = h('div', 'lb-top')
		ttl = h('div', 't'); num = h('div', 'n')
		dlA = h('a', 'lb-btn'); dlA.append('↓', Object.assign(h('span', 'dlt'), { textContent: ' ดาวน์โหลด' }))
		closeB = h('button', 'lb-btn', '✕'); closeB.type = 'button'; closeB.setAttribute('aria-label', 'ปิด'); closeB.onclick = close
		top.append(ttl, num, dlA, closeB)
		stage = h('div', 'lb-stage')
		prevB = h('button', 'lb-nav l', '‹'); prevB.type = 'button'; prevB.setAttribute('aria-label', 'ก่อนหน้า'); prevB.onclick = () => go(-1)
		nextB = h('button', 'lb-nav r', '›'); nextB.type = 'button'; nextB.setAttribute('aria-label', 'ถัดไป'); nextB.onclick = () => go(1)
		lb.append(top, stage, prevB, nextB)
		document.body.append(lb)

		// mouse drag-to-pan while zoomed
		stage.addEventListener('pointerdown', e => {
			if (!zoomed || e.pointerType !== 'mouse' || e.button) return
			drag = { x: e.clientX, y: e.clientY, l: stage.scrollLeft, t: stage.scrollTop, moved: false }
			stage.setPointerCapture(e.pointerId)
		})
		stage.addEventListener('pointermove', e => {
			if (!drag) return
			const dx = e.clientX - drag.x, dy = e.clientY - drag.y
			if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true
			stage.scrollLeft = drag.l - dx; stage.scrollTop = drag.t - dy
		})
		const endDrag = () => { if (drag) setTimeout(() => drag = null) }
		stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag)

		// swipe to change file (not while zoomed, not on media controls / scrolling text)
		let tx = null
		stage.addEventListener('touchstart', e => {
			tx = !zoomed && e.touches.length === 1 && !e.target.closest('video,audio,pre') ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null
		}, { passive: true })
		stage.addEventListener('touchend', e => {
			if (!tx) return
			const t = e.changedTouches[0], dx = t.clientX - tx.x, dy = t.clientY - tx.y
			tx = null
			if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1)
		}, { passive: true })

		document.addEventListener('keydown', e => {
			if (!isOn()) return
			const inMedia = /^(VIDEO|AUDIO)$/.test(e.target.tagName)
			if (e.key === 'Escape') { e.preventDefault(); close() }
			else if (e.key === 'ArrowLeft' && !inMedia) { e.preventDefault(); go(-1) }
			else if (e.key === 'ArrowRight' && !inMedia) { e.preventDefault(); go(1) }
			else if (e.key === 'Tab') { // keep focus inside the dialog
				const els = [...lb.querySelectorAll('a[href],button:not([hidden]),video,audio,pre')].filter(x => !x.hidden && x.offsetParent !== null)
				if (!els.length) return
				const first = els[0], last = els[els.length - 1]
				if (!lb.contains(document.activeElement)) { e.preventDefault(); first.focus() }
				else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
				else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
			}
		})
	}

	function open(i, push = true) {
		build()
		if (!isOn()) {
			lastFocus = document.activeElement
			document.documentElement.style.overflow = 'hidden'
			document.querySelector('main').inert = true
			lb.classList.add('on')
			if (push) { history.pushState(1, '', '#' + (i + 1)); pushed = true }
		} else history.replaceState(history.state, '', '#' + (i + 1))
		show(i)
		closeB.focus({ preventScroll: true })
	}

	function hide() {
		if (!isOn()) return
		lb.classList.remove('on')
		clear()
		pushed = false
		document.documentElement.style.overflow = ''
		document.querySelector('main').inert = false
		if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true })
	}

	// Back button closes the preview instead of leaving the page
	function close() {
		if (pushed && history.state === 1) history.back()
		else { hide(); history.replaceState(null, '', location.pathname + location.search) }
	}

	const fromHash = () => { const m = /^#(\d+)$/.exec(location.hash); return m && files[m[1] - 1] ? m[1] - 1 : -1 }
	addEventListener('popstate', () => {
		const i = fromHash()
		if (i >= 0) { open(i, false); pushed = history.state === 1 } else hide()
	})
	if (fromHash() >= 0) open(fromHash(), false)
})()
