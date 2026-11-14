import { acquireCore } from './core.js'
import { createResources } from './resources.js'
import { abortError, checkAbort, resourceURL, untilAborted } from './helpers.js'

const scopes = new WeakMap()
const loaders = new WeakMap()

function useScopedLoader(library, settings, resources) {
  let registration = loaders.get(library.Live2DLoader)
  if (!registration) {
    const middleware = async (context, next) => {
      const owner = context.settings && scopes.get(context.settings)
      if (!owner) return next()
      context.result = await owner.read(context.url, context.type)
    }
    library.Live2DLoader.middlewares.unshift(middleware)
    registration = { count: 0, middleware }
    loaders.set(library.Live2DLoader, registration)
  }
  registration.count++; scopes.set(settings, resources)
  return () => {
    scopes.delete(settings)
    if (--registration.count) return
    const index = library.Live2DLoader.middlewares.indexOf(registration.middleware)
    if (index >= 0) library.Live2DLoader.middlewares.splice(index, 1)
    loaders.delete(library.Live2DLoader)
  }
}

function destroyTexture(texture) {
  if (!texture?.baseTexture || texture.baseTexture.destroyed) return
  // The source is a private blob URL. Clear it even if image decoding failed.
  const image = texture.baseTexture.resource?.source
  if (image?.removeAttribute) image.removeAttribute('src')
  texture.destroy(true)
}

export function createModelLoad(config, { core = acquireCore, resourceFactory = createResources, base = () => document.baseURI } = {}) {
  const controller = new AbortController(), signal = controller.signal
  const textures = new Set()
  let lease, model, resources, unbind, completed = false, cleaned = false
  function cleanup() {
    if (cleaned) return
    cleaned = true
    // v0.4.0's destroy assumes internalModel exists; before modelLoaded, the
    // Pixi container alone owns the model's resources.
    if (model && !model.destroyed && !model._destroyed) {
      try {
        if (model.internalModel) model.destroy({ children: true })
        else { model.emit('destroy'); lease.PIXI.Container.prototype.destroy.call(model, { children: true }) }
      } catch {
        try { model.internalModel?.destroy() } catch {}
      }
    }
    for (const texture of textures) { try { destroyTexture(texture) } catch {} }
    textures.clear()
    resources?.dispose()
    unbind?.()
    lease?.release()
  }
  const ready = (async () => {
    try {
      const modelURL = resourceURL(config.modelUrl, base())
      if (!new URL(modelURL).pathname.toLowerCase().endsWith('.model3.json')) throw Error('请选择 Cubism 3/4 的 .model3.json 文件')
      lease = await core(config.coreUrl, signal)
      checkAbort(signal)
      resources = resourceFactory(signal, modelURL)
      const json = await resources.read(modelURL)
      if (!lease.live2d.Cubism4ModelSettings.isValidJSON(json)) throw Error('模型不是有效的 Cubism .model3.json，或缺少 Moc / Textures 引用')
      const settings = new lease.live2d.Cubism4ModelSettings({ ...json, url: modelURL })
      // Remote images use fetch+AbortSignal; Pixi subsequently decodes only our
      // own blob URLs. Their texture-cache entries are private to this model.
      settings.textures = await Promise.all(settings.textures.map(async path => {
        const url = await resources.image(path)
        checkAbort(signal)
        const texture = lease.PIXI.Texture.from(url, { resourceOptions: { autoLoad: false } })
        textures.add(texture)
        await untilAborted(lease.PIXI.Texture.fromURL(url), signal)
        checkAbort(signal)
        return url
      }))
      checkAbort(signal)
      unbind = useScopedLoader(lease.live2d, settings, resources)
      // Sound URLs must also be owned and abortable. Download configured sounds
      // as blobs now; the native audio element never downloads remote resources.
      const sounds = new Map()
      for (const entries of Object.values(settings.motions || {})) {
        for (const entry of entries) if (entry.Sound) {
          if (!sounds.has(entry.Sound)) sounds.set(entry.Sound, await resources.image(entry.Sound))
          entry.Sound = sounds.get(entry.Sound)
        }
      }
      const resolveURL = settings.resolveURL.bind(settings)
      settings.resolveURL = path => path.startsWith('blob:') ? path : resolveURL(path)
      model = new lease.live2d.Live2DModel({ autoUpdate: false, autoInteract: false })
      await lease.live2d.Live2DFactory.setupLive2DModel(model, settings, {
        autoUpdate: false, autoInteract: false, motionPreload: lease.live2d.MotionPreloadStrategy.NONE,
      })
      checkAbort(signal)
      completed = true
      return { model, PIXI: lease.PIXI, live2d: lease.live2d, signal }
    } catch (error) { const cancelled = signal.aborted; controller.abort(); cleanup(); throw cancelled ? abortError() : error }
    finally { if (signal.aborted) cleanup() }
  })()
  return {
    ready, signal,
    dispose() {
      if (signal.aborted) return
      controller.abort()
      // Abort pending image decoding immediately, without freeing Cubism Core
      // until the factory's asynchronous construction has unwound.
      if (completed) cleanup()
      else for (const texture of textures) { try { destroyTexture(texture) } catch {} }
    },
  }
}
