export default function(ctx, sdk) {
  const text = sdk.el('span', { id: 'word-count' }); sdk.mount('footer', text)
  const render = () => {
    const content = ctx.notebook.current()?.content || ''
    text.textContent = `${Array.from(sdk.config.includeWhitespace ? content : content.replace(/\s/g, '')).length} 字`
  }
  ctx.notebook.observe(ctx, render); sdk.onConfig(render)
}
