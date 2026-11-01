import { referenceInputs } from './references.js'
import { clampCrop, rotatedSize, workspaceToSource } from './quick-edit-transform.js'

export function createQuickEdit(ctx, view, s, sdk, enqueueEdit) {
  const { el, button, edit, flush } = view
  const { uploadMedia } = s
  const dialog = el('dialog', { class: 'studio-quick-edit', 'aria-label': '快速编辑参考图' })
  const title = el('h2', {}, '快速编辑参考图')
  const hint = el('p', { class: 'studio-quick-edit-hint' }, '')
  const canvas = el('canvas', { class: 'studio-quick-edit-canvas' })
  const cropBox = el('div', { class: 'studio-quick-edit-crop', hidden: true, 'aria-hidden': 'true' })
  const frame = el('div', { class: 'studio-quick-edit-frame' }); frame.append(canvas, cropBox)
  const stage = el('div', { class: 'studio-quick-edit-stage' }); stage.append(frame)
  const brush = el('input', { type: 'range', min: 2, max: 32, value: 8, 'aria-label': '笔刷粗细' })
  const brushValue = el('span', { class: 'studio-quick-edit-value' }, '8 px')
  const color = el('input', { type: 'color', value: '#e8493f', 'aria-label': '笔刷颜色' })
  const rotate = el('input', { type: 'range', min: 0, max: 360, value: 0, 'aria-label': '旋转角度' })
  const rotateValue = el('span', { class: 'studio-quick-edit-value' }, '0°')
  const undo = button('撤销', () => { if (!strokes.length) return; strokes.pop(); repaint(); updateTools() })
  const clear = button('清空', () => { if (!strokes.length) return; strokes.length = 0; repaint(); updateTools() })
  const mirror = button('⇋ 镜像', () => {
    if (saving) return
    mirrored = !mirrored
    repaint(); updateMirror()
  }, 'studio-quick-edit-mirror')
  mirror.setAttribute('aria-label', '水平镜像')
  mirror.setAttribute('aria-pressed', 'false')
  mirror.title = '水平镜像（再次点击还原）'
  const cropMode = button('裁切', () => toggleCropMode(), 'studio-quick-edit-crop-toggle')
  cropMode.setAttribute('aria-label', '裁切图片')
  cropMode.setAttribute('aria-pressed', 'false')
  cropMode.title = '拖动框选要保留的图片区域'
  const clearCrop = button('重置裁切', () => {
    crop = null; cropping = null; mode = 'draw'; status.textContent = ''
    updateCropBox(); updateTools()
  }, 'studio-quick-edit-crop-clear')
  const status = el('small', { class: 'studio-quick-edit-status' }, '')
  const save = button('保存为新参考', () => saveEdited(), 'studio-primary')
  const close = button('关闭', () => { if (!saving) dialog.close() }), cancel = button('取消', () => { if (!saving) dialog.close() })
  const head = el('div', { class: 'studio-dialog-head' })
  head.append(title, close)
  const tools = el('div', { class: 'studio-quick-edit-tools' })
  const brushField = el('label', { class: 'studio-quick-edit-tool' }, '笔刷'), colorField = el('label', { class: 'studio-quick-edit-tool' }, '颜色'), rotateField = el('label', { class: 'studio-quick-edit-tool' }, '旋转')
  brushField.append(brush, brushValue); colorField.append(color); rotateField.append(rotate, rotateValue)
  tools.append(brushField, colorField, undo, clear, mirror, rotateField, cropMode, clearCrop)
  const actions = el('div', { class: 'studio-quick-edit-actions' })
  actions.append(status, cancel, save)
  dialog.append(head, hint, tools, stage, actions)
  view.root.append(dialog)
  ctx.effect(() => () => dialog.remove())
  let target = null, base = null, strokes = [], drawing = null, saving = false, mirrored = false
  let sourceWidth = 0, sourceHeight = 0, angle = 0, mode = 'draw', crop = null, cropping = null

  brush.oninput = () => { brushValue.textContent = brush.value + ' px' }
  rotate.oninput = () => setRotation(rotate.value)
  dialog.onclose = () => {
    target = null; base = null; strokes = []; drawing = null; mirrored = false
    sourceWidth = sourceHeight = 0; angle = 0; mode = 'draw'; crop = null; cropping = null
    status.textContent = ''
  }
  dialog.oncancel = event => { if (saving) event.preventDefault() }

  function context() { return canvas.getContext?.('2d') || null }
  function workspaceSize() { return rotatedSize(sourceWidth || 1, sourceHeight || 1, angle) }
  function updateTools() {
    undo.disabled = clear.disabled = !strokes.length
    save.disabled = saving || !base || (!strokes.length && !mirrored && !angle && !crop)
    mirror.disabled = rotate.disabled = saving
    cropMode.disabled = saving || !base
    clearCrop.disabled = saving || !crop
    cropMode.classList.toggle('is-active', mode === 'crop')
    cropMode.setAttribute('aria-pressed', String(mode === 'crop'))
    close.disabled = cancel.disabled = saving
  }
  function updateMirror() {
    mirror.classList.toggle('is-active', mirrored)
    mirror.setAttribute('aria-pressed', String(mirrored))
    mirror.title = mirrored ? '已水平镜像，再次点击还原' : '水平镜像（再次点击还原）'
  }
  function applyMirror(renderer) {
    if (!mirrored) return
    renderer.translate(canvas.width, 0)
    renderer.scale(-1, 1)
  }
  function applyContent(renderer) {
    applyMirror(renderer)
    if (!angle) return
    renderer.translate(canvas.width / 2, canvas.height / 2)
    renderer.rotate(angle * Math.PI / 180)
    renderer.translate(-sourceWidth / 2, -sourceHeight / 2)
  }
  function updateCropBox() {
    if (!crop || !canvas.width || !canvas.height) { cropBox.hidden = true; return }
    cropBox.hidden = false
    cropBox.style.left = crop.x / canvas.width * 100 + '%'
    cropBox.style.top = crop.y / canvas.height * 100 + '%'
    cropBox.style.width = crop.w / canvas.width * 100 + '%'
    cropBox.style.height = crop.h / canvas.height * 100 + '%'
  }
  function toggleCropMode() {
    if (!base || saving) return
    mode = mode === 'crop' ? 'draw' : 'crop'
    cropping = null
    status.textContent = mode === 'crop' ? '在图片上拖动框选要保留的区域' : (crop ? '已选择裁切区域，保存时只输出框内内容。' : '')
    updateTools()
  }
  function resizeCanvas() {
    const size = workspaceSize()
    if (canvas.width !== size.width || canvas.height !== size.height) {
      canvas.width = size.width; canvas.height = size.height
    }
    updateCropBox()
  }
  function setRotation(value) {
    if (saving) return
    const next = Math.max(0, Math.min(360, Number(value) || 0))
    rotate.value = String(next)
    rotateValue.textContent = next + '°'
    angle = next % 360
    if (!sourceWidth) return
    crop = null; cropping = null; mode = 'draw'; status.textContent = ''
    resizeCanvas(); repaint(); updateCropBox(); updateTools()
  }
  function workspacePoint(event) {
    const rect = canvas.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / Math.max(1, rect.height))),
    }
  }
  function sourcePoint(event) {
    const point = workspacePoint(event)
    return workspaceToSource(point.x, point.y, { width: canvas.width, height: canvas.height, sourceWidth, sourceHeight, angle, mirrored })
  }
  function paint(renderer, stroke) {
    if (!renderer || !stroke.points.length) return
    const [first, ...rest] = stroke.points
    renderer.save()
    Object.assign(renderer, { strokeStyle: stroke.color, fillStyle: stroke.color, lineWidth: stroke.width, lineCap: 'round', lineJoin: 'round' })
    if (!rest.length) { renderer.beginPath(); renderer.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2); renderer.fill() }
    else { renderer.beginPath(); renderer.moveTo(first.x, first.y); for (const item of rest) renderer.lineTo(item.x, item.y); renderer.stroke() }
    renderer.restore()
  }
  function repaint() {
    const renderer = context()
    if (!renderer) return
    renderer.clearRect(0, 0, canvas.width, canvas.height)
    if (!base) return
    renderer.save(); applyContent(renderer)
    renderer.drawImage(base, 0, 0, sourceWidth, sourceHeight)
    for (const stroke of strokes) paint(renderer, stroke)
    renderer.restore()
  }

  canvas.onpointerdown = event => {
    if (event.button !== 0 || !base) return
    event.preventDefault()
    const renderer = context(), rect = canvas.getBoundingClientRect()
    if (!renderer) return
    if (mode === 'crop') {
      const start = workspacePoint(event)
      crop = { x: start.x, y: start.y, w: 0, h: 0 }
      cropping = { pointerId: event.pointerId, start }
      canvas.setPointerCapture?.(event.pointerId)
      updateCropBox(); return
    }
    const stroke = { color: color.value, width: Math.max(1, Number(brush.value) * canvas.width / Math.max(1, rect.width)), points: [sourcePoint(event)] }
    strokes.push(stroke); drawing = { pointerId: event.pointerId, stroke }
    canvas.setPointerCapture?.(event.pointerId)
    renderer.save(); applyContent(renderer); paint(renderer, stroke); renderer.restore(); updateTools()
  }
  canvas.onpointermove = event => {
    if (cropping && event.pointerId === cropping.pointerId) {
      const next = workspacePoint(event), start = cropping.start
      crop = { x: Math.min(start.x, next.x), y: Math.min(start.y, next.y), w: Math.abs(next.x - start.x), h: Math.abs(next.y - start.y) }
      updateCropBox(); return
    }
    if (!drawing || event.pointerId !== drawing.pointerId) return
    const renderer = context(), stroke = drawing.stroke, previous = stroke.points.at(-1), next = sourcePoint(event)
    if (!renderer || Math.hypot(next.x - previous.x, next.y - previous.y) < 0.5) return
    stroke.points.push(next)
    renderer.save(); applyContent(renderer)
    Object.assign(renderer, { strokeStyle: stroke.color, lineWidth: stroke.width, lineCap: 'round', lineJoin: 'round' })
    renderer.beginPath(); renderer.moveTo(previous.x, previous.y); renderer.lineTo(next.x, next.y); renderer.stroke()
    renderer.restore()
  }
  const finish = event => {
    if (cropping && event.pointerId === cropping.pointerId) {
      canvas.releasePointerCapture?.(event.pointerId)
      crop = clampCrop(crop, canvas.width, canvas.height)
      cropping = null; mode = 'draw'
      status.textContent = crop ? '已选择裁切区域，保存时只输出框内内容。' : ''
      updateCropBox(); updateTools()
      return
    }
    if (!drawing || event.pointerId !== drawing.pointerId) return
    canvas.releasePointerCapture?.(event.pointerId); drawing = null
  }
  canvas.onpointerup = finish
  canvas.onpointercancel = finish

  function addReferenceAfter(boardId, nodeId, sourceKey, assetId) {
    return enqueueEdit(async () => {
      await flush()
      const board = s.state.boards.find(item => item.id === boardId), node = board?.nodes.find(item => item.id === nodeId)
      if (!node) throw Error('生成卡片已删除')
      const types = new Map((s.state.types || []).map(type => [type.id, type]))
      const keys = referenceInputs(board, node, s.state.assets, types).map(item => item.key)
      const id = crypto.randomUUID(), key = 'direct:' + id, order = keys.filter(item => item !== key)
      const index = order.indexOf(sourceKey)
      order.splice(index < 0 ? order.length : index + 1, 0, key)
      await edit([{ type: 'update', id: node.id, patch: { references: [...(node.references || []), { id, assetId }], referenceOrder: order } }], { targetBoard: boardId })
    })
  }
  const toBlob = source => new Promise((resolve, reject) => source.toBlob(blob => blob ? resolve(blob) : reject(Error('无法生成编辑后的图片')), 'image/png'))
  function outputCanvas() {
    if (!crop) return canvas
    const x = Math.max(0, Math.min(canvas.width - 1, Math.round(crop.x)))
    const y = Math.max(0, Math.min(canvas.height - 1, Math.round(crop.y)))
    const width = Math.max(1, Math.min(canvas.width - x, Math.round(crop.w)))
    const height = Math.max(1, Math.min(canvas.height - y, Math.round(crop.h)))
    const output = el('canvas')
    output.width = width; output.height = height
    output.getContext('2d').drawImage(canvas, x, y, width, height, 0, 0, width, height)
    return output
  }
  async function exportPng() {
    const rendered = outputCanvas()
    let blob = await toBlob(rendered)
    for (let scale = 0.8; blob.size > 20 * 1024 * 1024 && scale >= 0.4; scale *= 0.8) {
      const scaled = el('canvas')
      scaled.width = Math.max(1, Math.round(rendered.width * scale)); scaled.height = Math.max(1, Math.round(rendered.height * scale))
      scaled.getContext('2d').drawImage(rendered, 0, 0, scaled.width, scaled.height)
      blob = await toBlob(scaled)
    }
    if (blob.size > 20 * 1024 * 1024) throw Error('编辑后的图片超过 20 MB，请换用更小的原图')
    return blob
  }
  async function saveEdited() {
    const current = target
    if (!current || !base || (!strokes.length && !mirrored && !angle && !crop) || saving) return
    saving = true; save.textContent = '正在保存…'; status.textContent = '正在生成并上传编辑后的图片…'; updateTools()
    try {
      const blob = await exportPng(), name = ((current.asset.name || '参考图').replace(/\.[^.]+$/, '').slice(0, 80) || '参考图') + ' - 快速编辑.png'
      const uploaded = await uploadMedia(new File([blob], name, { type: 'image/png' }), sdk.signal)
      if (sdk.signal?.aborted) throw Error('上传已停止')
      s.rememberAsset(uploaded)
      await addReferenceAfter(current.boardId, current.nodeId, current.key, uploaded.id)
      dialog.close()
      view.render()
    } finally {
      saving = false; save.textContent = '保存为新参考'; status.textContent = ''; updateTools()
    }
  }

  function open(node, ref, asset) {
    if (!asset || ref.kind === 'video' || dialog.open) return
    target = { boardId: s.boardId, nodeId: node.id, key: ref.key, asset }
    base = null; strokes = []; drawing = null; mirrored = false
    sourceWidth = sourceHeight = 0; angle = 0; mode = 'draw'; crop = null; cropping = null
    status.textContent = ''; rotate.value = '0'; rotateValue.textContent = '0°'
    updateMirror(); updateCropBox()
    title.textContent = '快速编辑 · ' + (asset.name || '参考图')
    hint.textContent = '正在读取原图…'
    canvas.width = 1; canvas.height = 1
    context()?.clearRect(0, 0, 1, 1)
    updateTools(); dialog.showModal()
    const image = el('img', { alt: '' })
    image.onload = () => {
      if (!dialog.open || target?.asset.id !== asset.id) return
      base = image
      const scale = Math.min(1, 4096 / Math.max(1, image.naturalWidth, image.naturalHeight))
      sourceWidth = Math.max(1, Math.round(image.naturalWidth * scale)); sourceHeight = Math.max(1, Math.round(image.naturalHeight * scale))
      resizeCanvas()
      hint.textContent = '用画笔标注，或旋转、镜像、裁切；保存后会新增一张参考图，原图保留。'
      repaint(); updateTools()
    }
    image.onerror = () => { if (dialog.open) { hint.textContent = '无法读取原图，请稍后重试。'; status.textContent = '原图读取失败' } }
    image.src = view.imageUrl(asset.id, false)
  }
  return { open }
}
