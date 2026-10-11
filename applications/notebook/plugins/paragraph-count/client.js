import { paragraphSummary } from './paragraph.js'

/** 只消费公开的 notebook 服务与 shell 的 footer 扩展位，不依赖其他插件的内部 DOM。 */
export default function (ctx, sdk) {
  const root = sdk.el('div', { class: 'paragraph-count' })
  root.setAttribute('role', 'group')
  root.setAttribute('aria-label', '段落计数')
  const value = sdk.el('span', { class: 'paragraph-count-value' })
  root.append(value)
  sdk.mount('footer', root)

  const render = () => {
    const summary = paragraphSummary(ctx.notebook.current())
    value.textContent = summary.value
    root.dataset.state = summary.state
    root.title =
      summary.state === 'ready'
        ? `共 ${summary.paragraphs} 个非空段落，按空行分段`
        : summary.state === 'no-note'
          ? '选择一篇笔记后显示段落数'
          : '当前笔记正文为空，写点内容后显示段落数'
  }
  // 编辑正文与切换笔记都会触发 notebook/changed（订阅时立即渲染一次）；
  // 订阅和节点都由 ctx 与挂载点拥有，停用时自动释放。
  ctx.notebook.observe(ctx, render)
}
