export const inject = ['notebook']
export default function(ctx, sdk) { const text = sdk.el('span', { id: 'word-count' }); sdk.mount('footer', text); sdk.watch(ctx.notebook, () => { text.textContent = `${Array.from((ctx.notebook.current()?.content || '').replace(/\s/g, '')).length} 字` }) }
