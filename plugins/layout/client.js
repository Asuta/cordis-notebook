import { provideMounts } from './mounts.js'
import { mountLayout } from './view.bundle.js'
export default function (ctx, sdk) {
  const style = sdk.el('link', { rel: 'stylesheet', href: '/builtin/layout/style.css' })
  ctx.effect(() => {
    document.head.append(style)
    return () => style.remove()
  })
  const main = sdk.el('main', { class: 'notebook-shell' })
  sdk.mount('app', main)
  const targets = Object.fromEntries(
    ['sidebar', 'toolbar', 'status', 'editor', 'footer', 'panels'].map((name) => [
      name,
      sdk.el('div', { class: 'slot-' + name })
    ])
  )
  const actions = new Set()
  targets.toolbarEvents = new EventTarget()
  targets.toolbarEntries = () => [...actions]
  const shell = provideMounts(sdk, 'shell', targets, (name, node, added) => {
    if (name !== 'toolbar') return
    if (added) actions.add(node)
    else actions.delete(node)
    targets.toolbarEvents.dispatchEvent(new Event('change'))
  })
  shell.main = main
  shell.showEditor = () => main.dispatchEvent(new Event('show-editor'))
  mountLayout(ctx, sdk, main, targets)
}
