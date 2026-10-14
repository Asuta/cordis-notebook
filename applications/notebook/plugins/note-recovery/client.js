export default function(ctx, sdk) {
  const el = sdk.el, model = ctx.notebook
  let disposed = false, busy = false, generation = 0, selected, mode = 'history'
  const dialog = el('dialog', { class: 'note-recovery', 'aria-labelledby': 'recovery-title' })
  const list = el('div', { class: 'recovery-list' }), preview = el('pre', { class: 'recovery-preview', 'aria-label': '版本内容预览' })
  const status = el('p', { role: 'status' }), restore = el('button', { type: 'button' }, '恢复所选记录')
  const purge = el('button', { type: 'button', hidden: true }, '永久删除'), close = el('button', { type: 'button' }, '关闭')
  const tabs = el('div', { class: 'recovery-actions' }), columns = el('div', { class: 'recovery-columns' })
  for (const [key, title] of [['history', '当前页面历史'], ['trash', '回收站']]) {
    const button = el('button', { type: 'button' }, title); tabs.append(button)
    sdk.listen(button, 'click', () => { if (!busy) { mode = key; void load() } })
  }
  columns.append(list, preview)
  const actions = el('div', { class: 'recovery-actions' }); actions.append(restore, purge, close)
  dialog.append(el('h2', { id: 'recovery-title' }, '历史与回收站'), tabs,
    el('p', {}, '历史记录保留每页最近 50 次保存前版本，总量上限 32 MB。回收站不会自动清空。预览显示文字，恢复会保留完整格式。父页面已失效时恢复到顶层；子页面保持当前位置。'),
    columns, status, actions)
  sdk.mount('panels', dialog)
  const trigger = sdk.button('toolbar', '历史与回收站', () => setTimeout(() => { if (!disposed) { dialog.showModal(); void load() } }, 0))
  trigger.setAttribute('aria-label', '历史与回收站')
  const refresh = () => { restore.disabled = purge.disabled = busy || model.busy || model.conflict || !selected; close.disabled = busy; trigger.disabled = model.busy }
  async function load() {
    const token = ++generation, id = model.selected
    selected = undefined; purge.textContent = '永久删除'; purge.hidden = mode !== 'trash'
    list.replaceChildren(); preview.textContent = ''; status.textContent = '正在读取…'; refresh()
    try {
      const entries = mode === 'trash' ? await sdk.request('/api/note-trash') : id ? await sdk.request('/api/note-history/' + id) : []
      if (disposed || token !== generation) return
      status.textContent = entries.length ? '请选择记录预览，确认后恢复。' : '暂无记录'
      for (const entry of entries) {
        const item = el('button', { type: 'button', class: 'recovery-entry' }, (entry.note.title || '无标题笔记') + ' · ' + new Date(entry.deletedAt || entry.capturedAt).toLocaleString() + ' · v' + entry.note.revision)
        item.addEventListener('click', () => {
          if (busy) return
          selected = entry; purge.textContent = '永久删除'
          preview.textContent = (entry.note.title || '无标题笔记') + '\n\n' + (entry.note.content || '（无文字内容；图片和格式仍会完整恢复）')
          for (const button of list.children) button.setAttribute('aria-pressed', String(button === item))
          refresh()
        })
        list.append(item)
      }
    } catch (error) { if (!disposed && token === generation) status.textContent = error.message }
    refresh()
  }
  async function run(action) {
    if (busy || model.busy || !selected) return
    busy = true; refresh()
    try { await action(); if (!disposed) await load() }
    catch (error) { if (!disposed) status.textContent = error.message }
    finally { busy = false; if (!disposed) refresh() }
  }
  const restoreEntry = entry => model.restoreNote(current => {
    if (mode === 'trash') return sdk.request('/api/note-trash/' + entry.id + '/restore', 'POST', {})
    if (current?.id !== entry.note.id) throw Error('页面已切换，请重新选择历史记录')
    return sdk.request('/api/note-history/' + entry.note.id + '/restore', 'POST', { versionId: entry.id, revision: current.revision })
  })
  sdk.listen(restore, 'click', () => run(() => restoreEntry(selected)))
  sdk.listen(purge, 'click', () => {
    if (purge.textContent !== '确认永久删除') { purge.textContent = '确认永久删除'; status.textContent = '再次点击会永久删除此页及其历史记录，此操作无法恢复。'; return }
    void run(() => sdk.request('/api/note-trash/' + selected.id, 'DELETE'))
  })
  sdk.listen(close, 'click', () => dialog.close())
  sdk.listen(dialog, 'cancel', event => { if (busy) event.preventDefault() })
  model.observe(ctx, event => { refresh(); if (dialog.open && !busy && event?.reason === 'selection') void load() })
  sdk.agent.register({ name: 'notebook_history', description: '读取页面的已保存历史版本（id 省略为当前页）；trash:true 读取回收站。每项有稳定记录 id 和完整 note，可预览后恢复。', inputSchema: { type: 'object', properties: { id: { type: 'string' }, trash: { type: 'boolean' } }, additionalProperties: false } }, ({ id = model.selected, trash = false } = {}) => {
    if (disposed) throw Error('恢复工具已停用')
    if (!trash && !id) throw Error('请指定页面')
    return sdk.request(trash ? '/api/note-trash' : '/api/note-history/' + encodeURIComponent(id))
  })
  sdk.agent.register({ name: 'notebook_restore', description: '恢复历史版本或回收站记录。kind=history 时必须先打开目标页并提供 notebook_history 返回的 entryId、noteId 和当前已保存的数值 revision；kind=trash 按 entryId 恢复原 ID。恢复历史会保留覆盖前版本；失效父关系改为顶层。', inputSchema: { type: 'object', properties: { kind: { enum: ['history', 'trash'] }, entryId: { type: 'string' }, noteId: { type: 'string' }, revision: { type: 'integer' } }, required: ['kind', 'entryId'], additionalProperties: false } }, async args => {
    if (disposed || model.busy || model.conflict) throw Error('当前不可恢复')
    return model.restoreNote(current => {
      if (disposed) throw Error('恢复工具已停用')
      if (args.kind === 'trash') return sdk.request('/api/note-trash/' + encodeURIComponent(args.entryId) + '/restore', 'POST', {})
      if (args.kind !== 'history' || current?.id !== args.noteId || current.revision !== args.revision) throw Error('页面或版本已变化，请重新读取')
      return sdk.request('/api/note-history/' + encodeURIComponent(args.noteId) + '/restore', 'POST', { versionId: args.entryId, revision: args.revision })
    })
  })
  ctx.effect(() => () => { disposed = true; generation++; if (dialog.open) dialog.close() })
}
