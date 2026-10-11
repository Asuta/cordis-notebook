import { paragraphSummary } from './paragraphs.js'

/** 只消费公开的 notebook 服务与 shell 的 footer 扩展位，不依赖其他插件的内部 DOM。 */
export default function (ctx, sdk) {
  const root = sdk.el('div', { class: 'paragraph-count' })
  root.setAttribute('role', 'group')
  root.setAttribute('aria-label', '段落计数')
  const caption = sdk.el('span', { class: 'paragraph-count-caption' }, '段落')
  const value = sdk.el('span', { class: 'paragraph-count-value' })
  root.append(caption, value)
  sdk.mount('footer', root)

  const render = () => {
    const summary = paragraphSummary(ctx.notebook.current())
    value.textContent = summary.value
    root.dataset.state = summary.state
    root.title =
      summary.state === 'ready'
        ? `当前笔记共 ${summary.paragraphs} 个非空段落（按空行分段）`
        : summary.state === 'no-note'
          ? '选择一篇笔记后显示非空段落数'
          : summary.state === 'empty'
            ? '当前笔记正文为空，没有可统计的段落'
            : '当前笔记格式不支持段落计数，仅支持普通笔记与 Markdown'
  }
  // 编辑正文与切换笔记都会触发 notebook/changed（订阅时立即渲染一次）；
  // 订阅与节点都由 ctx 和挂载点拥有，停用时自动释放，重新启用只挂载一份。
  ctx.notebook.observe(ctx, render)
}
