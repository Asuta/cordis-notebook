import { referenceInputs, modelKey } from './references.js'

export function createReferenceUI(ctx, view, s, sdk) {
  const { el, button, edit, flush } = view
  const { uploadMedia, mediaKind, mediaUrl } = s
  const picker = el('dialog', { class: 'studio-asset-picker' }), content = el('div', { class: 'studio-picker-grid studio-scroll' })
  let target, selection = new Set(), uploading = new Set()
  async function appendReferences(boardId, nodeId, ids) {
    await flush()
    const board = s.state.boards.find(item => item.id === boardId), node = board?.nodes.find(item => item.id === nodeId)
    if (!node) throw Error('生成卡片已删除')
    const references = [...(node.references || []), ...ids.map(assetId => ({ id: crypto.randomUUID(), assetId }))]
    await edit([{ type: 'update', id: node.id, patch: { references } }], { targetBoard: boardId })
  }
  const acceptSelection = button('添加参考素材', async () => { await appendReferences(target.boardId, target.nodeId, [...selection]); picker.close() }, 'studio-primary')
  const head = el('div', { class: 'studio-dialog-head' })
  head.append(el('h2', {}, '从素材库选择参考素材'), button('关闭', () => picker.close()))
  picker.append(head, el('p', {}, '选择顺序作为初始顺序，可在卡片中调整。'), content, acceptSelection); view.root.append(picker)
  ctx.effect(() => () => picker.remove())
  function pick(node) {
    target = { boardId: s.boardId, nodeId: node.id }; selection = new Set()
    content.replaceChildren(...Object.values(s.state.assets).reverse().map(asset => {
      const label = el('label'), checkbox = el('input', { type: 'checkbox', 'aria-label': asset.name })
      checkbox.onchange = () => checkbox.checked ? selection.add(asset.id) : selection.delete(asset.id)
      label.append(checkbox, el(mediaKind(asset) === 'video' ? 'video' : 'img', { src: mediaUrl(asset), ...(mediaKind(asset) === 'video' ? { preload: 'metadata', muted: true } : { alt: asset.name, loading: 'lazy' }) }), el('span', {}, asset.name)); return label
    }))
    if (!content.children.length) content.append(el('p', {}, '素材库为空，请先上传参考素材。'))
    picker.showModal()
  }
  return (node, provider, model) => {
    const section = el('section', { class: 'studio-references' }), types = new Map((s.state.types || []).map(type => [type.id, type]))
    const refs = referenceInputs(s.board(), node, s.state.assets, types), key = modelKey(provider?.id, node.model)
    section.append(el('strong', {}, '参考素材'), el('small', {}, '卡片内参考与连线参考共同排序'))
    const actions = el('div', { class: 'studio-reference-actions' }), input = el('input', { type: 'file', multiple: true, hidden: true, accept: 'image/png,image/jpeg,image/webp,video/mp4,video/webm' })
    const upload = button(uploading.has(node.id) ? '正在上传…' : '上传参考素材', () => input.click())
    upload.disabled = uploading.has(node.id)
    input.onchange = view.safe(async () => {
      const files = [...input.files], boardId = s.boardId; if (!files.length) return
      uploading.add(node.id); view.render()
      try {
        for (const file of files) {
          const asset = await uploadMedia(file, sdk.signal); if (sdk.signal?.aborted) throw Error('上传已停止')
          s.rememberAsset(asset); await appendReferences(boardId, node.id, [asset.id])
        }
      } finally { uploading.delete(node.id); input.value = ''; view.render() }
    })
    actions.append(upload, button('从素材库选择', () => pick(node)), input); section.append(actions)
    const list = el('div', { class: 'studio-reference-list studio-scroll' })
    refs.forEach((ref, index) => {
      const asset = s.state.assets[ref.assetId], row = el('div', { class: 'studio-reference-row', 'data-reference': ref.key })
      const thumbnail = button('', () => view.openMedia(asset.id), 'studio-reference-thumb')
      thumbnail.setAttribute('aria-label', `放大预览参考素材 ${index + 1}`)
      thumbnail.title = '单击放大预览'
      thumbnail.disabled = !asset
      thumbnail.append(el(ref.kind === 'video' ? 'video' : 'img', { src: asset ? mediaUrl(asset) : '', ...(ref.kind === 'video' ? { preload: 'metadata', muted: true } : { alt: asset?.name || ref.title || '参考图片' }) }))
      row.append(thumbnail)
      const detail = el('div', { class: 'studio-reference-detail' })
      detail.append(el('span', { title: asset?.name || ref.title }, `${index + 1}. ${asset?.name || ref.title || '素材不可用'}`), el('small', {}, ref.source === 'edge' ? '连线参考' : '卡片内参考'))
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
      const controls = el('div', { class: 'studio-reference-controls' })
      for (const [label, delta] of [['↑', -1], ['↓', 1]]) {
        const move = button(label, async () => {
          await flush(); const order = refs.map(item => item.key); [order[index], order[index + delta]] = [order[index + delta], order[index]]
          await edit([{ type: 'update', id: node.id, patch: { referenceOrder: order } }])
        }); move.setAttribute('aria-label', `参考素材 ${index + 1} ${delta < 0 ? '上移' : '下移'}`); move.disabled = index + delta < 0 || index + delta >= refs.length; controls.append(move)
      }
      const remove = button('×', async () => {
        await flush()
        if (ref.edgeId) await edit([{ type: 'disconnect', id: ref.edgeId }])
        else { const current = s.board().nodes.find(item => item.id === node.id); await edit([{ type: 'update', id: node.id, patch: { references: current.references.filter(item => 'direct:' + item.id !== ref.key) } }]) }
      }); remove.setAttribute('aria-label', `参考素材 ${index + 1} ${ref.source === 'edge' ? '断开连线' : '移除'}`); controls.append(remove)
      row.append(detail, controls); list.append(row)
    })
    if (!refs.length) list.append(el('small', {}, '上传、选素材，或连接图片和视频卡片'))
    if (model?.mediaFields.length) section.append(el('small', { class: 'studio-media-limits' }, model.mediaFields.map(field => `${field.label}${field.required ? ' *' : ''}：${field.kind === 'video' ? '视频' : '图片'} ${field.min}–${field.max} 份`).join('；')))
    section.append(list); return section
  }
}
