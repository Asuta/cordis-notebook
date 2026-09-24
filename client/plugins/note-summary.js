/** A consumer using only owned UI mounts and the public saved event. */
export default function (ctx, sdk) {
  const panel = sdk.el('section', { class: 'note-summary', 'aria-label': '最近保存摘要' })
  const title = sdk.el('h3', {}, '最近保存摘要'), excerpt = sdk.el('p', {}, '保存一篇笔记后，这里会显示正文开头。'), detail = sdk.el('small')
  panel.append(title, excerpt, detail)
  ctx.shell.mount(ctx, 'panels', panel)
  ctx.on('notebook/saved', note => {
    title.textContent = '最近保存 · ' + (note.title || '无标题笔记')
    const text = note.content.replace(/\s+/g, ' ').trim()
    excerpt.textContent = text ? text.slice(0, 120) + (text.length > 120 ? '…' : '') : '这篇笔记还没有正文。'
    detail.textContent = `${Array.from(note.content).length} 字符 · 已保存到本地`
  })
}
