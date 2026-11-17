export function anchorAt(x, y, rect) {
  const rx = (x - rect.left) / Math.max(1, rect.width), ry = (y - rect.top) / Math.max(1, rect.height)
  if (rx > .3 && rx < .7 && ry > .3 && ry < .7) return 'center'
  return (ry < .5 ? 'top' : 'bottom') + '-' + (rx < .5 ? 'left' : 'right')
}
export function reorderCommand(rows, id, targetId, after = false) {
  const moving = rows.find(o => o.id === id), target = rows.find(o => o.id === targetId)
  if (!moving || !target || moving.id === target.id || (moving.parent || null) !== (target.parent || null)) return null
  const others = rows.filter(o => o.id !== id)
  return { op: 'move', id, parent: moving.parent || null, index: others.findIndex(o => o.id === targetId) + (after ? 1 : 0) }
}
export function changeLayout(layout, values, compact) {
  return compact ? { ...layout, compact: { ...layout?.compact, ...values } } : { ...layout, ...values }
}
export function resizedLayout(layout, width, height, compact) {
  const clamp = v => Math.max(24, Math.min(4000, Math.round(v)))
  return changeLayout(layout, { width: clamp(width), height: clamp(height) }, compact)
}

// A gesture commits exactly one existing scene command, using its starting version.
export function mountInteraction(canvas, { scene, engine, getSelected, select, patchObject, report, refreshView }) {
  let gesture, suppressClick = false, disposed = false
  const objects = () => scene.expanded().objects
  const nodeFor = id => [...canvas.querySelectorAll('[data-object-id]')].find(n => n.dataset.objectId === id)
  const own = id => scene.document.scenes.find(s => s.id === scene.selected)?.objects.find(o => o.id === id)
  const effective = (o, compact) => ({ ...o?.layout, ...(compact ? o?.layout?.compact : {}) })
  function clearMarks() { for (const n of canvas.querySelectorAll('.is-dragging,[data-drop-side],[data-drop-anchor]')) { n.classList.remove('is-dragging'); delete n.dataset.dropSide; delete n.dataset.dropAnchor } }
  function finish(cancel = false) {
    const g = gesture; gesture = null; if (!g) return
    if(canvas.hasPointerCapture?.(g.pointerId))canvas.releasePointerCapture(g.pointerId); clearMarks()
    if (g.moved) suppressClick = true
    try {
      if (!cancel && g.moved && !scene.playing && g.sceneId === scene.selected) {
        if (g.layout) patchObject(g.id, { layout: g.layout }, g.version)
        else if (g.command) scene.edit({ ...g.command, sceneId: g.sceneId }, g.version)
      }
    } catch (error) { report(error.message) }
    if(!disposed){refreshView(); refresh()}
  }
  function down(event) {
    if (scene.playing || event.button !== 0 || gesture) return
    suppressClick = false
    const node = event.target.closest('[data-object-id]'); if (!node || !canvas.contains(node)) return
    const handle = event.target.closest('[data-scene-handle]')
    if (event.pointerType === 'touch' && !handle) return
    const id = node.dataset.objectId, o = objects().find(o => o.id === id), resize = handle?.dataset.sceneHandle === 'resize'
    if (!o || !resize && !own(id)) return
    const rect = node.getBoundingClientRect(), compact = canvas.clientWidth > 0 && canvas.clientWidth < 600
    const parent = objects().find(p => p.id === o.parent), mode = effective(parent, compact).mode || 'column'
    select(id); event.preventDefault(); event.stopPropagation()
    gesture = { id, node, object: o, resize, rect, mode, compact, x: event.clientX, y: event.clientY, pointerId: event.pointerId, version: engine.version, sceneId: scene.selected, moved: false }
    canvas.setPointerCapture?.(event.pointerId)
  }
  function move(event) {
    const g = gesture; if (!g || event.pointerId !== g.pointerId) return
    const dx = event.clientX - g.x, dy = event.clientY - g.y
    if (!g.moved && Math.hypot(dx, dy) < 5) return
    event.preventDefault(); g.moved = true; clearMarks(); g.node.classList.add('is-dragging')
    if (g.resize) {
      g.layout = resizedLayout(g.object.layout, g.rect.width + dx, g.rect.height + dy, g.compact)
      const value = g.compact ? g.layout.compact : g.layout
      g.node.style.width = value.width + 'px'; g.node.style.height = value.height + 'px'; return
    }
    if (['overlay', 'anchor'].includes(g.mode)) {
      const rect = g.node.parentElement.getBoundingClientRect(), anchor = anchorAt(event.clientX, event.clientY, rect)
      g.node.dataset.dropAnchor = anchor; g.layout = changeLayout(g.object.layout, { anchor }, g.compact); return
    }
    const rows = scene.document.scenes.find(s => s.id === g.sceneId).objects
    const peers = rows.filter(o => o.id !== g.id && (o.parent || null) === (g.object.parent || null)).map(o => ({ o, n: nodeFor(o.id) })).filter(p => p.n)
    let target, after = false
    for (const p of peers) {
      const r = p.n.getBoundingClientRect()
      const before = g.mode === 'row' ? event.clientX < r.left + r.width / 2 : g.mode === 'grid' ? event.clientY < r.top || event.clientY <= r.bottom && event.clientX < r.left + r.width / 2 : event.clientY < r.top + r.height / 2
      target = p; if (before) break; after = true
      if (p !== peers.at(-1)) after = false
    }
    g.command = target ? reorderCommand(rows, g.id, target.o.id, after) : null
    if (target) { target.n.dataset.dropSide = after ? 'after' : 'before'; target.n.dataset.dropAxis = g.mode === 'row' || g.mode === 'grid' ? 'x' : 'y' }
  }
  function click(event) { if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false } }
  function key(event) { if (event.key === 'Escape' && gesture) { event.preventDefault(); finish(true) } }
  const up = () => finish(), cancel = () => finish(true)
  canvas.addEventListener('pointerdown', down, true); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', cancel); canvas.addEventListener('click', click, true); document.addEventListener('keydown', key)
  function refresh() {
    if (disposed || gesture) return
    canvas.querySelectorAll('[data-scene-handle]').forEach(n => n.remove())
    if (scene.playing) return
    const id = getSelected(), node = nodeFor(id); if (!node) return
    for (const [kind, label, icon] of [['move', '拖动选中对象（按布局规则）', '⠿'], ['resize', '调整选中对象尺寸', '↘']]) {
      if (kind === 'move' && !own(id)) continue
      const handle = document.createElement('button'); handle.type = 'button'; handle.className = 'scene-' + kind + '-handle'; handle.dataset.sceneHandle = kind; handle.setAttribute('aria-label', label); handle.title = label; handle.textContent = icon
      handle.addEventListener('click', e => { e.stopPropagation(); e.preventDefault() }); node.append(handle)
    }
  }
  return { refresh, dispose() { disposed = true; finish(true); canvas.removeEventListener('pointerdown', down, true); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', cancel); canvas.removeEventListener('click', click, true); document.removeEventListener('keydown', key); canvas.querySelectorAll('[data-scene-handle]').forEach(n => n.remove()) } }
}
