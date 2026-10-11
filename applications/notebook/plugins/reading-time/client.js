import { DEFAULT_CHARS_PER_MINUTE, readingSummary } from './reading.js'

/** 只消费公开的 notebook 服务与 shell 的 footer 扩展位，不依赖其他插件的内部 DOM。 */
export default function (ctx, sdk) {
  const root = sdk.el('div', { class: 'reading-time' })
  root.setAttribute('role', 'group')
  root.setAttribute('aria-label', '预计阅读时长')
  const caption = sdk.el('span', { class: 'reading-time-caption' }, '阅读')
  const value = sdk.el('span', { class: 'reading-time-value' })
  root.append(caption, value)
  sdk.mount('footer', root)

  const rate = () => {
    const configured = Number(sdk.config.charsPerMinute)
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_CHARS_PER_MINUTE
  }
  const render = () => {
    const summary = readingSummary(ctx.notebook.current(), rate())
    value.textContent = summary.value
    root.dataset.state = summary.state
    root.title =
      summary.state === 'ready'
        ? `预计阅读时长 ${summary.value}，按每分钟 ${rate()} 个非空白字符估算，共 ${summary.characters} 个非空白字符`
        : summary.state === 'no-note'
          ? '选择一篇笔记后显示预计阅读时长'
          : '当前笔记正文为空，写点内容后显示预计阅读时长'
  }
  // 编辑正文与切换笔记都会触发 notebook/changed（订阅时立即渲染一次）；
  // 订阅、配置监听和节点都由 ctx 与挂载点拥有，停用时自动释放。
  ctx.notebook.observe(ctx, render)
  sdk.onConfig(render)
}
