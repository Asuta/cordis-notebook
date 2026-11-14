import { registerRules } from './engine.js'
import { mountRulesEditor } from './editor.js'

export default function (ctx) {
  const engine = ctx.narrative, ui = ctx.narrativeUI, observers = new Set(), mounts = new Set()
  const observe = callback => { observers.add(callback); return () => observers.delete(callback) }
  engine.observe(ctx, event => { for (const callback of [...observers]) callback(event) })
  function track(dispose) {
    let active = true
    const cleanup = () => { if (!active) return; active = false; mounts.delete(cleanup); dispose() }
    mounts.add(cleanup); return cleanup
  }
  registerRules(ctx, engine)
  ui.registerPanel(ctx, { id: 'rules', label: '属性与规则', icon: 'SlidersHorizontal', order: 40, render(container) {
    return track(mountRulesEditor(engine, container, observe))
  } })
  ui.registerSurface(ctx, { id: 'attributes', order: 35, mount(container) {
    const root = document.createElement('div')
    root.className = 'ne-attribute-chips'; root.setAttribute('aria-label', '当前属性')
    const format = value => Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '—'
    const render = () => {
      root.replaceChildren()
      const definitions = engine.project.variables
      for (const item of definitions.slice(0, 4)) {
        const chip = document.createElement('span'), name = document.createElement('span'), value = document.createElement('strong')
        chip.className = 'ne-attribute-chip'
        name.textContent = item.name || item.id
        value.textContent = format(engine.mode === 'play' ? engine.runtime?.variables[item.id] : item.initial)
        chip.append(name, value); chip.title = (item.name || item.id) + ' · 范围 ' + item.min + '–' + item.max
        root.append(chip)
      }
      if (definitions.length > 4) {
        const more = document.createElement('span'); more.className = 'ne-attribute-chip'; more.textContent = '＋' + (definitions.length - 4) + ' 项'
        more.title = definitions.slice(4).map(item => (item.name || item.id) + ' ' + format(engine.mode === 'play' ? engine.runtime?.variables[item.id] : item.initial)).join(' · ')
        root.append(more)
      }
      root.hidden = !definitions.length
    }
    container.append(root); const unobserve = observe(render); render()
    return track(() => { unobserve(); root.remove() })
  } })
  ctx.effect(() => () => { for (const cleanup of [...mounts]) cleanup(); observers.clear() })
}
