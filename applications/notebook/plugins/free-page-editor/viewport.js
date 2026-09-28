// Coordinates are stored in document units; zoom changes only the viewport.
export function createViewport(viewport, stage, paper, bounds, save, contentTop = 0) {
  let zoom = 1,
    pending = null,
    animation = null,
    frame = 0
  const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback)
  const layout = () => {
    if (!viewport.isConnected || !viewport.clientWidth || !viewport.clientHeight) return
    const size = bounds(),
      left = pending?.left ?? viewport.scrollLeft,
      top = pending?.top ?? viewport.scrollTop
    const width = Math.max(1200, size.width, (left + viewport.clientWidth) / zoom + 300),
      height = Math.max(1000, size.height, (top + viewport.clientHeight) / zoom + 300)
    paper.style.width = width + 'px'
    paper.style.height = height + 'px'
    paper.style.transform = `scale(${zoom})`
    stage.style.width = width * zoom + 'px'
    stage.style.height = height * zoom + 'px'
    if (pending) {
      viewport.scrollTo(left, top)
      if (Math.abs(viewport.scrollLeft - left) <= 1 && Math.abs(viewport.scrollTop - top) <= 1) pending = null
    }
  }
  const snapshot = () => (pending ? { ...pending, zoom } : { left: viewport.scrollLeft, top: viewport.scrollTop, zoom })
  const cancel = () => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    animation = null
    paper.style.willChange = ''
  }
  const applyZoom = (value, anchor) => {
    zoom = value
    pending = { left: Math.max(0, anchor.worldX * zoom - anchor.x), top: Math.max(0, anchor.worldY * zoom - anchor.y) }
    layout()
  }
  const animate = (time) => {
    const a = animation
    if (!a) return
    if (a.start == null) a.start = time
    const t = Math.min(1, (time - a.start) / 160), eased = 1 - (1 - t) ** 3
    applyZoom(a.from + (a.to - a.from) * eased, a)
    if (t < 1) frame = requestAnimationFrame(animate)
    else { cancel(); save(snapshot()) }
  }
  const finishZoom = () => {
    if (!animation) return
    const a = animation
    cancel()
    applyZoom(a.to, a)
    save(snapshot())
  }
  return {
    layout,
    snapshot,
    finishZoom,
    destroy: cancel,
    restore(value = {}) {
      cancel()
      zoom = Math.max(0.25, Math.min(3, finite(value.zoom, 1) || 1))
      pending = { left: Math.max(0, finite(value.left)), top: Math.max(0, finite(value.top)) }
      layout()
    },
    setZoom(value, point, smooth = false) {
      const next = Math.max(0.25, Math.min(3, finite(value, 1))),
        rect = viewport.getBoundingClientRect(),
        x = point ? point.x - rect.left : viewport.clientWidth / 2,
        y = point ? point.y - rect.top : viewport.clientHeight / 2
      const anchor = {
        x, y,
        worldX: ((pending?.left ?? viewport.scrollLeft) + x) / zoom,
        worldY: ((pending?.top ?? viewport.scrollTop) + y) / zoom,
      }
      cancel()
      if (smooth && typeof requestAnimationFrame === 'function' &&
          !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches && Math.abs(next - zoom) > 0.0001) {
        animation = { ...anchor, from: zoom, to: next, start: null }
        paper.style.willChange = 'transform'
        frame = requestAnimationFrame(animate)
      } else { applyZoom(next, anchor); save(snapshot()) }
    },
    get zoom() {
      return zoom
    },
    get targetZoom() { return animation?.to ?? zoom },
    point(event) {
      const rect = viewport.getBoundingClientRect()
      return {
        x: Math.max(0, (event.clientX - rect.left + viewport.scrollLeft) / zoom),
        y: Math.max(0, (event.clientY - rect.top + viewport.scrollTop) / zoom - contentTop),
      }
    },
    scrolled() {
      if (!animation && !pending && viewport.isConnected && viewport.clientWidth && viewport.clientHeight) {
        layout()
        save(snapshot())
      }
    },
  }
}
