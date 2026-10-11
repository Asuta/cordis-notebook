import { paragraphSummary } from './paragraphs.js'

const STATUS_TEXT = {
  'no-note': '未选择笔记',
  empty: '正文为空（0 段）',
  unsupported: '暂不支持该格式',
}

/** 只消费公开的 notebook 服务与 shell 的 footer 扩展位，不读写笔记文件或其他插件 DOM。 */
export default function (ctx, sdk) {
  const root = sdk.el('div', { class: 'plugin-paragraph-count' })
  root.setAttribute('role', 'group')
  root.setAttribute('aria-label', '段落计数')
  const caption = sdk.el('span', { class: 'plugin-paragraph-count-caption' }, '段落')
  const value = sdk.el('span', { class: 'plugin-paragraph-count-value' })
  root.append(caption, value)
  sdk.mount('footer', root)

  const render = () => {
    const summary = paragraphSummary(ctx.notebook.current())
    value.textContent = summary.state === 'ready' ? `${summary.count} 段` : STATUS_TEXT[summary.state]
    root.dataset.state = summary.state
    root.title = summary.state === 'ready'
      ? `按空行分段，当前共 ${summary.count} 个非空段落`
      : STATUS_TEXT[summary.state]
  }
  // 编辑正文与切换笔记都会触发 notebook/changed（订阅时立即渲染一次）；
  // 节点与订阅都由挂载点和 ctx 拥有，停用时释放，重新启用只挂载一份。
  ctx.notebook.observe(ctx, render)
}
