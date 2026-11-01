import { actionLabel, cardLabel, definition, digest, SKETCH_HEIGHT, SKETCH_WIDTH } from './card.js'
import { createMutation } from './mutation.js'

const COLORS = [
  { value: '#273128', label: '墨黑' },
  { value: '#3f6f9c', label: '蓝色' },
  { value: '#b4553f', label: '赭红' },
  { value: '#5f7d46', label: '草绿' },
]
const WHITE = '#ffffff'
const SURFACE_SCALE = 2
const EXPORT_SCALE = 3

function paint(context, strokes, scale) {
  context.save()
  context.setTransform(scale, 0, 0, scale, 0, 0)
  context.fillStyle = WHITE
  context.fillRect(0, 0, SKETCH_WIDTH, SKETCH_HEIGHT)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  for (const stroke of strokes) {
    const points = stroke.points
    if (points.length === 2) {
      context.beginPath()
      context.arc(points[0], points[1], stroke.width / 2, 0, Math.PI * 2)
      context.fillStyle = stroke.color
      context.fill()
      continue
    }
    context.beginPath()
    context.strokeStyle = stroke.color
    context.lineWidth = stroke.width
    context.moveTo(points[0], points[1])
    for (let index = 2; index < points.length; index += 2) context.lineTo(points[index], points[index + 1])
    context.stroke()
  }
  context.restore()
}

function exportBlob(strokes) {
  const canvas = document.createElement('canvas')
  canvas.width = SKETCH_WIDTH * EXPORT_SCALE
  canvas.height = SKETCH_HEIGHT * EXPORT_SCALE
  paint(canvas.getContext('2d'), strokes, EXPORT_SCALE)
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('无法导出参考图，请重试')), 'image/png'))
}

const fileName = title => (String(title || cardLabel).replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 80) || cardLabel) + '.png'

export default function (ctx, sdk) {
  const session = ctx.canvasSession, view = ctx.canvasUI, mutate = createMutation(ctx, session)
  const el = view.el
  const brushStates = new Map()
  ctx.effect(() => () => brushStates.clear())

  view.register(ctx, {
    id: definition.id, label: cardLabel, icon: '✎', output: true, height: 360,
    actions: [
      { label: '生成参考图', run: node => view.cards.querySelector(`[data-node="${node.id}"] .studio-sketch-export`)?.click() },
      { label: '清空手绘', run: node => view.cards.querySelector(`[data-node="${node.id}"] .studio-sketch-clear`)?.click() },
    ],
    render(node, card) {
      const draftStrokes = session.drafts.get(node.id)?.patch.strokes ?? node.strokes
      const strokes = Array.isArray(draftStrokes) ? structuredClone(draftStrokes) : []
      const brushKey = JSON.stringify([session.boardId, node.id])
      if (!brushStates.has(brushKey)) brushStates.set(brushKey, { color: COLORS[0].value, erasing: false, brush: 3 })
      const brushState = brushStates.get(brushKey)
      let { color, erasing, brush } = brushState
      let active = null, pointerId = null

      const body = el('div', { class: 'studio-sketch-body' })
      const tools = el('div', { class: 'studio-sketch-tools', role: 'group', 'aria-label': '画笔设置' })
      const swatches = el('div', { class: 'studio-sketch-colors' })
      const swatchButtons = COLORS.map(entry => {
        const swatch = el('button', { type: 'button', class: 'studio-sketch-color', 'aria-label': `画笔颜色：${entry.label}`, title: entry.label })
        swatch.style.background = entry.value
        swatch.onclick = () => { color = entry.value; erasing = false; syncTools() }
        swatches.append(swatch)
        return { entry, swatch }
      })
      const size = el('input', { type: 'range', min: '1', max: '16', step: '1', value: '3', class: 'studio-sketch-size', 'aria-label': '笔触粗细' })
      size.oninput = () => { brush = Number(size.value); erasing = false; syncTools() }
      const eraser = el('button', { type: 'button', class: 'studio-sketch-eraser', title: '用白色覆盖线条', 'aria-pressed': 'false' }, '擦')
      eraser.onclick = () => { erasing = !erasing; syncTools() }
      tools.append(swatches, size, eraser)

      const canvas = el('canvas', { class: 'studio-sketch-surface', width: SKETCH_WIDTH * SURFACE_SCALE, height: SKETCH_HEIGHT * SURFACE_SCALE, 'aria-label': `${cardLabel}：按住并拖动即可绘制` })
      const context = canvas.getContext('2d')

      const foot = el('div', { class: 'studio-sketch-foot' })
      const status = el('span', { class: 'studio-sketch-status' })
      const undoButton = el('button', { type: 'button', class: 'studio-sketch-undo', title: '撤销最后一笔', 'aria-label': '撤销最后一笔' }, '↶')
      const clearButton = el('button', { type: 'button', class: 'studio-sketch-clear', title: '清空整张手绘', 'aria-label': '清空整张手绘' }, '清空')
      const exportButton = el('button', { type: 'button', class: 'studio-sketch-export studio-primary' }, '生成参考图')
      foot.append(status, undoButton, clearButton, exportButton)
      body.append(tools, canvas, foot)
      card.append(body)

      function syncTools() {
        Object.assign(brushState, { color, erasing, brush })
        for (const { entry, swatch } of swatchButtons) {
          const selected = !erasing && entry.value === color
          swatch.classList.toggle('is-active', selected)
          swatch.setAttribute('aria-pressed', String(selected))
        }
        eraser.classList.toggle('is-active', erasing)
        eraser.setAttribute('aria-pressed', String(erasing))
        size.value = String(brush)
      }
      function syncStatus() {
        if (!strokes.length) status.textContent = '画几笔，再生成参考图'
        else if (!node.assetId) status.textContent = '尚未生成参考图'
        else if (node.referenceDigest === digest(strokes)) status.textContent = '参考图已是最新'
        else status.textContent = '手绘已修改，参考图待更新'
        exportButton.textContent = node.assetId ? '更新参考图' : '生成参考图'
        undoButton.disabled = !strokes.length
        clearButton.disabled = !strokes.length
      }
      const redraw = () => paint(context, strokes, SURFACE_SCALE)
      const commit = () => { session.draft(node, 'strokes', strokes); syncStatus() }
      const point = event => {
        const rect = canvas.getBoundingClientRect()
        const x = rect.width ? (event.clientX - rect.left) / rect.width * SKETCH_WIDTH : 0
        const y = rect.height ? (event.clientY - rect.top) / rect.height * SKETCH_HEIGHT : 0
        return [Math.max(0, Math.min(SKETCH_WIDTH, x)), Math.max(0, Math.min(SKETCH_HEIGHT, y))]
      }

      canvas.onpointerdown = event => {
        if (event.button !== 0 || active) return
        event.preventDefault()
        event.stopPropagation()
        view.beginEditing(canvas)
        pointerId = event.pointerId
        try { canvas.setPointerCapture(event.pointerId) } catch {}
        const [x, y] = point(event)
        active = { color: erasing ? WHITE : color, width: brush, points: [x, y] }
        strokes.push(active)
        redraw()
        syncStatus()
      }
      canvas.onpointermove = event => {
        if (!active || event.pointerId !== pointerId) return
        event.preventDefault()
        const [x, y] = point(event)
        const points = active.points, lastX = points[points.length - 2], lastY = points[points.length - 1]
        if (Math.abs(x - lastX) + Math.abs(y - lastY) < 0.6 || points.length >= 8000) return
        points.push(x, y)
        if (!context) return
        context.save()
        context.setTransform(SURFACE_SCALE, 0, 0, SURFACE_SCALE, 0, 0)
        context.beginPath()
        context.strokeStyle = active.color
        context.lineWidth = active.width
        context.lineCap = 'round'
        context.lineJoin = 'round'
        context.moveTo(lastX, lastY)
        context.lineTo(x, y)
        context.stroke()
        context.restore()
      }
      const finish = event => {
        if (!active || (event && event.pointerId !== pointerId)) return
        active = null; pointerId = null
        view.endEditing(canvas)
        if (sdk.signal.aborted) return
        commit()
        session.flush().catch(error => sdk.toast(error.message))
      }
      canvas.onpointerup = finish
      canvas.onpointercancel = finish
      canvas.onlostpointercapture = finish

      undoButton.onclick = () => {
        if (active || !strokes.length) return
        strokes.pop()
        redraw()
        commit()
        session.flush().catch(error => sdk.toast(error.message))
      }
      clearButton.onclick = () => {
        if (active || !strokes.length || !window.confirm('清空整张手绘？')) return
        strokes.length = 0
        redraw()
        commit()
        session.flush().catch(error => sdk.toast(error.message))
      }
      let assetId = node.assetId
      exportButton.onclick = async () => {
        const snapshot = structuredClone(strokes)
        if (!snapshot.length) { sdk.toast('先在卡片里画一些内容'); return }
        const nextDigest = digest(snapshot)
        exportButton.disabled = true
        exportButton.textContent = '生成中…'
        try {
          const blob = await exportBlob(snapshot)
          await session.flush()
          await mutate(async ({ signal }) => {
            const asset = await session.uploadMedia(new File([blob], fileName(node.title), { type: 'image/png' }), sdk.signal)
            session.rememberAsset(asset)
            if (signal.aborted) throw Error('操作已取消')
            assetId = asset.id
            return [{ type: 'update', id: node.id, patch: { assetId: asset.id, referenceDigest: nextDigest } }]
          })
          node.assetId = assetId
          node.referenceDigest = nextDigest
          sdk.toast('参考图已生成')
        } catch (error) {
          sdk.toast(error.message)
        } finally {
          exportButton.disabled = false
          syncStatus()
        }
      }

      redraw()
      syncTools()
      syncStatus()
    },
  })

  view.menu(ctx, { id: definition.id, label: actionLabel, order: 30,
    run: () => mutate(() => [{ type: 'add', node: { id: crypto.randomUUID(), type: definition.id, ...view.position() } }]),
  })
}
