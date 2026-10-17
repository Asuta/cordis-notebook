import { referenceInputs, modelKey } from './references.js'
import { createQuickEdit } from './quick-edit.js'

export function createReferenceUI(ctx, view, s, sdk) {
  const { el, button, edit, flush } = view
  const { uploadMedia, mediaKind, mediaUrl } = s
  const picker = el('dialog', { class: 'studio-asset-picker' }), content = el('div', { class: 'studio-picker-grid studio-scroll' })
  const fileInput = el('input', { type: 'file', multiple: true, hidden: true, accept: 'image/png,image/jpeg,image/webp,video/mp4,video/webm' })
  const uploadHint = el('small', {}, '支持 PNG/JPEG/WebP 图片和 MP4/WebM 视频；多选时其余素材会追加为新参考。')
  let target, dragRef, queue = Promise.resolve()
  // 连续点击“新建槽位”时串行读取最新卡片，避免两次写入抢同一版本。
  function enqueueEdit(action) {
    const run = queue.then(action)
    queue = run.catch(() => {})
    return run
  }
  function updateReferences(boardId, nodeId, change) {
    return enqueueEdit(async () => {
      await flush()
      const board = s.state.boards.find(item => item.id === boardId), node = board?.nodes.find(item => item.id === nodeId)
      if (!node) throw Error('生成卡片已删除')
      await edit([{ type: 'update', id: node.id, patch: { references: change([...(node.references || [])]) } }], { targetBoard: boardId })
    })
  }
  function moveReference(nodeId, fromKey, targetKey, before) {
    return enqueueEdit(async () => {
      await flush()
      const node = s.board().nodes.find(item => item.id === nodeId)
      if (!node) throw Error('生成卡片已删除')
      const types = new Map((s.state.types || []).map(type => [type.id, type]))
      const keys = referenceInputs(s.board(), node, s.state.assets, types).map(item => item.key)
      if (!keys.includes(fromKey) || !keys.includes(targetKey)) return
      const order = keys.filter(key => key !== fromKey), index = order.indexOf(targetKey)
      order.splice(index + (before ? 0 : 1), 0, fromKey)
      await edit([{ type: 'update', id: node.id, patch: { referenceOrder: order } }])
    })
  }
  const quickEdit = createQuickEdit(ctx, view, s, sdk, enqueueEdit)
  async function addSlot(node) {
    const id = crypto.randomUUID()
    await updateReferences(s.boardId, node.id, references => [...references, { id, assetId: null }])
    return id
  }
  function assign(slotId, assetId) {
    return updateReferences(target.boardId, target.nodeId, references => references.map(ref => ref.id === slotId ? { ...ref, assetId } : ref))
  }
  function drawPicker() {
    const assets = Object.values(s.state.assets).reverse(), uploadTile = button('', () => fileInput.click(), 'studio-picker-item is-upload')
    uploadTile.append(el('span', { class: 'studio-picker-upload', 'aria-hidden': 'true' }, '＋'), el('strong', {}, '上传本地图片'), el('small', {}, 'PNG / JPEG / WebP'))
    uploadTile.setAttribute('aria-label', '上传本地图片')
    content.replaceChildren(uploadTile, ...assets.map(asset => {
      const item = button('', async () => { await assign(target.slotId, asset.id); picker.close() }, 'studio-picker-item')
      item.append(el(mediaKind(asset) === 'video' ? 'video' : 'img', { src: mediaUrl(asset), ...(mediaKind(asset) === 'video' ? { preload: 'metadata', muted: true } : { alt: asset.name, loading: 'lazy' }) }), el('span', {}, asset.name))
      item.setAttribute('aria-label', `使用素材 ${asset.name}`)
      return item
    }))
    if (!assets.length) content.append(el('p', {}, '素材库为空，可直接从本机上传。'))
  }
  function pick(node, slotId) {
    target = { boardId: s.boardId, nodeId: node.id, slotId }
    drawPicker()
    picker.showModal()
  }
  const head = el('div', { class: 'studio-dialog-head' })
  head.append(el('h2', {}, '选择参考素材'), button('关闭', () => picker.close()))
  const footer = el('div', { class: 'studio-picker-actions' })
  footer.append(uploadHint, fileInput)
  picker.append(head, el('p', {}, '单击素材即可放入当前槽位；也可以从本机上传新素材。'), content, footer); view.root.append(picker)
  ctx.effect(() => () => picker.remove())
  fileInput.onchange = view.safe(async () => {
    const files = [...fileInput.files], slotId = target?.slotId; if (!files.length || !slotId) return
    const boardId = target.boardId, nodeId = target.nodeId
    uploadHint.textContent = '正在上传…'; fileInput.disabled = true
    try {
      const ids = []
      for (const file of files) {
        const asset = await uploadMedia(file, sdk.signal); if (sdk.signal?.aborted) throw Error('上传已停止')
        s.rememberAsset(asset); ids.push(asset.id)
      }
      await updateReferences(boardId, nodeId, references => {
        let filled = false
        const next = references.map(ref => { if (ref.id === slotId && !filled) { filled = true; return { ...ref, assetId: ids[0] } } return ref })
        for (const id of ids.slice(filled ? 1 : 0)) next.push({ id: crypto.randomUUID(), assetId: id })
        return next
      })
      if (target?.slotId === slotId && target?.boardId === boardId) picker.close()
    } finally { fileInput.disabled = false; uploadHint.textContent = '支持 PNG/JPEG/WebP 图片和 MP4/WebM 视频；多选时其余素材会追加为新参考。'; fileInput.value = ''; view.render() }
  })
  return (node, provider, model) => {
    const section = el('section', { class: 'studio-references' }), types = new Map((s.state.types || []).map(type => [type.id, type]))
    const refs = referenceInputs(s.board(), node, s.state.assets, types), key = modelKey(provider?.id, node.model)
    section.append(el('strong', {}, '参考素材'), el('small', {}, '卡片内参考与连线参考共同排序'))
    const actions = el('div', { class: 'studio-reference-actions' })
    actions.append(button('＋ 新建参考槽位', () => addSlot(node))); section.append(actions)
    const list = el('div', { class: 'studio-reference-list studio-scroll' })
    const clearMarks = () => { for (const item of list.querySelectorAll('.is-dragging,.is-drop-before,.is-drop-after')) item.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after') }
    refs.forEach((ref, index) => {
      const asset = ref.assetId ? s.state.assets[ref.assetId] : null, emptySlot = !asset && ref.source === 'direct'
      const row = el('div', { class: 'studio-reference-row' + (emptySlot ? ' is-empty' : ''), 'data-reference': ref.key })
      const grip = el('span', { class: 'studio-reference-grip', title: '拖动调整顺序', 'aria-hidden': 'true' }, '⠿')
      const thumbnail = button(asset ? '' : emptySlot ? '＋' : '!', asset ? () => view.openMedia(asset.id) : emptySlot ? () => pick(node, ref.id) : () => {}, 'studio-reference-thumb' + (emptySlot ? ' is-empty' : ''))
      thumbnail.setAttribute('aria-label', asset ? `放大预览参考素材 ${index + 1}` : emptySlot ? `选择参考素材 ${index + 1}` : `参考素材 ${index + 1} 不可用`)
      thumbnail.title = asset ? '单击放大预览' : emptySlot ? '单击选择素材' : '素材不可用'
      thumbnail.disabled = !asset && !emptySlot
      if (asset) thumbnail.append(el(ref.kind === 'video' ? 'video' : 'img', { src: mediaUrl(asset), ...(ref.kind === 'video' ? { preload: 'metadata', muted: true } : { alt: asset.name || ref.title || '参考图片' }) }))
      row.append(grip, thumbnail)
      const detail = el('div', { class: 'studio-reference-detail' })
      if (asset) {
        detail.append(el('span', { title: asset.name || ref.title }, `${index + 1}. ${asset.name || ref.title || '素材不可用'}`), el('small', {}, ref.source === 'edge' ? '连线参考' : '卡片内参考'))
        if (provider?.modelCatalog && model) {
          const candidates = model.mediaFields.filter(field => field.kind === ref.kind), binding = node.referenceBindings?.[key]?.[ref.key]
          if (candidates.length) {
            const select = el('select', { 'aria-label': `参考素材 ${index + 1} 输入位置` })
            select.append(el('option', { value: '' }, candidates.length === 1 ? '自动 → ' + candidates[0].label : '选择输入位置 *'))
            for (const field of candidates) select.append(el('option', { value: field.path }, field.label + (field.array ? `（最多 ${field.max} 份）` : '（1 份）')))
            select.value = binding || ''
            select.onchange = view.safe(async () => {
              await flush(); const current = s.board().nodes.find(item => item.id === node.id), bindings = structuredClone(current.referenceBindings || {})
              bindings[key] ||= {}; if (select.value) bindings[key][ref.key] = select.value; else delete bindings[key][ref.key]
              await edit([{ type: 'update', id: node.id, patch: { referenceBindings: bindings } }])
            }); detail.append(select)
          } else detail.append(el('small', { class: 'studio-field-error' }, '此模型不接受这类参考，请移除'))
        } else if (provider && !provider.modelCatalog && ref.kind === 'video') detail.append(el('small', { class: 'studio-field-error' }, '此服务不接受视频参考'))
      } else if (emptySlot) detail.append(el('span', {}, `${index + 1}. 空槽位`), el('small', {}, '尚未选择素材 · 点击左侧 ＋ 选择'))
      else detail.append(el('span', { title: ref.title }, `${index + 1}. 素材不可用`), el('small', {}, ref.source === 'edge' ? '连线参考' : '卡片内参考'))
      const controls = el('div', { class: 'studio-reference-controls' })
      for (const [label, delta] of [['↑', -1], ['↓', 1]]) {
        const target = refs[index + delta]
        const move = button(label, async () => {
          if (!target) return
          await moveReference(node.id, ref.key, target.key, delta < 0)
        })
        move.setAttribute('aria-label', `参考素材 ${index + 1} ${delta < 0 ? '上移' : '下移'}`)
        move.title = delta < 0 ? '上移参考素材' : '下移参考素材'
        move.disabled = !target
        controls.append(move)
      }
      if (asset && ref.kind === 'image') {
        const quick = button('快速编辑', () => quickEdit.open(node, ref, asset), 'studio-reference-quick')
        quick.setAttribute('aria-label', `快速编辑参考素材 ${index + 1}`)
        quick.title = '快速编辑：在图片上画线，保存为新的参考图'
        controls.append(quick)
      }
      const remove = button('×', async () => {
        await flush()
        if (ref.edgeId) await edit([{ type: 'disconnect', id: ref.edgeId }])
        else { const current = s.board().nodes.find(item => item.id === node.id); await edit([{ type: 'update', id: node.id, patch: { references: current.references.filter(item => 'direct:' + item.id !== ref.key) } }]) }
      }); remove.setAttribute('aria-label', `参考素材 ${index + 1} ${ref.source === 'edge' ? '断开连线' : '移除'}`); controls.append(remove)
      row.append(detail, controls); list.append(row)
      row.draggable = true
      row.onpointerdown = event => event.stopPropagation()
      row.ondragstart = event => {
        dragRef = { nodeId: node.id, key: ref.key }
        event.dataTransfer?.setData('text/plain', ref.key)
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
        row.classList.add('is-dragging')
      }
      row.ondragend = () => { dragRef = null; clearMarks() }
      row.ondragover = event => {
        if (!dragRef || dragRef.nodeId !== node.id || dragRef.key === ref.key) return
        event.preventDefault()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
        const rect = row.getBoundingClientRect(), before = event.clientY < rect.top + rect.height / 2
        for (const item of list.querySelectorAll('.studio-reference-row')) {
          item.classList.toggle('is-drop-before', item === row && before)
          item.classList.toggle('is-drop-after', item === row && !before)
        }
      }
      row.ondragleave = event => { if (!row.contains(event.relatedTarget)) row.classList.remove('is-drop-before', 'is-drop-after') }
      row.ondrop = view.safe(async event => {
        event.preventDefault()
        const before = row.classList.contains('is-drop-before'), from = dragRef
        clearMarks(); dragRef = null
        if (!from || from.nodeId !== node.id || from.key === ref.key) return
        await moveReference(node.id, from.key, ref.key, before)
      })
    })
    if (!refs.length) list.append(el('small', {}, '点击 ＋ 新建参考槽位，或连接图片和视频卡片'))
    if (model?.mediaFields.length) section.append(el('small', { class: 'studio-media-limits' }, model.mediaFields.map(field => `${field.label}${field.required ? ' *' : ''}：${field.kind === 'video' ? '视频' : '图片'} ${field.min}–${field.max} 份`).join('；')))
    section.append(list); return section
  }
}
