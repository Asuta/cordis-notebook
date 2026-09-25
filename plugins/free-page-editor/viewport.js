// Coordinates are stored in document units; zoom changes only the viewport.
export function createViewport(viewport, stage, paper, bounds, save) {
  let zoom = 1,
    pending = null
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
  return {
    layout,
    snapshot,
    restore(value = {}) {
      zoom = Math.max(0.25, Math.min(3, finite(value.zoom, 1) || 1))
      pending = { left: Math.max(0, finite(value.left)), top: Math.max(0, finite(value.top)) }
      layout()
    },
    setZoom(value, point) {
      const next = Math.max(0.25, Math.min(3, finite(value, 1))),
        rect = viewport.getBoundingClientRect(),
        x = point ? point.x - rect.left : viewport.clientWidth / 2,
        y = point ? point.y - rect.top : viewport.clientHeight / 2
      pending = {
        left: Math.max(0, ((viewport.scrollLeft + x) / zoom) * next - x),
        top: Math.max(0, ((viewport.scrollTop + y) / zoom) * next - y),
      }
      zoom = next
      layout()
      save(snapshot())
    },
    get zoom() {
      return zoom
    },
    point(event) {
      const rect = viewport.getBoundingClientRect()
      return {
        x: Math.max(0, (event.clientX - rect.left + viewport.scrollLeft) / zoom),
        y: Math.max(0, (event.clientY - rect.top + viewport.scrollTop) / zoom),
      }
    },
    scrolled() {
      if (!pending && viewport.isConnected && viewport.clientWidth && viewport.clientHeight) {
        layout()
        save(snapshot())
      }
    },
  }
}
