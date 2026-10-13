export default function (ctx, sdk) {
  const s = ctx.canvasSession, view = ctx.canvasUI
  const { el, button, safe, edit, imageUrl, position, coordinates, stage, add } = view
  const api = (path, body) => sdk.request('/api/studio' + path, body === undefined ? 'GET' : 'POST', body)
  const { rememberAsset } = s, uuid = () => crypto.randomUUID()
  async function upload(file, extra = {}) {
    if (file.size > 20 * 1024 * 1024) throw Error('图片不能超过 20 MB')
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file) })
    const targetBoard = s.boardId, uploaded = await api('/upload', { name: file.name, base64: data })
    if (sdk.signal?.aborted) throw Error('图片卡片插件已停止')
    const asset = rememberAsset(uploaded)
    await edit([{ type: 'add', node: { id: uuid(), type: 'image', title: file.name, assetId: asset.id, ...position(), ...extra } }], { targetBoard })
    return asset
  }
  const fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, hidden: true })
  fileInput.onchange = safe(async () => { for (const file of fileInput.files) await upload(file); fileInput.value = '' })
  const viewer = el('dialog', { class: 'studio-viewer' })
  const viewerStage = el('div', { class: 'studio-viewer-stage', 'aria-label': '图片预览区域' }), viewerImage = el('img', { alt: '图片预览', draggable: false }), viewerZoom = el('span', { class: 'studio-viewer-zoom' }, '100%'), viewerDownload = el('a', { download: '' }, '下载原图')
  const viewerView = { zoom: 1, fit: 1, x: 0, y: 0, drag: null }
  const applyViewerView = () => { viewerImage.style.transform = `translate(-50%,-50%) translate(${viewerView.x}px,${viewerView.y}px) scale(${viewerView.zoom})`; viewerZoom.textContent = Math.round(viewerView.zoom * 100) + '%' }
  const zoomViewer = (next, px = 0, py = 0) => {
    const target = Math.min(8, Math.max(0.05, next)), ratio = target / viewerView.zoom
    viewerView.x = px - (px - viewerView.x) * ratio; viewerView.y = py - (py - viewerView.y) * ratio
    viewerView.zoom = target; applyViewerView()
  }
  const fitViewer = () => {
    const rect = viewerStage.getBoundingClientRect(), width = viewerImage.naturalWidth || rect.width, height = viewerImage.naturalHeight || rect.height
    viewerView.fit = Math.min(rect.width / width, rect.height / height, 1) || 1
    viewerView.zoom = viewerView.fit; viewerView.x = 0; viewerView.y = 0; applyViewerView()
  }
  const resetViewer = () => { viewerView.zoom = 1; viewerView.x = 0; viewerView.y = 0; applyViewerView() }
  const endViewerDrag = event => {
    if (!viewerView.drag) return
    viewerView.drag = null; viewerStage.classList.remove('grabbing')
    if (event?.pointerId !== undefined && viewerStage.hasPointerCapture?.(event.pointerId)) viewerStage.releasePointerCapture?.(event.pointerId)
  }
  viewerImage.draggable = false
  viewerImage.onload = () => { if (viewer.open) fitViewer() }
  viewerStage.onwheel = event => {
    event.preventDefault()
    const rect = viewerStage.getBoundingClientRect()
    zoomViewer(viewerView.zoom * Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2)
  }
  viewerStage.onpointerdown = event => {
    if (event.button !== 0) return
    event.preventDefault(); viewerView.drag = { x: event.clientX - viewerView.x, y: event.clientY - viewerView.y }
    viewerStage.setPointerCapture?.(event.pointerId); viewerStage.classList.add('grabbing')
  }
  viewerStage.onpointermove = event => {
    if (!viewerView.drag) return
    viewerView.x = event.clientX - viewerView.drag.x; viewerView.y = event.clientY - viewerView.drag.y; applyViewerView()
  }
  viewerStage.onpointerup = endViewerDrag
  viewerStage.onpointercancel = endViewerDrag
  viewerStage.ondblclick = () => { if (Math.abs(viewerView.zoom - viewerView.fit) < 0.001) resetViewer(); else fitViewer() }
  const viewerBar = el('div', { class: 'studio-viewer-bar' })
  viewerBar.append(button('关闭预览', () => viewer.close()),
    button('−', () => zoomViewer(viewerView.zoom / 1.25), 'studio-viewer-out'), viewerZoom,
    button('＋', () => zoomViewer(viewerView.zoom * 1.25), 'studio-viewer-in'),
    button('适应窗口', fitViewer), button('1:1', resetViewer),
    el('span', { class: 'studio-viewer-hint' }, '滚轮缩放 · 拖动平移 · 双击切换'),
    viewerDownload)
  viewerStage.append(viewerImage)
  viewer.append(viewerBar, viewerStage)
  function viewImage(id) {
    const asset = s.state.assets[id]
    viewerView.drag = null; viewerImage.src = imageUrl(id, false); viewerImage.alt = asset.name
    viewerDownload.href = imageUrl(id, false); viewerDownload.download = asset.name + '.png'
    viewer.showModal(); resetViewer()
    if (viewerImage.complete && viewerImage.naturalWidth) fitViewer()
  }
  sdk.listen(stage, 'dragover', event => event.preventDefault())
  sdk.listen(stage, 'drop', safe(async event => { event.preventDefault(); let offset = 0; for (const file of event.dataTransfer.files) { await upload(file, { ...coordinates(event), y: coordinates(event).y + offset }); offset += 50 } }))
  sdk.listen(window, 'paste', safe(async event => { if (event.target.closest('input,textarea')) return; const files = [...event.clipboardData.files]; if (files.length) { event.preventDefault(); for (const file of files) await upload(file) } }))

  view.root.append(fileInput, viewer)
  view.menu(ctx, { id: 'text', label: '＋ 文字', order: 10, run: () => add('text') })
  view.menu(ctx, { id: 'image', label: '↑ 图片', order: 20, run: () => fileInput.click() })
  view.register(ctx, { id: 'text', label: '文字灵感', icon: 'T', output: true, upstream: true,
    actions: [{ label: '编辑文字', run: node => view.editNode(node.id, 'text') }],
    render(node, card) { return view.nodeCard(node, card, { output: true }) },
  })
  view.register(ctx, { id: 'image', label: '图片', icon: '▧', output: true, upstream: true,
    size(node) { const asset = s.state.assets[node.assetId], width = Math.min(640, asset?.width || 340); return { width, height: width * (asset?.height || 240) / (asset?.width || 340) } },
    actions: [{ label: '预览图片', run: node => viewImage(node.assetId) },
      { label: '下载图片', run: node => { const a = el('a', { href: imageUrl(node.assetId, false), download: (s.state.assets[node.assetId]?.name || '图片') + '.png' }); a.click() } }],
    render(node, card) {
      return view.nodeCard(node, card, { output: true, onViewImage: current => viewImage(current.assetId) })
    },
  })
  view.extend(ctx, 'assets', {
    refresh() { view.assetsList.replaceChildren(...Object.values(s.state.assets).reverse().map(asset => { const b = button('', () => add('image', { assetId: asset.id, title: asset.name })); b.title = '添加到画布：' + asset.name; b.append(el('img', { src: imageUrl(asset.id), alt: asset.name, loading: 'lazy' })); return b })) },
    dispose() { view.assetsList.replaceChildren(); fileInput.remove(); viewer.remove() },
  })
}
