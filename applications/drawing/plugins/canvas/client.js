export default async function (ctx, sdk) {
  let tabId = sdk.storage.session.getItem('tab-id')
  if (!tabId) { tabId = crypto.randomUUID(); sdk.storage.session.setItem('tab-id', tabId) }
  const draftKey = 'draft-' + tabId
  const root = sdk.el('main', { class: 'drawing-app' }), toolbar = sdk.el('div', { class: 'drawing-toolbar' })
  const title = sdk.el('input', { 'aria-label': '作品标题', maxLength: 120 })
  const color = sdk.el('input', { type: 'color', value: '#7260ad', 'aria-label': '画笔颜色' })
  const width = sdk.el('input', { type: 'range', min: 1, max: 40, value: sdk.config.brushSize, 'aria-label': '画笔粗细' })
  const status = sdk.el('button', {}, '已保存'), canvas = sdk.el('canvas', { width: 1200, height: 800, 'aria-label': '绘图画布' })
  const drawing = canvas.getContext('2d'), history = []
  let data = await sdk.request('/api/drawing'), dirty = false, pending = null, stroke = null, version = 0, timer, stopped = false, held = false
  ctx.effect(() => () => { stopped = true; clearTimeout(timer) })
  try {
    const draft = JSON.parse(sdk.storage.local.getItem(draftKey))
    if (draft && Array.isArray(draft.strokes)) { data = draft; dirty = true; status.textContent = '已恢复草稿，点击保存' }
  } catch { sdk.toast('画图草稿无法读取，已保留原记录。') }
  title.value = data.title
  function remember() {
    try { sdk.storage.local.setItem(draftKey, JSON.stringify(data)) }
    catch { status.textContent = '草稿备份失败，请点击保存' }
  }
  function paint() {
    drawing.fillStyle = '#fff'; drawing.fillRect(0, 0, canvas.width, canvas.height)
    for (const item of [...data.strokes, ...(stroke ? [stroke] : [])]) {
      drawing.strokeStyle = drawing.fillStyle = item.color; drawing.lineWidth = item.width
      drawing.lineCap = drawing.lineJoin = 'round'; drawing.beginPath()
      item.points.forEach(([x, y], i) => i ? drawing.lineTo(x * canvas.width, y * canvas.height) : drawing.moveTo(x * canvas.width, y * canvas.height))
      if (item.points.length === 1) { const [x, y] = item.points[0]; drawing.arc(x * canvas.width, y * canvas.height, item.width / 2, 0, Math.PI * 2); drawing.fill() }
      else drawing.stroke()
    }
  }
  function changed() {
    dirty = true; version++; remember(); status.textContent = '正在保存…'
    clearTimeout(timer); timer = setTimeout(() => save().catch(error => { status.textContent = '保存失败，点击重试'; sdk.toast(error.message) }), 500)
  }
  function save() {
    clearTimeout(timer)
    if (pending) return pending
    // All callers await the whole flush, including edits made while a request is in flight.
    pending = Promise.resolve().then(async () => {
      while (dirty && !stopped) {
        const savedVersion = version, payload = structuredClone(data)
        const result = await sdk.request('/api/drawing', 'POST', payload)
        if (stopped) return
        data.revision = result.revision
        if (savedVersion === version) { dirty = false; sdk.storage.local.removeItem(draftKey); status.textContent = '已保存' }
        else remember()
      }
    }).finally(() => { pending = null })
    return pending
  }
  const snapshot = () => { history.push(structuredClone({ strokes: data.strokes, title: data.title })); if (history.length > 30) history.shift() }
  const button = (label, action) => {
    const node = sdk.el('button', {}, label)
    sdk.listen(node, 'click', () => { if (!held) action() }); toolbar.append(node); return node
  }
  toolbar.append(title, color, width)
  button('撤销', () => { if (history.length) { Object.assign(data, history.pop()); title.value = data.title; changed(); paint() } })
  button('清空画布', () => { snapshot(); data.strokes = []; changed(); paint() })
  button('导出 PNG', () => { const link = sdk.el('a', { href: canvas.toDataURL('image/png'), download: (data.title || '画作') + '.png' }); link.click() })
  button('载入已保存版本', () => {
    if (dirty && !window.confirm('这会丢弃本页未保存的草稿。需要保留时，请先导出 PNG。继续载入已保存版本？')) return
    clearTimeout(timer); dirty = false; sdk.storage.local.removeItem(draftKey); location.reload()
  })
  toolbar.append(status)
  root.append(sdk.el('h1', {}, '画图工作室'), sdk.el('p', { class: 'drawing-hint' }, '选择颜色，在画布上书写或绘画。作品自动保存在这个应用中。'), toolbar, canvas)
  sdk.mount('app', root)
  function point(event) {
    const rect = canvas.getBoundingClientRect()
    return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))]
  }
  function finish() {
    if (!stroke) return
    snapshot(); data.strokes.push(stroke); stroke = null; changed(); paint()
  }
  sdk.listen(canvas, 'pointerdown', event => {
    if (held || stroke || event.button !== 0) return
    event.preventDefault(); canvas.setPointerCapture(event.pointerId)
    stroke = { color: color.value, width: Number(width.value), points: [point(event)] }; paint()
  })
  sdk.listen(canvas, 'pointermove', event => { if (stroke) { stroke.points.push(point(event)); paint() } })
  sdk.listen(canvas, 'pointerup', finish); sdk.listen(canvas, 'pointercancel', finish)
  sdk.listen(canvas, 'lostpointercapture', finish)
  sdk.listen(title, 'input', () => { data.title = title.value; changed() })
  sdk.listen(status, 'click', () => save().catch(error => sdk.toast(error.message)))
  sdk.listen(window, 'beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = '' } })
  ctx.on('plugins/before-stop', async request => {
    held = true; root.inert = true
    request.hold(() => { held = false; root.inert = false })
    finish(); await save()
  })
  ctx.on('plugins/remote-stop', () => { finish(); if (dirty) remember() })
  sdk.onConfig(config => { width.value = config.brushSize })
  sdk.agent?.register({ name: 'drawing_read', description: '读取当前画布，包括尚未保存的笔画。version 用于防止覆盖用户编辑。', inputSchema: { type: 'object', properties: {} } }, () => ({ drawing: structuredClone(data), version }))
  sdk.agent?.register({ name: 'drawing_update', description: '替换当前画作标题或笔画；须提供 drawing_read 的 version。坐标为 0–1，保留撤销并自动保存。', inputSchema: {
    type: 'object', properties: { version: { type: 'integer' }, title: { type: 'string', maxLength: 120 }, strokes: { type: 'array', items: { type: 'object', properties: { color: { type: 'string' }, width: { type: 'number' }, points: { type: 'array', items: { type: 'array', items: { type: 'number' } } } }, required: ['color', 'width', 'points'] } } }, required: ['version'],
  } }, async args => {
    if (held || stroke || stopped || args.version !== version) throw Error('画布已变化或正在操作，请重新读取')
    if (args.title !== undefined && (typeof args.title !== 'string' || args.title.length > 120)) throw Error('标题无效')
    if (args.strokes !== undefined && (!Array.isArray(args.strokes) || args.strokes.length > 3000 || args.strokes.some(s => !/^#[a-f\d]{6}$/i.test(s.color) || !Number.isFinite(s.width) || s.width < 1 || s.width > 40 || !Array.isArray(s.points) || !s.points.length || s.points.some(p => !Array.isArray(p) || p.length !== 2 || p.some(n => !Number.isFinite(n) || n < 0 || n > 1))) || args.strokes.reduce((n, s) => n + s.points.length, 0) > 30000)) throw Error('笔画格式无效')
    snapshot()
    if (args.title !== undefined) title.value = data.title = args.title
    if (args.strokes !== undefined) data.strokes = structuredClone(args.strokes)
    changed(); paint(); await save(); return { saved: true, version }
  })
  paint()
}
