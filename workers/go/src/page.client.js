(() => {
	'use strict'
	const M = JSON.parse(document.getElementById('m').textContent)
	const app = document.getElementById('app')
	const files = (M.files || []).map((f, i) => ({ i, k: f?.i ?? i, name: String(f?.name || 'file-' + (i + 1)), size: +f?.size || 0, id: f?.id, type: String(f?.type || '') }))
	const sel = new Set(files.map(f => f.i))

	// helpers
	const fmt = b => { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++ } return (b >= 100 || !i ? Math.round(b) : b.toFixed(1)) + ' ' + u[i] }
	const h = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e }
	const fa = (name, cls) => { const i = document.createElement('i'); i.className = 'fa-solid fa-' + name + (cls ? ' ' + cls : ''); i.setAttribute('aria-hidden', 'true'); return i }
	const sep = () => fa('circle', 'sep')
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
	const life = M.drive ? 'ไม่หมดอายุ|เก็บใน Google Drive ของผู้ส่ง' : (M.exp > 0 ? 'หมดอายุใน ' + days + ' วัน' : 'ไม่ทราบวันหมดอายุ')
	const hd = h('div', 'hd')
	const sub = h('p');[('ขนาดรวม ' + fmt(M.total || 0)), ...life.split('|')].forEach((t, i) => { if (i) sub.append(sep()); sub.append(t) })
	hd.append(h('h1', 0, files.length + ' ไฟล์ พร้อมดาวน์โหลด'), sub)
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
		if (f.kind === 'video') { const pl = h('span', 'play'); pl.append(fa('play')); th.append(pl) }
		th.onclick = () => open(f.i)

		const sl = h('label', 'sel'), cb = h('input'); cb.type = 'checkbox'; cb.checked = true
		cb.setAttribute('aria-label', 'เลือก ' + f.name)
		cb.onchange = () => { cb.checked ? sel.add(f.i) : sel.delete(f.i); upd() }
		cbs.push(cb); sl.append(cb)

		const nm = h('div', 'nm'), b = h('b', 0, f.name); b.title = f.name
		nm.append(b, h('small', 0, fmt(f.size)))
		const a = h('a', 'btn ic'); a.append(fa('arrow-down-to-line')); a.href = dlUrl(f); a.title = 'ดาวน์โหลด ' + f.name; a.setAttribute('aria-label', a.title)
		if (M.drive) { a.target = '_blank'; a.rel = 'noopener' } else a.setAttribute('download', '')
		const meta = h('div', 'meta'); meta.append(nm, a)
		li.append(th, sl, meta)
		grid.append(li)
	})
	app.append(grid)

	const ZIP_MEM = 256 * 1024 * 1024
	const ZIP_MAX = 0xF0000000
	const canDisk = typeof showSaveFilePicker === 'function'
	let busy = false, queue = null, qi = 0, qkey = '', blobUrl = ''

	const note = h('p', 'note'); note.hidden = true; note.setAttribute('role', 'status')
	bar.after(note)
	const say = (...x) => { note.replaceChildren(...x); note.hidden = !x.length }

	const picked = () => [...sel].sort((a, b) => a - b).map(i => files[i])
	const sum = l => l.reduce((s, f) => s + f.size, 0)
	const skey = () => picked().map(f => f.i).join()
	const zipUrl = f => M.drive ? '/api/gd/' + M.id + '/' + f.k : dlUrl(f)
	const zippable = l => l.length > 1 && (!M.drive || l.every(f => f.size > 0)) && sum(l) < ZIP_MAX && (sum(l) <= ZIP_MEM || canDisk)

	const upd = () => {
		const l = picked(), s = sum(l)
		if (queue && qkey !== skey()) queue = null
		all.checked = sel.size === files.length
		cnt.textContent = 'เลือก ' + sel.size + ' / ' + files.length + ' ไฟล์'
		dlAll.disabled = busy || !sel.size
		if (busy) return
		dlAll.textContent = queue
			? 'ดาวน์โหลดไฟล์ถัดไป (' + (qi + 1) + '/' + queue.length + ')'
			: 'ดาวน์โหลด ' + sel.size + ' ไฟล์ (' + fmt(s) + ')' + (zippable(l) ? ' เป็น ZIP' : '')
	}
	all.onchange = () => { sel.clear(); cbs.forEach((c, i) => { c.checked = all.checked; if (all.checked) sel.add(i) }); upd() }

	const grab = f => {
		const a = h('a'); a.href = dlUrl(f)
		if (M.drive) { a.target = '_blank'; a.rel = 'noopener' } else a.download = ''
		document.body.append(a); a.click(); a.remove()
	}
	const step = () => {
		grab(queue[qi++])
		if (qi >= queue.length) { queue = null; say('สั่งดาวน์โหลดครบทุกไฟล์แล้ว') }
		upd()
	}

	const CRC = new Uint32Array(256).map((_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xEDB88320 ^ (n >>> 1) : n >>> 1; return n })
	const crc32 = (c, b) => { for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return c }
	const zipName = (n, used) => {
		n = String(n).replace(/[\u0000-\u001f\u007f\\/:*?"<>|]+/g, '_').replace(/^\.+$/, '_').trim() || 'file'
		const dot = n.lastIndexOf('.'), stem = dot > 0 ? n.slice(0, dot) : n, ext = dot > 0 ? n.slice(dot) : ''
		let o = n, k = 1
		while (used.has(o.toLowerCase())) o = stem + ' (' + ++k + ')' + ext
		used.add(o.toLowerCase())
		return o
	}
	async function* zipStream(list, onBytes) {
		const te = new TextEncoder(), d = new Date(), used = new Set(), cd = []
		const tm = d.getHours() << 11 | d.getMinutes() << 5 | d.getSeconds() >> 1
		const dt = (d.getFullYear() - 1980) << 9 | (d.getMonth() + 1) << 5 | d.getDate()
		let off = 0
		for (const f of list) {
			const nm = te.encode(zipName(f.name, used))
			const res = await fetch(zipUrl(f))
			if (!res.ok || !res.body) throw Object.assign(new Error('bad'), { bad: f.name })

			const lh = new Uint8Array(30 + nm.length), v = new DataView(lh.buffer)
			v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true)
			v.setUint16(10, tm, true); v.setUint16(12, dt, true); v.setUint16(26, nm.length, true)
			lh.set(nm, 30)
			const start = off; off += lh.length
			yield lh

			let crc = -1, size = 0
			const rd = res.body.getReader()
			for (; ;) {
				const { done, value } = await rd.read()
				if (done) break
				crc = crc32(crc, value); size += value.length; off += value.length; onBytes(value.length)
				yield value
			}
			crc = (crc ^ -1) >>> 0

			const bytes = new Uint8Array(12), w = new DataView(bytes.buffer)
			w.setUint32(0, crc, true); w.setUint32(4, size, true); w.setUint32(8, size, true)
			yield { hdr: lh, pos: start, bytes }
			cd.push({ nm, crc, size, start })
		}
		const cdStart = off
		for (const e of cd) {
			const b = new Uint8Array(46 + e.nm.length), v = new DataView(b.buffer)
			v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true); v.setUint16(8, 0x0800, true)
			v.setUint16(12, tm, true); v.setUint16(14, dt, true)
			v.setUint32(16, e.crc, true); v.setUint32(20, e.size, true); v.setUint32(24, e.size, true)
			v.setUint16(28, e.nm.length, true); v.setUint32(42, e.start, true)
			b.set(e.nm, 46); off += b.length
			yield b
		}
		const end = new Uint8Array(22), ev = new DataView(end.buffer)
		ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, cd.length, true); ev.setUint16(10, cd.length, true)
		ev.setUint32(12, off - cdStart, true); ev.setUint32(16, cdStart, true)
		yield end
	}

	const zip = async list => {
		busy = true; queue = null; say(); upd()
		const total = sum(list), zname = 'thatako-' + M.id + '.zip'
		let done = 0, t = 0
		const tick = n => {
			done += n
			const now = performance.now()
			if (now - t > 150) { t = now; dlAll.textContent = 'กำลังรวมไฟล์ ' + Math.min(99, Math.floor(done * 100 / (total || 1))) + '%' }
		}
		try {
			if (total > ZIP_MEM) {
				const fh = await showSaveFilePicker({ suggestedName: zname, types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }] })
				const w = await fh.createWritable()
				try {
					let pos = 0
					for await (const c of zipStream(list, tick)) {
						if (c.hdr) { await w.write({ type: 'seek', position: c.pos + 14 }); await w.write(c.bytes); await w.write({ type: 'seek', position: pos }) }
						else { await w.write(c); pos += c.length }
					}
					await w.close()
				} catch (e) { await w.abort().catch(() => { }); throw e }
				say('บันทึกไฟล์ ZIP เรียบร้อยแล้ว')
			} else {
				const parts = []
				for await (const c of zipStream(list, tick)) c.hdr ? c.hdr.set(c.bytes, 14) : parts.push(c)
				if (blobUrl) URL.revokeObjectURL(blobUrl)
				blobUrl = URL.createObjectURL(new Blob(parts, { type: 'application/zip' }))
				parts.length = 0
				const a = h('a'); a.href = blobUrl; a.download = zname
				document.body.append(a); a.click(); a.remove()
				const again = h('a', 0, 'กดที่นี่'); again.href = blobUrl; again.download = zname
				say('สร้างไฟล์ ZIP แล้ว หากไม่เริ่มดาวน์โหลดเอง ', again)
			}
		} catch (e) {
			if (e?.name === 'AbortError') say()
			else if (M.drive) {
				queue = list; qi = 0; qkey = skey()
				say('รวมเป็น ZIP ไม่สำเร็จ (Google อาจจำกัดการดาวน์โหลดไฟล์นี้) กดปุ่มเพื่อโหลดทีละไฟล์แทน')
			}
			else say(e?.bad ? 'ดาวน์โหลด "' + e.bad + '" ไม่ได้ (ไฟล์อาจหมดอายุหรือถูกลบ)' : 'ดาวน์โหลดไม่สำเร็จ ลองใหม่อีกครั้ง')
		}
		busy = false; upd()
	}

	dlAll.onclick = () => {
		if (busy) return
		if (queue) return step()
		const l = picked()
		if (!l.length) return
		if (l.length === 1) return grab(l[0])
		if (zippable(l)) return zip(l)
		queue = l; qi = 0; qkey = skey()
		say(M.drive
			? 'เบราว์เซอร์ไม่ให้เปิดหลายไฟล์พร้อมกัน กดปุ่มซ้ำเพื่อโหลดไฟล์ถัดไปทีละไฟล์'
			: 'ไฟล์รวมใหญ่เกินกว่าจะรวมเป็น ZIP บนเบราว์เซอร์นี้ กดปุ่มซ้ำเพื่อโหลดไฟล์ถัดไปทีละไฟล์')
		step()
	}
	upd()

	// lightbox
	const Z_MIN = 0.5, Z_MAX = 4, Z_STEP = 0.25
	let lb, stage, ttl, num, dlA, closeB, prevB, nextB, zBar, zOut, zIn, zReset, zLbl
	let cur = -1, token = 0, pushed = false, lastFocus = null
	let sc = 1, tx = 0, ty = 0, imgEl = null
	let pan = null, pinch = null, down = null, moved = false, pinched = false, lastTap = null
	const ptrs = new Map()

	const isOn = () => !!lb && lb.classList.contains('on')
	const lim = (v, a, b) => Math.min(Math.max(v, a), b)
	const stopMedia = () => stage && stage.querySelectorAll('video,audio').forEach(m => { m.pause(); m.removeAttribute('src'); m.load() })
	const zoomable = () => !!imgEl && !imgEl.classList.contains('lo')

	const fit = () => {
		if (!imgEl) return
		const mx = Math.max((imgEl.offsetWidth * sc - stage.clientWidth) / 2, 0)
		const my = Math.max((imgEl.offsetHeight * sc - stage.clientHeight) / 2, 0)
		tx = lim(tx, -mx, mx); ty = lim(ty, -my, my)
	}

	const paint = anim => {
		if (!imgEl) return
		imgEl.style.transition = anim ? 'transform .18s ease-out' : 'none'
		imgEl.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0) scale(' + sc + ')'
		const ok = zoomable()
		stage.classList.toggle('pan', ok && sc > 1.001)
		zLbl.textContent = ok ? Math.round(sc * 100) + '%' : '…'
		zOut.disabled = !ok || sc <= Z_MIN + 1e-3
		zIn.disabled = !ok || sc >= Z_MAX - 1e-3
		zReset.disabled = !ok || (Math.abs(sc - 1) < 1e-3 && !tx && !ty)
	}

	const zoomAt = (next, px, py, anim) => {
		if (!zoomable()) return
		next = lim(next, Z_MIN, Z_MAX)
		const r = stage.getBoundingClientRect()
		const rx = (px ?? r.left + r.width / 2) - (r.left + r.width / 2)
		const ry = (py ?? r.top + r.height / 2) - (r.top + r.height / 2)
		const k = next / sc
		tx = rx - (rx - tx) * k; ty = ry - (ry - ty) * k
		sc = next
		fit(); paint(anim)
	}
	const zoomIn = () => zoomAt((Math.floor(sc / Z_STEP + 1e-6) + 1) * Z_STEP, undefined, undefined, true)
	const zoomOut = () => zoomAt((Math.ceil(sc / Z_STEP - 1e-6) - 1) * Z_STEP, undefined, undefined, true)
	const zoomReset = () => { if (!zoomable()) return; sc = 1; tx = ty = 0; paint(true) }

	const clear = () => {
		stopMedia(); stage.replaceChildren(); stage.classList.remove('pan', 'drag', 'is-img')
		imgEl = null; ptrs.clear(); pan = pinch = down = lastTap = null
		sc = 1; tx = ty = 0; zBar.hidden = true
	}

	const none = (f, msg) => {
		clear()
		const m = h('div', 'lb-msg')
		const a = h('a', 'lb-btn'); a.append(fa('arrow-down-to-line'), ' ดาวน์โหลด'); a.href = dlUrl(f)
		if (M.drive) { a.target = '_blank'; a.rel = 'noopener' } else a.setAttribute('download', '')
		m.append(h('div', 'ext', (extOf(f.name) || 'file').slice(0, 4)), h('p', 0, msg || 'ไม่มีตัวอย่างสำหรับไฟล์นี้'), a)
		stage.append(m)
	}

	const showImage = (f, my) => {
		const img = h('img', 'main'); img.alt = f.name; img.draggable = false
		const sp = h('div', 'sp'); sp.hidden = true
		const t = setTimeout(() => sp.hidden = false, 200)
		stage.append(img, sp)
		imgEl = img; zBar.hidden = false; stage.classList.add('is-img')
		if (M.drive && f.thumb && files.length === 1) { img.src = f.thumb; img.classList.add('lo') }
		paint()
		const big = new Image(); big.decoding = 'async'; big.referrerPolicy = 'no-referrer'
		load(big, M.drive ? pic(f, fullW()) : [rawUrl(f)], () => {
			if (my !== token) return
			clearTimeout(t); sp.remove()
			img.src = big.currentSrc || big.src; img.classList.remove('lo')
			paint()
			preload(cur + 1); preload(cur - 1)
		}, () => { if (my === token) { clearTimeout(t); none(f, 'โหลดตัวอย่างไม่สำเร็จ') } })
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
		const note = h('div', 'ext'); note.append(fa('music')); m.append(note, h('p', 0, f.name), a)
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

	const go = d => { if (files.length > 1) open((cur + d + files.length) % files.length) }

	const rbtn = (icon, label, cls) => {
		const b = h('button', 'lb-round' + (cls ? ' ' + cls : '')); b.type = 'button'
		b.append(fa(icon)); b.title = label; b.setAttribute('aria-label', label)
		return b
	}

	const inImg = (x, y) => { const r = imgEl.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom }
	const pinchStart = () => {
		const [a, b] = [...ptrs.values()]
		pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, sc, tx, ty, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }
		pan = null
	}
	const gestureStart = () => {
		if (ptrs.size >= 2) { pinched = true; moved = true; pinchStart() }
		else { const p = [...ptrs.values()][0]; pan = { x: p.x, y: p.y, tx, ty }; pinch = null }
	}

	const build = () => {
		if (lb) return
		lb = h('div', 'lb'); lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true'); lb.setAttribute('aria-label', 'ตัวอย่างไฟล์')
		stage = h('div', 'lb-stage')

		const top = h('div', 'lb-top')
		ttl = h('div', 't'); num = h('div', 'n')
		const ctl = h('div', 'lb-ctl')
		dlA = h('a', 'lb-round'); dlA.append(fa('arrow-down-to-line')); dlA.title = 'ดาวน์โหลด (Ctrl+S)'; dlA.setAttribute('aria-label', 'ดาวน์โหลด')
		closeB = rbtn('xmark', 'ปิด (Esc)'); closeB.onclick = close
		ctl.append(dlA, closeB)
		top.append(ttl, num, ctl)

		prevB = h('button', 'lb-nav l'); prevB.append(fa('chevron-left')); prevB.type = 'button'; prevB.setAttribute('aria-label', 'ก่อนหน้า'); prevB.onclick = () => go(-1)
		nextB = h('button', 'lb-nav r'); nextB.append(fa('chevron-right')); nextB.type = 'button'; nextB.setAttribute('aria-label', 'ถัดไป'); nextB.onclick = () => go(1)

		zBar = h('div', 'lb-zoom'); zBar.hidden = true; zBar.setAttribute('role', 'group'); zBar.setAttribute('aria-label', 'ซูมรูปภาพ')
		zOut = rbtn('magnifying-glass-minus', 'ซูมออก (-)'); zOut.onclick = zoomOut
		zLbl = h('span', 'z', '100%'); zLbl.setAttribute('aria-live', 'polite')
		zIn = rbtn('magnifying-glass-plus', 'ซูมเข้า (+)'); zIn.onclick = zoomIn
		zReset = rbtn('rotate-left', 'รีเซ็ตการซูม (0)'); zReset.onclick = zoomReset
		zBar.append(zOut, zLbl, zIn, zReset)

		lb.append(stage, top, prevB, nextB, zBar)
		document.body.append(lb)

		stage.addEventListener('pointerdown', e => {
			if (!imgEl || (e.pointerType === 'mouse' && e.button)) return
			if (!ptrs.size) { down = { x: e.clientX, y: e.clientY }; moved = pinched = false }
			ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY })
			try { stage.setPointerCapture(e.pointerId) } catch { }
			gestureStart()
		})
		stage.addEventListener('pointermove', e => {
			const p = ptrs.get(e.pointerId)
			if (!p) return
			p.x = e.clientX; p.y = e.clientY
			if (pinch && ptrs.size >= 2) {
				const [a, b] = [...ptrs.values()]
				const r = stage.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2
				const next = lim(pinch.sc * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), Z_MIN, Z_MAX), k = next / pinch.sc
				tx = ((a.x + b.x) / 2 - cx) - (pinch.mx - cx - pinch.tx) * k
				ty = ((a.y + b.y) / 2 - cy) - (pinch.my - cy - pinch.ty) * k
				sc = next
				if (zoomable()) { fit(); paint() }
			} else if (pan && ptrs.size === 1) {
				const dx = e.clientX - pan.x, dy = e.clientY - pan.y
				if (Math.abs(dx) + Math.abs(dy) > 4) moved = true
				if (zoomable() && sc > 1.001) { tx = pan.tx + dx; ty = pan.ty + dy; fit(); paint(); stage.classList.add('drag') }
			}
		})
		const release = e => {
			if (!ptrs.delete(e.pointerId)) return
			stage.classList.remove('drag')
			if (ptrs.size) return gestureStart()
			pan = pinch = null
			if (e.type !== 'pointerup' || !imgEl) return
			const dx = e.clientX - down.x, dy = e.clientY - down.y
			if (e.pointerType === 'touch' && !pinched && sc <= 1.001 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) return go(dx < 0 ? 1 : -1)
			if (moved) return
			if (!inImg(e.clientX, e.clientY)) return close()
			const now = Date.now()
			if (lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
				lastTap = null
				if (Math.abs(sc - 1) > 1e-3) zoomReset(); else zoomAt(2, e.clientX, e.clientY, true)
			} else lastTap = { t: now, x: e.clientX, y: e.clientY }
		}
		stage.addEventListener('pointerup', release); stage.addEventListener('pointercancel', release)
		stage.addEventListener('click', e => { if (e.target === stage && !imgEl) close() })

		stage.addEventListener('wheel', e => {
			if (!zoomable() || e.target.closest('pre,video,audio')) return
			e.preventDefault()
			const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
			zoomAt(sc * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY)
		}, { passive: false })

		addEventListener('resize', () => { if (isOn()) { fit(); paint() } })

		let sw = null
		stage.addEventListener('touchstart', e => {
			sw = !imgEl && e.touches.length === 1 && !e.target.closest('video,audio,pre') ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null
		}, { passive: true })
		stage.addEventListener('touchend', e => {
			if (!sw) return
			const t = e.changedTouches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y
			sw = null
			if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1)
		}, { passive: true })

		document.addEventListener('keydown', e => {
			if (!isOn()) return
			const inMedia = /^(VIDEO|AUDIO)$/.test(e.target.tagName)
			const plain = !e.ctrlKey && !e.metaKey && !e.altKey
			if (e.key === 'Escape') { e.preventDefault(); close() }
			else if (e.key === 'ArrowLeft' && !inMedia) { e.preventDefault(); go(-1) }
			else if (e.key === 'ArrowRight' && !inMedia) { e.preventDefault(); go(1) }
			else if (plain && (e.key === '+' || e.key === '=')) { e.preventDefault(); zoomIn() }
			else if (plain && (e.key === '-' || e.key === '_')) { e.preventDefault(); zoomOut() }
			else if (plain && e.key === '0') { e.preventDefault(); zoomReset() }
			else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); dlA.click() }
			else if (e.key === 'Tab') {
				const els = [...lb.querySelectorAll('a[href],button:not([hidden]):not(:disabled),video,audio,pre')].filter(x => !x.hidden && x.offsetParent !== null)
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
