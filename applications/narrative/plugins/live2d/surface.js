import { createView } from './view.js'
import { configuration, isAbort, missingConfiguration } from './helpers.js'

export function createSurface(engine, container) {
  const workspace = container.closest('.ne-preview') || container.parentElement
  const status = document.createElement('p')
  status.className = 'ne-live2d-stage-status'; status.setAttribute('role', 'status'); status.hidden = true
  container.append(status)
  let view, key = '', generation = 0, disposed = false, lastExpression = ''
  let runtime = null
  function stop() {
    generation++; view?.dispose(); view = null
    workspace?.classList.remove('ne-live2d-active')
    lastExpression = ''; status.hidden = true; status.textContent = ''
  }
  function show(message) { status.textContent = message; status.hidden = !message }
  function snapshot() {
    const stage = engine.runtime?.stage
    const character = engine.project?.characters.find(item => item.id === stage?.characterId)
    const config = configuration(character)
    return { stage, character, config, key: engine.mode !== 'play' || !character || character.meshAvatar ? '' : JSON.stringify([engine.project.id, engine.runtime.nodeId, character.id, config.modelUrl, config.coreUrl]) }
  }
  async function syncExpression(current) {
    const value = current.stage?.expression || 'neutral'
    const signature = JSON.stringify([value, current.config.expressions])
    if (!view || lastExpression === signature) return
    const target = view
    lastExpression = signature
    try { await target.ready; if (view === target) await target.expression(value, current.config.expressions) }
    catch (error) { if (view === target && !isAbort(error)) { lastExpression = ''; show(`Live2D：${error.message}`) } }
  }
  function sync() {
    if (disposed) return
    const current = snapshot()
    if (key === current.key && runtime === engine.runtime) {
      if (view) {
        view.configure(current.config)
        try { view.layout() } catch (error) { stop(); show(`Live2D：${error.message}；使用静态立绘`) }
        void syncExpression(current)
      }
      return
    }
    stop(); key = current.key; runtime = engine.runtime
    if (!key) return
    const missing = missingConfiguration(current.config)
    if (missing.length) {
      if (current.character.live2d) show(`Live2D 未配置${missing.join('、')}，使用静态立绘`)
      return
    }
    const token = generation
    show('Live2D 模型加载中…')
    try {
      const target = createView(container, current.config, {
        stage: () => engine.runtime?.stage || {},
        portrait: () => workspace?.querySelector('.ne-surface-stage .ne-stage-portrait, .ne-surface-stage img.ne-stage-character, .ne-surface-stage .ne-stage-character img'),
        onError(error, detail) {
          if (disposed || token !== generation) return
          if (!detail?.action) { workspace?.classList.remove('ne-live2d-active'); view = null }
          show(`Live2D：${error.message}${detail?.action ? '' : '；使用静态立绘'}`)
        },
      })
      view = target
      target.ready.then(() => {
        if (disposed || token !== generation || view !== target) { target.dispose(); return }
        workspace?.classList.add('ne-live2d-active'); show('')
        void syncExpression(snapshot())
      }).catch(() => {})
    } catch (error) { show(`Live2D：${error.message}；使用静态立绘`) }
  }
  async function action(type, value) {
    if (engine.mode !== 'play') throw Error('Live2D 剧情动作仅在试玩时执行')
    sync()
    const current = view, token = generation
    if (!current) throw Error('当前舞台角色未配置可加载的 Live2D 模型与 Core')
    try {
      await current.ready
      if (disposed || token !== generation || view !== current || engine.mode !== 'play') return
      return await (type === 'motion' ? current.motion(value) : current.expression(value, snapshot().config.expressions))
    } catch (error) {
      if (isAbort(error) || disposed || token !== generation || view !== current || engine.mode !== 'play') return
      throw error
    }
  }
  sync()
  return {
    sync, action,
    dispose() { if (disposed) return; disposed = true; stop(); status.remove() },
  }
}
