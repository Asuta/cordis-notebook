export const inject = ['notebook']
export default function(ctx, sdk) {
  const model = ctx.notebook, writing = sdk.el('div', { class: 'writing' }), title = sdk.el('input', { id: 'title', placeholder: '无标题笔记', maxLength: 200, 'aria-label': '笔记标题' }), content = sdk.el('textarea', { id: 'content', placeholder: '写下此刻的想法…', maxLength: 200000, 'aria-label': '笔记正文' })
  const empty = sdk.el('div', { class: 'empty' }); empty.append(sdk.el('h2', {}, '给想法，一点留白。'), sdk.el('p', {}, '点击左侧「新建」，留下第一篇笔记。'))
  writing.append(title, content); sdk.mount('editor', writing); sdk.mount('editor', empty)
  const dialog = sdk.el('dialog'), yes = sdk.el('button', { class: 'danger' }, '删除笔记'), no = sdk.el('button', {}, '取消'), actions = sdk.el('div')
  actions.append(no, yes); dialog.append(sdk.el('h2', {}, '删除这篇笔记？'), sdk.el('p', {}, '删除后无法恢复，可以先导出文本。'), actions); sdk.mount('app', dialog)
  const remove = sdk.button('toolbar', '删除', () => dialog.showModal()); remove.setAttribute('aria-label', '删除笔记')
  sdk.listen(no, 'click', () => dialog.close()); sdk.listen(yes, 'click', async () => { yes.disabled = true; try { await model.remove(); dialog.close() } catch (error) { sdk.toast(error.message) } finally { yes.disabled = false } })
  sdk.listen(title, 'input', () => model.edit({ title: title.value })); sdk.listen(content, 'input', () => model.edit({ content: content.value }))
  sdk.watch(model, () => {
    const note = model.current(); writing.hidden = !note; empty.hidden = !!note; remove.disabled = !note || model.busy; title.disabled = content.disabled = model.busy
    if (title.value !== (note?.title || '')) title.value = note?.title || ''
    if (content.value !== (note?.content || '')) content.value = note?.content || ''
  })
}
