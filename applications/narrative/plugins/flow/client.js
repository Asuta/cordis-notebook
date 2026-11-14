import { createFlowHandlers } from './model.js'
import { mountFlowEditor } from './editor.js'

export default function (ctx) {
  const engine = ctx.narrative, ui = ctx.narrativeUI, observers = new Set(), mounts = new Set()
  const observe = callback => { observers.add(callback); return () => observers.delete(callback) }
  engine.observe(ctx, event => { for (const callback of [...observers]) callback(event) })
  for (const handler of Object.values(createFlowHandlers(engine))) engine.registerNode(ctx, handler)
  ui.registerPanel(ctx, { id: 'flow', label: '剧情流程', icon: 'GitBranch', order: 20, render(container) {
    const dispose = mountFlowEditor(engine, container, observe)
    const cleanup = () => { mounts.delete(cleanup); dispose() }
    mounts.add(cleanup)
    return cleanup
  } })
  ctx.effect(() => () => { for (const dispose of [...mounts]) dispose(); observers.clear() })
}
