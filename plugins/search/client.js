export default function(ctx, sdk) {
  const model = ctx.notebook, label = sdk.el('label', { class: 'search' }), input = sdk.el('input', { type: 'search', placeholder: '搜索标题或内容…', 'aria-label': '搜索笔记' }); label.append(input); sdk.mount('list-filters', label)
  const filter = model.registerFilter(ctx, 'search', () => true)
  sdk.listen(input, 'input', () => { const query = input.value.toLocaleLowerCase(); filter.update(note => (note.title + '\n' + note.content).toLocaleLowerCase().includes(query)) })
  sdk.listen(document, 'keydown', event => { if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); input.focus() } })
}
