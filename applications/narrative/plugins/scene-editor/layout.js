const KEY = 'narrative:editor-layout:v1'
const defaults = { left: 210, right: 290, bottom: 180, orientation: 'landscape', resourceSize: 114 }
const clamp = (value, min, max) => Math.min(Math.max(min, max), Math.max(min, value))
export function preferences(storage) {
  let saved
  try { saved = JSON.parse(storage?.getItem(KEY) || '{}') } catch {}
  const value = { ...defaults }
  for (const key of ['left', 'right', 'bottom', 'resourceSize']) if (Number.isFinite(saved?.[key])) value[key] = clamp(saved[key], key === 'resourceSize' ? 80 : 96, key === 'resourceSize' ? 240 : 1200)
  if (saved?.orientation === 'portrait') value.orientation = 'portrait'
  return { value, save() { try { storage?.setItem(KEY, JSON.stringify(value)) } catch {} } }
}
export function fittedScreen(width, height, orientation) {
  const [w, h] = orientation === 'portrait' ? [540, 960] : [1280, 720]
  return { width: w, height: h, scale: Math.max(0, Math.min(1, (width - 24) / w, (height - 24) / h)) }
}

export function mountLayout({ root, grid, viewport, canvas, size, prefs, refresh }) {
  let disposed = false, gesture
  const handles = [], cleanups = []
  const on = (node, name, fn, options) => { node.addEventListener(name, fn, options); cleanups.push(() => node.removeEventListener(name, fn, options)) }
  const frame = document.createElement('div'); frame.className = 'scene-screen-frame'; canvas.before(frame); frame.append(canvas)
  const badge = document.createElement('span'); badge.className = 'scene-screen-scale'; viewport.append(badge)
  function fit() {
    if (disposed) return
    const screen = fittedScreen(viewport.clientWidth, viewport.clientHeight, prefs.value.orientation)
    canvas.style.width = screen.width + 'px'; canvas.style.height = screen.height + 'px'
    canvas.dataset.previewScale = String(screen.scale || 1)
    canvas.style.transform = `scale(${screen.scale})`
    frame.style.width = screen.width * screen.scale + 'px'; frame.style.height = screen.height * screen.scale + 'px'
    badge.textContent = `${screen.width} × ${screen.height} · ${Math.round(screen.scale * 100)}%`
  }
  function bounds(key) {
    if (key === 'bottom') return [96, Math.max(96, grid.clientHeight - 146)]
    const other = key === 'left' ? 'right' : 'left', minimum = key === 'left' ? 140 : 180
    return [minimum, Math.max(minimum, grid.clientWidth - 252 - (Number.parseFloat(grid.style.getPropertyValue('--scene-' + other)) || prefs.value[other]))]
  }
  function layout() {
    if (disposed) return
    // Clamp displayed widths without discarding the user's desktop preference.
    const available = Math.max(320, grid.clientWidth - 252)
    const left = clamp(prefs.value.left, 140, available - 180), right = clamp(prefs.value.right, 180, available - left)
    for (const [key, value] of Object.entries({ left, right, bottom: clamp(prefs.value.bottom, 96, grid.clientHeight - 146) })) {
      grid.style.setProperty('--scene-' + key, value + 'px')
      const handle = handles.find(h => h.dataset.split === key)
      if (handle) { const [min, max] = bounds(key); handle.setAttribute('aria-valuenow', String(Math.round(value))); handle.setAttribute('aria-valuemin', String(min)); handle.setAttribute('aria-valuemax', String(max)) }
    }
    fit()
  }
  function finish(cancel = false) {
    if (!gesture) return
    const g = gesture; gesture = null
    if (cancel) prefs.value[g.key] = g.before
    if (g.handle.hasPointerCapture?.(g.id)) g.handle.releasePointerCapture(g.id)
    root.classList.remove('is-resizing'); layout(); if (!cancel) prefs.save()
  }
  for (const [key, label] of [['left', '调整层级栏宽度'], ['right', '调整属性栏宽度'], ['bottom', '调整资源库高度']]) {
    const handle = document.createElement('div'); handle.className = 'scene-splitter scene-splitter-' + key; handle.dataset.split = key
    handle.tabIndex = 0; handle.setAttribute('role', 'separator'); handle.setAttribute('aria-label', label); handle.setAttribute('aria-orientation', key === 'bottom' ? 'horizontal' : 'vertical'); handle.title = label + '；双击恢复默认，方向键微调'
    handles.push(handle); grid.append(handle)
    on(handle, 'pointerdown', e => {
      if (e.button !== 0 || gesture) return
      e.preventDefault(); gesture = { key, handle, id: e.pointerId, x: e.clientX, y: e.clientY, before: prefs.value[key], start: Number.parseFloat(grid.style.getPropertyValue('--scene-' + key)) }
      handle.setPointerCapture?.(e.pointerId); root.classList.add('is-resizing')
    })
    on(handle, 'pointermove', e => {
      const g = gesture; if (!g || g.id !== e.pointerId) return
      const delta = key === 'bottom' ? g.y - e.clientY : key === 'right' ? g.x - e.clientX : e.clientX - g.x
      prefs.value[key] = clamp(g.start + delta, ...bounds(key)); layout()
    })
    on(handle, 'pointerup', () => finish()); on(handle, 'pointercancel', () => finish(true)); on(handle, 'lostpointercapture', () => finish(true))
    on(handle, 'dblclick', () => { prefs.value[key] = defaults[key]; prefs.save(); layout() })
    on(handle, 'keydown', e => {
      const directions = key === 'bottom' ? { ArrowUp: 1, ArrowDown: -1 } : key === 'left' ? { ArrowRight: 1, ArrowLeft: -1 } : { ArrowRight: -1, ArrowLeft: 1 }
      if (directions[e.key]) { e.preventDefault(); prefs.value[key] = clamp(Number.parseFloat(grid.style.getPropertyValue('--scene-' + key)) + directions[e.key] * (e.shiftKey ? 40 : 10), ...bounds(key)); prefs.save(); layout() }
    })
  }
  on(document, 'keydown', e => { if (e.key === 'Escape' && gesture) { e.preventDefault(); finish(true) } })
  size.value = prefs.value.orientation
  on(size, 'change', () => { prefs.value.orientation = size.value; prefs.save(); fit(); refresh() })
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(layout) : null
  observer?.observe(grid); observer?.observe(viewport); on(window, 'resize', layout); layout()
  return { dispose() { finish(true); disposed = true; observer?.disconnect(); cleanups.forEach(fn => fn()); handles.forEach(h => h.remove()); badge.remove() } }
}
