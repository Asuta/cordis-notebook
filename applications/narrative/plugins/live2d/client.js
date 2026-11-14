import { createPanel } from './panel.js'
import { createSurface } from './surface.js'
import { motionRequest } from './helpers.js'

export default function live2dPlugin(ctx) {
  const engine = ctx.narrative, ui = ctx.narrativeUI
  const panels = new Set(), surfaces = new Set()
  let disposed = false
  function mount(factory, set, container) {
    const view = factory(engine, container); set.add(view)
    return () => { set.delete(view); view.dispose() }
  }
  ui.registerSurface(ctx, { id: 'live2d', order: 20, mount: container => mount(createSurface, surfaces, container) })
  ui.registerPanel(ctx, { id: 'live2d', label: 'Live2D 角色', icon: 'Sparkles', order: 35, render: container => mount(createPanel, panels, container) })
  engine.observe(ctx, event => {
    if (disposed || event && !['project', 'selection', 'runtime', 'mode', 'status'].includes(event.type)) return
    for (const view of panels) view.sync()
    for (const view of surfaces) view.sync()
  })
  async function execute(type, value) {
    if (disposed) return
    if (!surfaces.size) throw Error('Live2D 舞台叠层尚未挂载')
    await Promise.all([...surfaces].map(surface => surface.action(type, value)))
  }
  engine.registerAction(ctx, {
    type: 'live2d-expression', label: 'Live2D 表情',
    fields: [{ key: 'value', label: '表情', kind: 'expression', default: 'neutral' }],
    async execute(action) {
      if (typeof action.value !== 'string' || !action.value.trim()) throw Error('Live2D 表情需要 value（neutral / happy / sad 或模型表情 Name）')
      if (engine.mode === 'play') engine.transact(runtime => { runtime.stage.expression = action.value.trim() })
      await execute('expression', action.value.trim())
    },
  })
  engine.registerAction(ctx, {
    type: 'live2d-motion', label: 'Live2D 动作',
    fields: [
      { key: 'group', label: '动作组', kind: 'string', default: 'Idle' },
      { key: 'index', label: '动作序号', kind: 'number', default: 0 },
    ],
    execute: action => execute('motion', motionRequest(action)),
  })
  ctx.effect(() => () => {
    disposed = true
    for (const view of [...panels, ...surfaces]) view.dispose()
    panels.clear(); surfaces.clear()
  })
}
