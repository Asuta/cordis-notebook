export default function(ctx, sdk) {
  const views = new Map()
  const model = ctx.notebook, writing = sdk.el('div', { class: 'writing editor-writing' }), title = sdk.el('input', { id: 'title', placeholder: '无标题笔记', maxLength: 200, spellcheck: false, 'aria-label': '笔记标题' }), content = sdk.el('div', { class: 'note-editor-body' })
  const missing = sdk.el('p', { class: 'editor-missing' })
  const renderView = () => {
    const note = model.current(), type = ctx.noteFormats.typeOf(note), format = ctx.noteFormats.get(type)
    writing.className = 'writing editor-writing ' + (format?.editorClass || '')
    title.disabled = model.busy || !model.editable
    for (const [key, node] of views) node.hidden = !format || key !== format.editor
    missing.hidden = !note || !!format && views.has(format.editor)
    missing.textContent = format ? `请启用“${format.label}”对应的编辑器，笔记内容仍然保留。` : `笔记格式“${type}”不可用，请启用对应格式插件。笔记内容仍然保留。`
  }
  sdk.provide('editorHost', { register(owner, type, node) {
    if (views.has(type)) throw new Error('此格式已有编辑器：' + type)
    return owner.effect(() => { views.set(type, node); content.append(node); renderView(); return () => { if (views.get(type) === node) views.delete(type); node.remove(); renderView() } })
  } })
  const empty = sdk.el('div', { class: 'empty' }); empty.append(sdk.el('h2', {}, '给想法，一点留白。'), sdk.el('p', {}, '点击左侧「新建」，留下第一篇笔记。'))
  writing.append(title, content, missing); sdk.mount('editor', writing); sdk.mount('editor', empty)
  const dialog = sdk.el('dialog'), yes = sdk.el('button', { class: 'danger' }, '删除笔记'), no = sdk.el('button', {}, '取消'), actions = sdk.el('div')
  actions.append(no, yes); dialog.append(sdk.el('h2', {}, '删除这篇笔记？'), sdk.el('p', {}, '删除后无法恢复，可以先导出文本。'), actions); sdk.mount('app', dialog)
  const remove = sdk.button('toolbar', '删除', () => dialog.showModal()); remove.setAttribute('aria-label', '删除笔记')
  sdk.listen(no, 'click', () => dialog.close()); sdk.listen(yes, 'click', async () => { yes.disabled = true; try { await model.remove(); dialog.close() } catch (error) { sdk.toast(error.message) } finally { yes.disabled = false } })
  sdk.listen(title, 'input', () => model.edit({ title: title.value }))
  model.observe(ctx, () => {
    const note = model.current(); writing.hidden = !note; empty.hidden = !!note; remove.disabled = !note || model.busy; title.disabled = content.disabled = model.busy
    if (title.value !== (note?.title || '')) title.value = note?.title || ''
    renderView()
  })
}
