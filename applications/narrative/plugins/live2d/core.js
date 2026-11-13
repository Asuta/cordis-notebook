import { abortError, checkAbort, resourceURL, untilAborted } from './helpers.js'

// Test injection keeps lifecycle checks independent of a proprietary SDK.
// Production modules remain lazy, bundled imports, never remote CDN modules.
export function createCoreManager({
  environment = () => ({ window, document, fetch, URL, Blob }),
  importPixi = () => import('pixi.js'),
  importLive2D = () => import('pixi-live2d-display/cubism4'),
} = {}) {
  let activeCore = null
  function restore(record) {
    if (record.finished) return
    record.finished = true
    const { window: target, URL: urls } = record.env
    record.controller.abort()
    record.script?.remove()
    if (record.objectURL) urls.revokeObjectURL(record.objectURL)
    if (record.shadowed && target.Live2DCubismCore === record.installed) {
      try { record.modules?.live2d.CubismFramework.dispose(); record.modules?.live2d.CubismFramework.cleanUp() } catch {}
      if (record.previous) Object.defineProperty(target, 'Live2DCubismCore', record.previous)
      else delete target.Live2DCubismCore
    }
    if (activeCore === record) activeCore = null
    record.restored?.()
  }
  async function initialize(record) {
    const signal = record.controller.signal
    const { window: target, document: doc, fetch: fetcher, URL: urls, Blob: BlobClass } = record.env
    // Removing a remote script alone does not reliably cancel its download.
    const response = await fetcher(record.url, { signal, mode: 'cors', credentials: 'same-origin' })
    if (!response.ok) throw Error(`Cubism Core 请求失败（HTTP ${response.status}）`)
    const source = await response.text()
    checkAbort(signal)
    record.previous = Object.getOwnPropertyDescriptor(target, 'Live2DCubismCore')
    if (record.previous && !record.previous.configurable) {
      if (!record.previous.writable) throw Error('已有 Cubism Core 全局变量不可替换，请使用独立页面预览')
      target.Live2DCubismCore = undefined
    } else {
      // The SDK's top-level var must neither create an undeletable property
      // nor augment a pre-existing Core that belongs to another owner.
      Object.defineProperty(target, 'Live2DCubismCore', { value: undefined, writable: true, configurable: true, enumerable: true })
    }
    record.shadowed = true
    record.objectURL = urls.createObjectURL(new BlobClass([source], { type: 'text/javascript' }))
    const script = doc.createElement('script')
    record.script = script
    script.dataset.neLive2dCore = record.url
    script.src = record.objectURL
    await new Promise((resolve, reject) => {
      const clear = () => { script.onload = null; script.onerror = null; signal.removeEventListener('abort', cancel) }
      const cancel = () => { record.installed = target.Live2DCubismCore; clear(); script.remove(); reject(abortError()) }
      script.onload = () => {
        record.installed = target.Live2DCubismCore
        clear()
        if (!record.installed?.Moc?.fromArrayBuffer || !record.installed?.Model?.fromMoc || !record.installed?.Version?.csmGetVersion) reject(Error('Core 脚本没有提供可用的 Live2DCubismCore；请使用 Cubism 4 SDK 的 Core 文件'))
        else resolve()
      }
      script.onerror = () => { record.installed = target.Live2DCubismCore; clear(); reject(Error('Cubism Core 执行失败，请检查 Core 文件与脚本策略（需允许 blob:）')) }
      signal.addEventListener('abort', cancel, { once: true })
      doc.head.append(script)
    })
    checkAbort(signal)
    // Retain the global across module evaluation, even if the consumer stops.
    record.importing = true
    try {
      const PIXI = await importPixi()
      checkAbort(signal)
      const live2d = await importLive2D()
      record.modules = { PIXI, live2d }
      checkAbort(signal)
      live2d.Live2DModel.registerTicker(PIXI.Ticker)
      // v0.4.0 caches its ready promise forever. Start this Core explicitly so
      // re-enabling works after the previous framework was cleaned up.
      let startupError
      for (let attempt = 0; attempt < 30; attempt++) {
        checkAbort(signal)
        try { live2d.startUpCubism4(); startupError = null; break }
        catch (error) {
          startupError = error
          live2d.CubismFramework.cleanUp()
          record.installed._isStarted = false
          await untilAborted(new Promise(resolve => setTimeout(resolve, 10)), signal)
        }
      }
      if (startupError) throw Error('Cubism Core 初始化失败，请检查 SDK 版本与配套运行文件', { cause: startupError })
      return record.modules
    } finally { record.importing = false }
  }
  return {
    async acquire(value, signal) {
      checkAbort(signal)
      if (typeof value !== 'string' || !value.trim()) throw Error('尚未配置 Cubism Core URL')
      const env = environment(), url = resourceURL(value, env.document.baseURI)
      if (activeCore && (activeCore.controller.signal.aborted || activeCore.url !== url && [...activeCore.consumers].every(consumer => consumer.aborted))) {
        await untilAborted(activeCore.restoration, signal)
        return this.acquire(value, signal)
      }
      if (activeCore && activeCore.url !== url) throw Error('另一个 Live2D 预览正在使用不同的 Core；请停止该预览，或配置相同的 Core URL')
      let record = activeCore
      if (!record) {
        record = { env, url, references: 0, consumers: new Set(), controller: new AbortController(), importing: false, finished: false }
        record.restoration = new Promise(resolve => { record.restored = resolve })
        activeCore = record
        record.promise = initialize(record).catch(error => { restore(record); throw error }).finally(() => { if (!record.references) restore(record) })
      }
      record.references++
      record.consumers.add(signal)
      let released = false
      const release = () => {
        if (released) return
        released = true
        record.consumers.delete(signal)
        signal.removeEventListener('abort', release)
        if (--record.references === 0) {
          record.controller.abort()
          if (!record.importing) restore(record)
        }
      }
      signal.addEventListener('abort', release, { once: true })
      try {
        const modules = await untilAborted(record.promise, signal)
        checkAbort(signal)
        // Constructed models retain the lease until factory cleanup unwinds.
        signal.removeEventListener('abort', release)
        return { ...modules, release }
      } catch (error) { release(); throw error }
    },
  }
}

const manager = createCoreManager()
export const acquireCore = (value, signal) => manager.acquire(value, signal)
