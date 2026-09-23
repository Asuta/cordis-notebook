export const inject = ['notebook']
export default function(ctx, sdk) {
  const model = ctx.notebook, label = sdk.el('label', { class: 'search' }), input = sdk.el('input', { type: 'search', placeholder: '搜索标题或内容…', 'aria-label': '搜索笔记' }); label.append(input); sdk.mount('list-filters', label)
  sdk.listen(input, 'input', () => { const query = input.value.toLocaleLowerCase(); model.filters.set('search', note => (note.title + '\n' + note.content).toLocaleLowerCase().includes(query)); model.notify() })
  sdk.effect(() => () => { model.filters.delete('search'); model.notify() })
  sdk.listen(document, 'keydown', event => { if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); input.focus() } })
}
