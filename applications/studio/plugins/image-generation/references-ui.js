import { referenceInputs, modelKey } from './references.js'
import { createQuickEdit } from './quick-edit.js'

const ASSET_DRAG_TYPE = 'application/x-cordis-studio-asset'

export function createReferenceUI(ctx, view, s, sdk) {
  const { el, button, edit, flush } = view
  const { uploadMedia, mediaKind, mediaUrl } = s
  const picker = el('dialog', { class: 'studio-asset-picker' }), content = el('div', { class: 'studio-picker-grid studio-scroll' })
  const fileInput = el('input', { type: 'file', multiple: true, hidden: true, accept: 'image/png,image/jpeg,image/webp,video/mp4,video/webm' })
  const pickerTitle = el('h2', {}, '选择参考素材')
  const pickerHint = el('p', {}, '单击素材即可放入当前槽位；也可以从本机上传新素材。')
  const uploadHint = el('small', {}, '支持 PNG/JPEG/WebP 图片和 MP4/WebM 视频；多选时其余素材会追加为新参考。')
  let target, queue = Promise.resolve(), selectedReference = null
  function clearReferenceVisuals() {
    for (const row of view.cards.querySelectorAll('.studio-reference-row.is-selected')) { row.classList.remove('is-selected'); row.setAttribute('aria-selected', 'false') }
    for (const hint of view.cards.querySelectorAll('.studio-reference-paste-hint')) hint.hidden = true
  }
  // 连续点击添加按钮时串行读取最新卡片，避免两次写入抢同一版本。
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
  function assign(slotId, assetId, at = target) {
    return updateReferences(at.boardId, at.nodeId, references => references.map(ref => ref.id === slotId ? { ...ref, assetId } : ref))
  }
  function replaceEdge(assetId, at = target) {
    const { boardId, nodeId, edgeId } = at, oldKey = 'edge:' + edgeId
    return enqueueEdit(async () => {
      await flush()
      const board = s.state.boards.find(item => item.id === boardId), node = board?.nodes.find(item => item.id === nodeId)
      if (!node) throw Error('生成卡片已删除')
      if (!board.edges.some(edge => edge.id === edgeId)) throw Error('连线参考已经变化，请重新打开快速替换')
      const id = crypto.randomUUID(), newKey = 'direct:' + id, references = [...(node.references || []), { id, assetId }]
      const types = new Map((s.state.types || []).map(type => [type.id, type]))
      const keys = referenceInputs(board, node, s.state.assets, types).map(item => item.key), index = keys.indexOf(oldKey)
      const order = keys.filter(key => key !== oldKey); order.splice(index < 0 ? order.length : index, 0, newKey)
      const bindings = structuredClone(node.referenceBindings || {})
      for (const values of Object.values(bindings)) {
        if (!values || !Object.hasOwn(values, oldKey)) continue
        values[newKey] = values[oldKey]; delete values[oldKey]
      }
      await edit([
        { type: 'disconnect', id: edgeId },
        { type: 'update', id: node.id, patch: { references, referenceOrder: order, referenceBindings: bindings } },
      ], { targetBoard: boardId })
    })
  }
  function replaceReference(assetId, at = target) {
    return at.edgeId ? replaceEdge(assetId, at) : assign(at.slotId, assetId, at)
  }
  function drawPicker() {
    const assets = Object.values(s.state.assets).reverse().filter(asset => target?.mode !== 'replace' || mediaKind(asset) === 'image'), uploadTile = button('', () => fileInput.click(), 'studio-picker-item is-upload')
    uploadTile.append(el('span', { class: 'studio-picker-upload', 'aria-hidden': 'true' }, '＋'), el('strong', {}, '上传本地图片'), el('small', {}, 'PNG / JPEG / WebP'))
    uploadTile.setAttribute('aria-label', '上传本地图片')
    content.replaceChildren(uploadTile, ...assets.map(asset => {
      const item = button('', async () => { await (target.mode === 'replace' ? replaceReference(asset.id) : assign(target.slotId, asset.id)); picker.close() }, 'studio-picker-item')
      item.append(el(mediaKind(asset) === 'video' ? 'video' : 'img', { src: mediaUrl(asset), ...(mediaKind(asset) === 'video' ? { preload: 'metadata', muted: true } : { alt: asset.name, loading: 'lazy' }) }), el('span', {}, asset.name))
      item.setAttribute('aria-label', `使用素材 ${asset.name}`)
      return item
    }))
    if (!assets.length) content.append(el('p', {}, '素材库为空，可直接从本机上传。'))
  }
  function pick(node, slotId, options = {}) {
    target = { boardId: s.boardId, nodeId: node.id, slotId, mode: 'select', ...options }
    const replacing = target.mode === 'replace'
    pickerTitle.textContent = replacing ? '快速替换参考图' : '选择参考素材'
    pickerHint.textContent = replacing ? '选择一张图片替换当前参考；原有排序和输入位置会保留。' : '单击素材即可放入当前槽位；也可以从本机上传新素材。'
    fileInput.accept = replacing ? 'image/png,image/jpeg,image/webp' : 'image/png,image/jpeg,image/webp,video/mp4,video/webm'
    fileInput.multiple = !replacing; fileInput.value = ''
    uploadHint.textContent = replacing ? '快速替换仅支持 PNG/JPEG/WebP 图片。' : '支持 PNG/JPEG/WebP 图片和 MP4/WebM 视频；多选时其余素材会追加为新参考。'
    drawPicker()
    picker.showModal()
  }
  const head = el('div', { class: 'studio-dialog-head' })
  head.append(pickerTitle, button('关闭', () => picker.close()))
  const footer = el('div', { class: 'studio-picker-actions' })
  footer.append(uploadHint, fileInput)
  picker.append(head, pickerHint, content, footer); view.root.append(picker)
  ctx.effect(() => () => picker.remove())
  fileInput.onchange = view.safe(async () => {
    // The picker can be reopened for another row while an upload is pending.
    // Freeze the complete replacement target before the first await.
    const at = target ? { ...target } : null, files = [...fileInput.files], slotId = at?.slotId, replacing = at?.mode === 'replace'
    if (!files.length || (!slotId && !replacing)) return
    const boardId = at.boardId, nodeId = at.nodeId
    uploadHint.textContent = '正在上传…'; fileInput.disabled = true
    try {
      const ids = []
      for (const file of files) {
        if (replacing && !/^image\/(png|jpeg|webp)$/.test(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) throw Error('快速替换仅支持 PNG/JPEG/WebP 图片')
        const asset = await uploadMedia(file, sdk.signal); if (sdk.signal?.aborted) throw Error('上传已停止')
        s.rememberAsset(asset); ids.push(asset.id)
      }
      if (at.mode === 'replace') await replaceReference(ids[0], at)
      else await updateReferences(boardId, nodeId, references => {
          let filled = false
          const next = references.map(ref => { if (ref.id === slotId && !filled) { filled = true; return { ...ref, assetId: ids[0] } } return ref })
          for (const id of ids.slice(filled ? 1 : 0)) next.push({ id: crypto.randomUUID(), assetId: id })
          return next
        })
      if (target?.slotId === at.slotId && target?.edgeId === at.edgeId && target?.nodeId === at.nodeId && target?.boardId === at.boardId && target?.mode === at.mode) picker.close()
    } finally {
      fileInput.disabled = false; fileInput.value = ''
      uploadHint.textContent = (target?.mode || at.mode) === 'replace' ? '快速替换仅支持 PNG/JPEG/WebP 图片。' : '支持 PNG/JPEG/WebP 图片和 MP4/WebM 视频；多选时其余素材会追加为新参考。'
      view.render()
    }
  })
  return (node, provider, model) => {
    const section = el('section', { class: 'studio-references' }), types = new Map((s.state.types || []).map(type => [type.id, type]))
    const refs = referenceInputs(s.board(), node, s.state.assets, types), key = modelKey(provider?.id, node.model)
    const acceptedKinds = model ? new Set(model.mediaFields.map(field => field.kind)) : new Set(provider?.modelCatalog ? ['image', 'video'] : ['image'])
    section.append(el('strong', {}, '参考素材'))
    const list = el('div', { class: 'studio-reference-list studio-scroll' })
    const pasteHint = el('small', { class: 'studio-reference-paste-hint', hidden: true }, '已选中槽位 · Ctrl+V 粘贴图片 · Esc 取消')
    let orderDrag
    const clearOrderVisuals = state => {
      for (const item of state.rows) {
        item.style.transform = ''
        item.classList.remove('is-pointer-dragging', 'is-drop-before', 'is-drop-after')
      }
      list.classList.remove('is-reordering')
      if (state.grip.hasPointerCapture?.(state.pointerId)) state.grip.releasePointerCapture(state.pointerId)
    }
    const moveOrder = (state, clientY) => {
      if (orderDrag !== state || state.pointerId === undefined) return
      const dy = clientY - state.startY
      if (!state.moved && Math.abs(dy) >= 4) state.moved = true
      if (!state.moved) return
      state.row.style.transform = 'translateY(' + dy + 'px)'
      const remaining = state.rows.filter(item => item !== state.row)
      let targetIndex = remaining.length
      for (let index = 0; index < remaining.length; index++) {
        const rect = state.rects.get(remaining[index]), center = (rect?.top || 0) + (rect?.height || state.height) / 2
        if (clientY < center) { targetIndex = index; break }
      }
      state.targetIndex = targetIndex
      const distance = state.height + 6
      state.rows.forEach((item, index) => {
        if (item === state.row) return
        let shift = 0
        if (targetIndex < state.fromIndex && index >= targetIndex && index < state.fromIndex) shift = distance
        else if (targetIndex > state.fromIndex && index > state.fromIndex && index <= targetIndex) shift = -distance
        item.style.transform = shift ? 'translateY(' + shift + 'px)' : ''
        item.classList.toggle('is-drop-before', index === targetIndex && targetIndex < state.fromIndex)
        item.classList.toggle('is-drop-after', index === targetIndex && targetIndex > state.fromIndex)
      })
    }
    const finishOrder = (state, cancelled) => {
      if (orderDrag !== state) return Promise.resolve()
      orderDrag = null
      const target = state.rows[state.targetIndex]
      const shouldMove = !cancelled && state.moved && target && state.targetIndex !== state.fromIndex
      const result = shouldMove
        ? moveReference(node.id, state.fromKey, target.dataset.reference, state.targetIndex < state.fromIndex)
        : Promise.resolve()
      return result.finally(() => clearOrderVisuals(state))
    }
    refs.forEach((ref, index) => {
      const asset = ref.assetId ? s.state.assets[ref.assetId] : null, emptySlot = !asset && ref.source === 'direct'
      const acceptsImagePaste = emptySlot ? (!model || model.mediaFields.some(field => field.kind === 'image')) : ref.kind === 'image'
      const row = el('div', { class: 'studio-reference-row' + (emptySlot ? ' is-empty' : ''), 'data-reference': ref.key })
      const grip = el('button', { type: 'button', class: 'studio-reference-grip', title: '拖动调整顺序，或使用上下方向键', 'aria-label': `调整参考素材 ${index + 1} 顺序` }, '⠿')
      grip.onpointerdown = event => {
        if (event.button !== 0 || orderDrag) return
        const rows = [...list.querySelectorAll('.studio-reference-row')]
        const height = row.getBoundingClientRect().height || row.offsetHeight || 54
        orderDrag = {
          row, grip, pointerId: event.pointerId, startY: event.clientY, moved: false,
          fromIndex: rows.indexOf(row), targetIndex: rows.indexOf(row), rows, height,
          rects: new Map(rows.map(item => [item, item.getBoundingClientRect()])),
          fromKey: ref.key,
        }
        event.preventDefault(); event.stopPropagation()
        row.classList.add('is-pointer-dragging')
        list.classList.add('is-reordering')
        grip.setPointerCapture?.(event.pointerId)
      }
      grip.onpointermove = event => { if (orderDrag && event.pointerId === orderDrag.pointerId) moveOrder(orderDrag, event.clientY) }
      grip.onpointerup = view.safe(event => {
        const state = orderDrag
        if (!state || event.pointerId !== state.pointerId) return
        event.preventDefault()
        return finishOrder(state, false)
      })
      grip.onpointercancel = () => { if (orderDrag) return finishOrder(orderDrag, true) }
      grip.onlostpointercapture = () => { if (orderDrag) return finishOrder(orderDrag, true) }
      grip.onkeydown = view.safe(async event => {
        if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return
        event.preventDefault()
        const target = refs[index + (event.key === 'ArrowUp' ? -1 : 1)]
        if (target) await moveReference(node.id, ref.key, target.key, event.key === 'ArrowUp')
      })
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
            const required = candidates.filter(field => field.required), implicit = candidates.length > 1 && refs.filter(item => item.kind === ref.kind).length === 1 && required.length === 1 ? required[0].path : ''
            const select = el('select', { 'aria-label': `参考素材 ${index + 1} 输入位置` })
            select.append(el('option', { value: '' }, candidates.length === 1 ? '自动 → ' + candidates[0].label : '选择输入位置 *'))
            for (const field of candidates) {
              const label = field.kind === 'image' && field.name === 'image' && candidates.some(item => /(^|_)(last|end|tail)(_|$)/i.test(item.name)) ? '首帧（image）' : field.label
              select.append(el('option', { value: field.path }, label + (field.array ? `（最多 ${field.max} 份）` : '（1 份）')))
            }
            select.value = binding || implicit
            select.onchange = view.safe(async () => {
              await flush(); const current = s.board().nodes.find(item => item.id === node.id), bindings = structuredClone(current.referenceBindings || {})
              bindings[key] ||= {}; if (select.value) bindings[key][ref.key] = select.value; else delete bindings[key][ref.key]
              await edit([{ type: 'update', id: node.id, patch: { referenceBindings: bindings } }])
            }); detail.append(select)
          } else detail.append(el('small', { class: 'studio-field-error' }, '此模型不接受这类参考，请移除'))
        } else if (provider && !provider.modelCatalog && ref.kind === 'video') detail.append(el('small', { class: 'studio-field-error' }, '此服务不接受视频参考'))
      } else if (emptySlot) detail.append(el('span', {}, `${index + 1}. 空槽位`), el('small', {}, '点击空白处选中粘贴，或点左侧 ＋ 选择'))
      else detail.append(el('span', { title: ref.title }, `${index + 1}. 素材不可用`), el('small', {}, ref.source === 'edge' ? '连线参考' : '卡片内参考'))
      const controls = el('div', { class: 'studio-reference-controls' })
      if (asset && ref.kind === 'image') {
        const quick = button('快速编辑', () => quickEdit.open(node, ref, asset), 'studio-reference-quick')
        quick.setAttribute('aria-label', `快速编辑参考素材 ${index + 1}`)
        quick.title = '快速编辑：在图片上画线，保存为新的参考图'
        const replace = button('快速替换', () => pick(node, ref.id, { mode: 'replace', edgeId: ref.edgeId, referenceKey: ref.key }), 'studio-reference-replace')
        replace.setAttribute('aria-label', `快速替换参考素材 ${index + 1}`)
        replace.title = '快速替换：从素材库选择另一张图片'
        controls.append(quick, replace)
      }
      const remove = button('×', async () => {
        await flush()
        if (ref.edgeId) await edit([{ type: 'disconnect', id: ref.edgeId }])
        else { const current = s.board().nodes.find(item => item.id === node.id); await edit([{ type: 'update', id: node.id, patch: { references: current.references.filter(item => 'direct:' + item.id !== ref.key) } }]) }
      }); remove.setAttribute('aria-label', `参考素材 ${index + 1} ${ref.source === 'edge' ? '断开连线' : '移除'}`); controls.append(remove)
      row.append(detail, controls); list.append(row)
      row.tabIndex = 0
      row.setAttribute('role', 'option')
      row.setAttribute('aria-selected', String(selectedReference?.boardId === s.boardId && selectedReference.nodeId === node.id && selectedReference.key === ref.key))
      if (selectedReference?.boardId === s.boardId && selectedReference.nodeId === node.id && selectedReference.key === ref.key) row.classList.add('is-selected')
      row.onclick = event => {
        if (event.target.closest('button,select,a,input,textarea')) return
        if (!acceptsImagePaste) { sdk.toast('此槽位不是图片参考，不能粘贴图片'); return }
        const boardId = s.boardId
        clearReferenceVisuals()
        selectedReference = { boardId, nodeId: node.id, key: ref.key }
        row.classList.add('is-selected'); row.setAttribute('aria-selected', 'true')
        pasteHint.hidden = false
        view.focusReference({
          boardId, nodeId: node.id, refKey: ref.key,
          valid: () => {
            const board = s.state.boards.find(item => item.id === boardId), current = board?.nodes.find(item => item.id === node.id)
            if (!current) return false
            const types = new Map((s.state.types || []).map(type => [type.id, type]))
            return referenceInputs(board, current, s.state.assets, types).some(item => item.key === ref.key)
          },
          clear: () => { selectedReference = null; clearReferenceVisuals() },
          apply: assetId => replaceReference(assetId, { boardId, nodeId: node.id, slotId: ref.id, edgeId: ref.edgeId, mode: 'replace' }),
        })
        row.focus({ preventScroll: true })
      }
      row.onpointerdown = event => event.stopPropagation()
      const acceptsAsset = event => [...(event.dataTransfer?.types || [])].includes(ASSET_DRAG_TYPE)
      row.ondragenter = event => {
        if (!acceptsAsset(event)) return
        event.preventDefault(); event.stopPropagation(); row.classList.add('is-asset-drop')
      }
      row.ondragover = event => {
        if (!acceptsAsset(event)) return
        event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'; row.classList.add('is-asset-drop')
      }
      row.ondragleave = event => { if (!row.contains(event.relatedTarget)) row.classList.remove('is-asset-drop') }
      row.ondrop = view.safe(async event => {
        if (!acceptsAsset(event)) return
        event.preventDefault(); event.stopPropagation(); row.classList.remove('is-asset-drop')
        const assetId = event.dataTransfer.getData(ASSET_DRAG_TYPE), asset = s.state.assets[assetId]
        if (!asset) throw Error('素材已不存在')
        if (!acceptedKinds.has(mediaKind(asset))) throw Error((model?.id || provider?.label || '当前模型') + '不接受' + (mediaKind(asset) === 'video' ? '视频' : '图片') + '参考')
        const targetRef = { boardId: s.boardId, nodeId: node.id, slotId: ref.id, mode: emptySlot ? 'select' : 'replace', edgeId: ref.edgeId, referenceKey: ref.key }
        if (emptySlot) await assign(ref.id, assetId, targetRef)
        else await replaceReference(assetId, targetRef)
      })
    })
    if (!refs.length) list.append(el('small', {}, '尚未添加参考素材'))
    if (model?.mediaFields.length) section.append(el('small', { class: 'studio-media-limits' }, model.mediaFields.map(field => `${field.label}${field.required ? ' *' : ''}：${field.kind === 'video' ? '视频' : '图片'} ${field.min}–${field.max} 份`).join('；')))
    const add = button('＋ 添加参考', () => addSlot(node), 'studio-reference-add')
    add.setAttribute('aria-label', '添加参考素材')
    pasteHint.hidden = !(selectedReference?.boardId === s.boardId && selectedReference.nodeId === node.id)
    section.append(list, add, pasteHint); return section
  }
}
