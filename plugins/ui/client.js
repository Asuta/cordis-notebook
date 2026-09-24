import { createUI } from './runtime.bundle.js'
export default function(ctx, sdk) {
  const style = sdk.el('link', { rel: 'stylesheet', href: '/builtin/ui/style.css' })
  ctx.effect(() => { document.head.append(style); return () => style.remove() })
  sdk.provide('ui', createUI())
}
