export function createMediaViewer({ ctx, s, el, button, root }) {
  const viewer = el('dialog', { class: 'studio-viewer', 'aria-label': '媒体放大预览' })
  const stage = el('div', { class: 'studio-viewer-stage', 'aria-label': '媒体预览区域' })
  const image = el('img', { alt: '图片预览', draggable: false })
  const video = el('video', { controls: true, playsInline: true, preload: 'metadata', hidden: true, 'aria-label': '视频预览' })
  const zoomLabel = el('span', { class: 'studio-viewer-zoom' }, '100%')
  const title = el('span', { class: 'studio-viewer-title' })
  const resolution = el('span', { class: 'studio-viewer-resolution' })
  const download = el('a', { download: '' }, '下载原图')
  const state = { zoom: 1, fit: 1, x: 0, y: 0, drag: null, asset: null }
  const active = () => image.hidden ? video : image
  const applyView = () => {
    image.style.transform = image.hidden ? '' : 'translate(-50%,-50%) translate(' + state.x + 'px,' + state.y + 'px) scale(' + state.zoom + ')'
    zoomLabel.textContent = Math.round(state.zoom * 100) + '%'
  }
  const zoom = (next, px = 0, py = 0) => {
    const target = Math.min(8, Math.max(0.05, next)), ratio = target / state.zoom
    state.x = px - (px - state.x) * ratio; state.y = py - (py - state.y) * ratio
    state.zoom = target; applyView()
  }
  const fit = () => {
    const rect = stage.getBoundingClientRect(), node = active(), width = node.naturalWidth || node.videoWidth || rect.width, height = node.naturalHeight || node.videoHeight || rect.height
    state.fit = Math.min(rect.width / width, rect.height / height, 1) || 1
    state.zoom = state.fit; state.x = 0; state.y = 0; applyView()
  }
  const reset = () => { state.zoom = 1; state.x = 0; state.y = 0; applyView() }
  const endDrag = event => {
    if (!state.drag) return
    state.drag = null; stage.classList.remove('grabbing')
    if (event?.pointerId !== undefined && stage.hasPointerCapture?.(event.pointerId)) stage.releasePointerCapture?.(event.pointerId)
  }
  image.onload = () => { if (viewer.open && state.asset && !image.hidden) fit() }
  video.onloadedmetadata = () => { if (viewer.open && state.asset?.kind === 'video') fit() }
  stage.onwheel = event => {
    event.preventDefault()
    if (image.hidden) return
    const rect = stage.getBoundingClientRect()
    zoom(state.zoom * Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2)
  }
  stage.onpointerdown = event => {
    if (event.button !== 0 || image.hidden) return
    event.preventDefault(); state.drag = { x: event.clientX - state.x, y: event.clientY - state.y }
    stage.setPointerCapture?.(event.pointerId); stage.classList.add('grabbing')
  }
  stage.onpointermove = event => {
    if (!state.drag) return
    state.x = event.clientX - state.drag.x; state.y = event.clientY - state.drag.y; applyView()
  }
  stage.onpointerup = endDrag
  stage.onpointercancel = endDrag
  stage.ondblclick = () => { if (!image.hidden) { if (Math.abs(state.zoom - state.fit) < 0.001) reset(); else fit() } }

  const zoomOut = button('−', () => zoom(state.zoom / 1.25), 'studio-viewer-out')
  const zoomIn = button('＋', () => zoom(state.zoom * 1.25), 'studio-viewer-in')
  const fitButton = button('适应窗口', fit)
  const resetButton = button('1:1', reset)
  const hint = el('span', { class: 'studio-viewer-hint' }, '滚轮缩放 · 拖动平移 · 双击切换')
  const bar = el('div', { class: 'studio-viewer-bar' })
  bar.append(button('关闭预览', () => viewer.close()), title, resolution, zoomOut, zoomLabel, zoomIn, fitButton, resetButton, hint, download)
  stage.append(image, video)
  viewer.append(bar, stage)
  root.append(viewer)

  function open(assetId) {
    const asset = s.state.assets[assetId]
    if (!asset) throw Error('素材不存在或尚未生成')
    state.asset = asset; state.drag = null
    const isVideo = asset.kind === 'video'
    image.hidden = isVideo; video.hidden = !isVideo
    title.textContent = asset.name || (isVideo ? '视频预览' : '图片预览')
    resolution.textContent = Number.isFinite(asset.width) && Number.isFinite(asset.height) ? asset.width + ' × ' + asset.height : ''
    resolution.hidden = !resolution.textContent
    for (const item of [zoomOut, zoomLabel, zoomIn, fitButton, resetButton, hint]) item.hidden = isVideo
    download.textContent = isVideo ? '下载视频' : '下载原图'
    download.href = isVideo ? s.mediaUrl(asset) : s.imageUrl(asset.id, false)
    const extension = isVideo ? asset.extension || 'mp4' : 'png', filename = asset.name || (isVideo ? '视频' : '图片')
    download.download = filename.toLowerCase().endsWith('.' + extension) ? filename : filename + '.' + extension
    if (isVideo) {
      image.removeAttribute('src'); video.src = s.mediaUrl(asset); video.load()
    } else {
      video.pause(); video.removeAttribute('src'); video.load()
      image.src = s.imageUrl(asset.id, false); image.alt = asset.name || '图片预览'
    }
    if (!viewer.open) viewer.showModal()
    reset()
    if (!isVideo && image.complete && image.naturalWidth) fit()
  }

  viewer.onclose = () => { state.drag = null; stage.classList.remove('grabbing'); video.pause() }
  viewer.onclick = event => {
    if (event.target !== viewer) return
    const rect = viewer.getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) viewer.close()
  }
  ctx.effect(() => () => { video.pause(); video.removeAttribute('src'); viewer.remove() })
  return { open }
}
