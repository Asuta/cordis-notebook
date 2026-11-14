import { createModelLoad } from './loader.js'
import { catalog, checkAbort, configuration, isAbort, modelPlacement, motionRequest, untilAborted } from './helpers.js'

export function createView(container, config, { stage = () => ({}), portrait, onError = () => {}, onReady = () => {} } = {}) {
  const root = document.createElement('div')
  root.className = 'ne-live2d-view'
  const canvas = document.createElement('canvas')
  canvas.className = 'ne-live2d-canvas'
  canvas.setAttribute('aria-label', 'Live2D 角色动画')
  canvas.setAttribute('role', 'img')
  root.append(canvas); container.append(root)
  const load = createModelLoad(config)
  let app, model, library, observer, disposed = false, failed = false, currentExpression = '', expressionVersion = 0
  let data = { expressions: [], motions: [] }
  const listeners = []
  const listen = (target, event, handler, options) => {
    target.addEventListener(event, handler, options)
    listeners.push(() => target.removeEventListener(event, handler, options))
  }
  function fail(error) {
    if (disposed || failed || isAbort(error)) return
    failed = true
    // Stop drawing immediately. Release outside a Pixi ticker iteration.
    app?.stop(); root.classList.remove('ne-live2d-ready')
    queueMicrotask(() => { dispose(); onError(error) })
  }
  function layout() {
    if (disposed || !app || !model) return
    const box = root.getBoundingClientRect()
    if (!(box.width > 0 && box.height > 0)) { app.stop(); return }
    app.renderer.resize(box.width, box.height)
    const image = portrait?.()
    const rect = image?.getBoundingClientRect()
    const placement = modelPlacement({
      width: box.width, height: box.height, modelWidth: model.internalModel.width, modelHeight: model.internalModel.height, stage: stage(),
      portrait: rect && { x: rect.left - box.left, y: rect.top - box.top, width: rect.width, height: rect.height },
    })
    if (!placement) throw Error('Live2D 模型尺寸无效')
    model.anchor.set(0.5, 1)
    model.position.set(placement.x, placement.y)
    model.scale.set(placement.scale)
    if (!failed) app.start()
  }
  function point(event) {
    const box = canvas.getBoundingClientRect()
    return { x: (event.clientX - box.left) * app.screen.width / box.width, y: (event.clientY - box.top) * app.screen.height / box.height }
  }
  async function expression(value, mapping = config.expressions) {
    checkAbort(load.signal)
    if (!model) throw Error('Live2D 模型尚未加载')
    const manager = model.internalModel.motionManager.expressionManager
    const name = Object.hasOwn(mapping || {}, value) ? mapping[value] : value
    const version = ++expressionVersion
    if (!name) {
      currentExpression = ''
      if (manager) { manager.reserveExpressionIndex = -1; manager.currentExpression = manager.defaultExpression; manager.resetExpression() }
      return true
    }
    const entry = data.expressions.find(item => item.name === name)
    if (!entry) throw Error(`模型未定义表情“${name}”；请检查 neutral / happy / sad 映射`)
    if (name === currentExpression) return true
    // Warm the expression through the owned loader, then guard the change.
    // This prevents a slower previous scene/action from winning a later one.
    const loaded = await untilAborted(manager.loadExpression(entry.index), load.signal)
    checkAbort(load.signal)
    if (version !== expressionVersion || disposed) return false
    if (!loaded) throw Error(`Live2D 表情“${name}”加载失败`)
    await untilAborted(model.expression(name), load.signal)
    checkAbort(load.signal)
    if (version !== expressionVersion || disposed) return false
    currentExpression = name
    return true
  }
  async function motion(value) {
    checkAbort(load.signal)
    if (!model) throw Error('Live2D 模型尚未加载')
    const request = motionRequest(value)
    if (!data.motions.some(item => item.group === request.group && (request.index === undefined || item.index === request.index))) throw Error('模型中没有该动作组或动作序号')
    const result = await untilAborted(model.motion(request.group, request.index, library.MotionPriority.FORCE), load.signal)
    checkAbort(load.signal)
    if (!result) throw Error('Live2D 动作未能播放，请重试并检查动作文件')
    return true
  }
  const ready = load.ready.then(loaded => {
    checkAbort(load.signal)
    if (disposed) return null
    model = loaded.model; library = loaded.live2d; data = catalog(model)
    app = new loaded.PIXI.Application({
      view: canvas, width: 1, height: 1, backgroundAlpha: 0, antialias: true,
      autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoStart: false, sharedTicker: false, sharedLoader: false, powerPreference: 'low-power',
    })
    app.stage.addChild(model)
    app.ticker.remove(app.render, app)
    app.ticker.add(() => {
      if (disposed || failed) return
      try { model.update(app.ticker.deltaMS); app.render() } catch (error) { fail(error) }
    })
    const resize = () => { try { layout() } catch (error) { fail(error) } }
    observer = new ResizeObserver(resize); observer.observe(root)
    listen(canvas, 'webglcontextlost', event => { event.preventDefault(); fail(Error('Live2D 图形上下文丢失，已恢复静态立绘；可重新加载')) })
    listen(canvas, 'pointermove', event => {
      if (!app || disposed || failed) return
      try { const p = point(event); model.focus(p.x, p.y) } catch (error) { fail(error) }
    })
    listen(canvas, 'pointerleave', () => model?.internalModel?.focusController.focus(0, 0))
    listen(canvas, 'click', event => {
      if (event.button !== 0 || disposed || failed) return
      const tap = configuration({ live2d: config }).tapMotion
      if (!tap.group) return
      try {
        const p = point(event)
        // Models without explicit hit areas may still be tapped within bounds.
        if (!(model.hitTest(p.x, p.y).length || model.containsPoint(p))) return
        event.stopPropagation()
        void motion(tap).catch(error => { if (!isAbort(error)) onError(error, { action: true }) })
      } catch (error) { fail(error) }
    })
    layout()
    // Render successfully once before the portrait is allowed to disappear.
    app.render()
    root.classList.add('ne-live2d-ready')
    onReady(data)
    return data
  }).catch(error => { if (!isAbort(error) && !disposed) fail(error); throw error })
  // Consumers still await ready; this also covers disposal during an unawaited
  // stage load so no rejected optional module promise escapes to the host.
  ready.catch(() => {})
  function dispose() {
    if (disposed) return
    disposed = true; expressionVersion++
    observer?.disconnect()
    for (const unlisten of listeners.splice(0)) unlisten()
    root.classList.remove('ne-live2d-ready')
    if (app) {
      app.stop()
      if (model?.parent) model.parent.removeChild(model)
    }
    load.dispose()
    if (app) {
      const gl = app.renderer?.gl
      try { app.destroy(true, { children: true }) } catch {}
      try { gl?.getExtension('WEBGL_lose_context')?.loseContext() } catch {}
      app = null
    }
    model = null; root.remove()
  }
  return { ready, dispose, expression, motion, layout, configure(value) { config = value }, get catalog() { return data }, get signal() { return load.signal } }
}
