import { textInputs } from './snapshot.js'

export function createCardLayout(ctx, view, s, sdk) {
  const { el, button, safe, edit, flush } = view
  let resizing
  function cancel() { if (!resizing) return; const gesture = resizing; resizing = null; view.endEditing(gesture.handle); view.render() }
  sdk.listen(window, 'blur', cancel)
  ctx.effect(() => () => { if (resizing) { view.endEditing(resizing.handle); resizing = null } })
  return {
    parameter(node, key, path, label, value, row, collapsed) {
      const folded = (node.collapsedParameters?.[key] || []).includes(path)
      const toggle = button(folded ? '展开' : '收起', async () => {
        await flush(); const current = s.board().nodes.find(item => item.id === node.id), settings = structuredClone(current.collapsedParameters || {})
        const paths = new Set(settings[key] || []); if (folded) paths.delete(path); else paths.add(path); settings[key] = [...paths]
        await edit([{ type: 'update', id: node.id, patch: { collapsedParameters: settings } }])
      })
      toggle.setAttribute('aria-label', (folded ? '展开参数 ' : '收起参数 ') + label)
      if (folded) {
        const summary = el('div', { class: 'studio-collapsed-parameter', 'data-collapsed-parameter': path })
        summary.append(el('span', { title: JSON.stringify(value) }, label + '：' + (value === undefined ? '未指定' : typeof value === 'string' ? value : JSON.stringify(value))), toggle)
        collapsed.append(summary); collapsed.hidden = false; return null
      }
      const heading = el('div', { class: 'studio-parameter-heading' }); heading.append(el('span', {}, label), toggle); row.prepend(heading); return row
    },
    texts(node) {
      const section = el('div', { class: 'studio-inputs' }), types = new Map((s.state.types || []).map(type => [type.id, type]))
      const refs = textInputs(s.board(), node, types, { tolerant: true })
      if (refs.length) section.append(el('small', {}, '文字输入顺序'))
      refs.forEach((ref, index) => {
        const row = el('div', { class: 'studio-text-reference' }), head = el('div', { class: 'studio-text-reference-head' })
        head.append(el('span', {}, `${index + 1}. ${ref.title || '文字输入'}${ref.edgeId ? '' : ' · 独立内容'}`))
        for (const [label, delta] of [['↑', -1], ['↓', 1]]) {
          const move = button(label, async () => {
            await flush(); const order = refs.map(ref => ref.key); [order[index], order[index + delta]] = [order[index + delta], order[index]]
            await edit([{ type: 'update', id: node.id, patch: { textReferenceOrder: order } }])
          }); move.disabled = index + delta < 0 || index + delta >= refs.length; head.append(move)
        }
        head.append(button('×', async () => {
          await flush()
          if (ref.edgeId) await edit([{ type: 'disconnect', id: ref.edgeId }])
          else { const current = s.board().nodes.find(item => item.id === node.id); await edit([{ type: 'update', id: node.id, patch: { textReferences: current.textReferences.filter(item => item.id !== ref.id) } }]) }
        })); row.append(head)
        if (ref.unavailable) row.append(el('small', { class: 'studio-field-error', role: 'status', 'data-input-unavailable': '' }, '文字输入暂不可用，请检查来源卡片或对应插件。'))
        if (!ref.edgeId) {
          const input = el('textarea', { value: ref.text, maxLength: 24000, 'aria-label': `独立文字输入 ${index + 1}` })
          input.onfocus = () => view.beginEditing(input)
          input.oninput = () => { const values = structuredClone(s.drafts.get(node.id)?.patch.textReferences || node.textReferences); values.find(item => item.id === ref.id).text = input.value; s.draft(node, 'textReferences', values) }
          input.onblur = safe(async () => { try { await flush() } finally { view.endEditing(input); view.render() } }); row.append(input)
        }
        section.append(row)
      }); return section
    },
    resize(node, card) {
      if (node.cardHeight) { card.style.height = node.cardHeight + 'px'; card.style.maxHeight = 'none' }
      const handle = el('div', { class: 'studio-card-resize', role: 'separator', tabIndex: 0, title: '上下拖拽调整卡片高度', 'aria-label': '调整生成卡片高度', 'aria-orientation': 'horizontal' }, '······')
      handle.onpointerdown = event => {
        if (event.button !== 0 || resizing) return
        event.preventDefault(); event.stopPropagation(); const boardId = s.boardId, height = card.offsetHeight || node.cardHeight || 720
        resizing = { handle, boardId, nodeId: node.id, y: event.clientY, height, value: height, pointerId: event.pointerId, zoom: s.viewport.zoom }
        view.beginEditing(handle); handle.setPointerCapture?.(event.pointerId)
      }
      handle.onpointermove = event => {
        if (resizing?.handle !== handle || resizing.pointerId !== event.pointerId) return
        resizing.value = Math.max(360, Math.min(20000, Math.round(resizing.height + (event.clientY - resizing.y) / resizing.zoom)))
        card.style.maxHeight = 'none'; card.style.height = resizing.value + 'px'
      }
      const finish = safe(async event => {
        if (resizing?.handle !== handle || resizing.pointerId !== event.pointerId) return
        const gesture = resizing; resizing = null
        try {
          if (event.type !== 'pointercancel' && s.boardId === gesture.boardId) { s.draft(node, 'cardHeight', gesture.value); await flush() }
        } finally { view.endEditing(handle); view.render() }
      })
      handle.onpointerup = finish; handle.onpointercancel = finish
      handle.onlostpointercapture = cancel
      handle.onkeydown = safe(async event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); return }
        if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return
        event.preventDefault(); event.stopPropagation(); await flush()
        s.draft(node, 'cardHeight', Math.max(360, Math.min(20000, (node.cardHeight || card.offsetHeight || 720) + (event.key === 'ArrowUp' ? -40 : 40)))); await flush()
      })
      card.append(handle)
    },
  }
}
