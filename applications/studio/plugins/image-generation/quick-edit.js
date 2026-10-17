import { referenceInputs } from './references.js'

export function createQuickEdit(ctx, view, s, sdk, enqueueEdit) {
  const { el, button, edit, flush } = view
  const { uploadMedia } = s
  const dialog = el('dialog', { class: 'studio-quick-edit', 'aria-label': '快速编辑参考图' })
  const title = el('h2', {}, '快速编辑参考图')
  const hint = el('p', { class: 'studio-quick-edit-hint' }, '')
  const canvas = el('canvas', { class: 'studio-quick-edit-canvas' })
  const stage = el('div', { class: 'studio-quick-edit-stage' }); stage.append(canvas)
  const brush = el('input', { type: 'range', min: 2, max: 32, value: 8, 'aria-label': '笔刷粗细' })
  const brushValue = el('span', { class: 'studio-quick-edit-value' }, '8 px')
  const color = el('input', { type: 'color', value: '#e8493f', 'aria-label': '笔刷颜色' })
  const undo = button('撤销', () => { if (!strokes.length) return; strokes.pop(); repaint(); updateTools() })
  const clear = button('清空', () => { if (!strokes.length) return; strokes.length = 0; repaint(); updateTools() })
  const status = el('small', { class: 'studio-quick-edit-status' }, '')
  const save = button('保存为新参考', () => saveEdited(), 'studio-primary')
  const close = button('关闭', () => { if (!saving) dialog.close() }), cancel = button('取消', () => { if (!saving) dialog.close() })
  const head = el('div', { class: 'studio-dialog-head' })
  head.append(title, close)
  const tools = el('div', { class: 'studio-quick-edit-tools' })
  const brushField = el('label', { class: 'studio-quick-edit-tool' }, '笔刷'), colorField = el('label', { class: 'studio-quick-edit-tool' }, '颜色')
  brushField.append(brush, brushValue); colorField.append(color)
  tools.append(brushField, colorField, undo, clear)
  const actions = el('div', { class: 'studio-quick-edit-actions' })
  actions.append(status, cancel, save)
  dialog.append(head, hint, tools, stage, actions)
  view.root.append(dialog)
  ctx.effect(() => () => dialog.remove())
  let target = null, base = null, strokes = [], drawing = null, saving = false

  brush.oninput = () => { brushValue.textContent = brush.value + ' px' }
  dialog.onclose = () => { target = null; base = null; strokes = []; drawing = null; status.textContent = '' }
  dialog.oncancel = event => { if (saving) event.preventDefault() }

  function context() { return canvas.getContext?.('2d') || null }
  function updateTools() { undo.disabled = clear.disabled = !strokes.length; save.disabled = saving || !base || !strokes.length; close.disabled = cancel.disabled = saving }
  function point(event) {
    const rect = canvas.getBoundingClientRect()
    return { x: (event.clientX - rect.left) * canvas.width / Math.max(1, rect.width), y: (event.clientY - rect.top) * canvas.height / Math.max(1, rect.height) }
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
    if (base) renderer.drawImage(base, 0, 0, canvas.width, canvas.height)
    for (const stroke of strokes) paint(renderer, stroke)
  }

  canvas.onpointerdown = event => {
    if (event.button !== 0 || !base) return
    event.preventDefault()
    const renderer = context(), rect = canvas.getBoundingClientRect()
    if (!renderer) return
    const stroke = { color: color.value, width: Math.max(1, Number(brush.value) * canvas.width / Math.max(1, rect.width)), points: [point(event)] }
    strokes.push(stroke); drawing = { pointerId: event.pointerId, stroke }
    canvas.setPointerCapture?.(event.pointerId)
    paint(renderer, stroke); updateTools()
  }
  canvas.onpointermove = event => {
    if (!drawing || event.pointerId !== drawing.pointerId) return
    const renderer = context(), stroke = drawing.stroke, previous = stroke.points.at(-1), next = point(event)
    if (!renderer || Math.hypot(next.x - previous.x, next.y - previous.y) < 0.5) return
    stroke.points.push(next)
    renderer.save()
    Object.assign(renderer, { strokeStyle: stroke.color, lineWidth: stroke.width, lineCap: 'round', lineJoin: 'round' })
    renderer.beginPath(); renderer.moveTo(previous.x, previous.y); renderer.lineTo(next.x, next.y); renderer.stroke()
    renderer.restore()
  }
  const finish = event => {
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
  async function exportPng() {
    let blob = await toBlob(canvas)
    for (let scale = 0.8; blob.size > 20 * 1024 * 1024 && scale >= 0.4; scale *= 0.8) {
      const scaled = el('canvas')
      scaled.width = Math.max(1, Math.round(canvas.width * scale)); scaled.height = Math.max(1, Math.round(canvas.height * scale))
      scaled.getContext('2d').drawImage(canvas, 0, 0, scaled.width, scaled.height)
      blob = await toBlob(scaled)
    }
    if (blob.size > 20 * 1024 * 1024) throw Error('编辑后的图片超过 20 MB，请换用更小的原图')
    return blob
  }
  async function saveEdited() {
    const current = target
    if (!current || !base || !strokes.length || saving) return
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
    base = null; strokes = []; drawing = null; status.textContent = ''
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
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      hint.textContent = '用画笔在图片上画出示意线条；保存后会新增一张参考图，原图保留。'
      repaint(); updateTools()
    }
    image.onerror = () => { if (dialog.open) { hint.textContent = '无法读取原图，请稍后重试。'; status.textContent = '原图读取失败' } }
    image.src = view.imageUrl(asset.id, false)
  }
  return { open }
}
