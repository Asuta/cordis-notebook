import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { setImmediate } from 'node:timers/promises'
import { createModelLoad } from '../loader.js'
import { createResources } from '../resources.js'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const config = { coreUrl: '/core.js', modelUrl: '/lin/lin.model3.json' }
const definition = { Version: 3, FileReferences: { Moc: 'lin.moc3', Textures: ['texture.png'], Motions: { TapBody: [{ File: 'tap.motion3.json' }] }, Expressions: [{ Name: 'smile', File: 'smile.exp3.json' }] } }

// A controlled model factory and texture decoder test loader ownership only.
// These tests neither emulate the editor nor claim to validate SDK rendering.
function fixture({ json = definition, setup, fetcher, decode } = {}) {
  const state = { models: [], textures: [], fetches: [], releases: 0, coreRequests: 0, containerDestroys: 0, modelDestroys: 0, internalDestroys: 0 }
  const textureCache = new Map()
  class Settings {
    static isValidJSON(value) { return Boolean(value?.FileReferences?.Moc && value?.FileReferences?.Textures?.length) }
    constructor(value) { Object.assign(this, { url: value.url, moc: value.FileReferences.Moc, textures: [...value.FileReferences.Textures], motions: structuredClone(value.FileReferences.Motions), expressions: structuredClone(value.FileReferences.Expressions) }) }
    resolveURL(path) { return new URL(path, this.url).href }
  }
  class Container { destroy() { state.containerDestroys++; this._destroyed = true } }
  class Model extends EventEmitter {
    constructor(options) { super(); state.models.push(this); this.options = options }
    destroy() { this.internalModel.destroy(); this._destroyed = true; state.modelDestroys++ }
  }
  const library = {
    Cubism4ModelSettings: Settings, Live2DModel: Model, MotionPreloadStrategy: { NONE: 'NONE' },
    Live2DLoader: {
      middlewares: [async context => { context.result = 'foreign' }],
      async load(context) {
        let index = 0
        const next = () => this.middlewares[index++]?.(context, next)
        await next(); return context.result
      },
    },
    Live2DFactory: { async setupLive2DModel(model, settings, options) {
      if (setup) return setup(model, settings, options, library, state)
      state.moc = await library.Live2DLoader.load({ settings, url: settings.moc, type: 'arraybuffer' })
      model.internalModel = { settings, destroy() { state.internalDestroys++ } }
    } },
  }
  const options = {
    base: () => 'https://app.test/editor',
    core: async () => { state.coreRequests++; return {
      live2d: library,
      PIXI: { Container, Texture: {
        from(url) {
          if (!textureCache.has(url)) {
            const texture = { baseTexture: { destroyed: false, resource: { source: { removeAttribute() {} } } }, destroy() { assert.equal(this.baseTexture.destroyed, false, 'texture is destroyed only once'); this.baseTexture.destroyed = true; this.destroyed = true } }
            textureCache.set(url, texture); state.textures.push(texture)
          }
          return textureCache.get(url)
        },
        async fromURL(url) { if (decode) await decode.promise; return textureCache.get(url) },
      } },
      release() { state.releases++ },
    } },
    resourceFactory: (signal, base) => createResources(signal, base, async (url, options) => {
      state.fetches.push({ url, signal: options.signal })
      if (fetcher) return fetcher(url, options)
      return new Response(url.endsWith('.model3.json') ? JSON.stringify(json) : url.endsWith('.json') ? '{}' : 'resource')
    }),
  }
  return { state, options, library }
}

test('non-model3 URL is rejected before requesting a Core', async () => {
  const f = fixture(), load = createModelLoad({ ...config, modelUrl: '/lin.png' }, f.options)
  await assert.rejects(load.ready, /model3.json/)
  assert.equal(f.state.coreRequests, 0); load.dispose()
})

test('invalid model JSON releases Core and owned resources', async () => {
  const f = fixture({ json: {} }), load = createModelLoad(config, f.options)
  await assert.rejects(load.ready, /不是有效/)
  assert.equal(load.signal.aborted, true); assert.equal(f.state.releases, 1); assert.equal(f.state.models.length, 0)
  load.dispose(); assert.equal(f.state.releases, 1)
})

test('successful loader owns textures and routes model/motion requests through its scope', async () => {
  const f = fixture(), load = createModelLoad(config, f.options), result = await load.ready
  assert.equal(result.model.options.autoUpdate, false); assert.equal(result.model.options.autoInteract, false)
  assert.equal(f.state.moc instanceof ArrayBuffer, true)
  assert.equal(f.library.Live2DLoader.middlewares.length, 2)
  const settings = result.model.internalModel.settings
  const expression = await f.library.Live2DLoader.load({ settings, url: 'smile.exp3.json', type: 'json' })
  assert.deepEqual(expression, {})
  assert.ok(f.state.fetches.some(entry => entry.url === 'https://app.test/lin/smile.exp3.json'))
  assert.ok(f.state.fetches.every(entry => entry.signal === load.signal))
  assert.equal(await f.library.Live2DLoader.load({ settings: {}, url: '/other.json' }), 'foreign')
  load.dispose(); load.dispose()
  assert.equal(f.state.modelDestroys, 1); assert.equal(f.state.internalDestroys, 1); assert.equal(f.state.releases, 1)
  assert.ok(f.state.textures.every(texture => texture.destroyed)); assert.equal(f.library.Live2DLoader.middlewares.length, 1)
})

test('stop cancels a model definition request and prevents stale construction', async () => {
  const started = deferred()
  const f = fixture({ fetcher: (url, { signal }) => new Promise((resolve, reject) => { started.resolve(); signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), { once: true }) }) })
  const load = createModelLoad(config, f.options)
  await started.promise; load.dispose()
  await assert.rejects(load.ready, { name: 'AbortError' })
  assert.equal(f.state.models.length, 0); assert.equal(f.state.releases, 1); assert.equal(f.state.fetches[0].signal.aborted, true)
})

test('one texture download failure aborts sibling downloads and keeps the real failure visible', async () => {
  let siblingCancelled = false
  const json = structuredClone(definition); json.FileReferences.Textures = ['bad.png', 'slow.png']
  const f = fixture({ fetcher: (url, { signal }) => {
    if (url.endsWith('.model3.json')) return Promise.resolve(new Response(JSON.stringify(json)))
    if (url.endsWith('bad.png')) return Promise.resolve(new Response('', { status: 404 }))
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => { siblingCancelled = true; reject(new DOMException('stopped', 'AbortError')) }, { once: true }))
  } })
  const load = createModelLoad(config, f.options)
  await assert.rejects(load.ready, /HTTP 404/); await setImmediate()
  assert.equal(siblingCancelled, true); assert.equal(f.state.releases, 1); assert.equal(f.state.models.length, 0)
})

test('stop during decoding destroys its private texture even before a model exists', async () => {
  const decode = deferred(), f = fixture({ decode }), load = createModelLoad(config, f.options)
  await setImmediate(); assert.equal(f.state.textures.length, 1)
  load.dispose(); await assert.rejects(load.ready, { name: 'AbortError' })
  assert.equal(f.state.textures[0].destroyed, true); assert.equal(f.state.models.length, 0); assert.equal(f.state.releases, 1)
  decode.resolve(); await setImmediate()
})

for (const internal of [false, true]) test(`stop during factory construction releases partial model (internal model ${internal})`, async () => {
  const started = deferred(), finish = deferred()
  const f = fixture({ setup: async (model, settings, options, library, state) => {
    if (internal) model.internalModel = { settings, destroy() { state.internalDestroys++ } }
    started.resolve(); await finish.promise
  } })
  const load = createModelLoad(config, f.options)
  await started.promise; load.dispose()
  assert.equal(f.state.releases, 0, 'Core must remain available to the factory while it unwinds')
  finish.resolve(); await assert.rejects(load.ready, { name: 'AbortError' })
  assert.equal(f.state.releases, 1); assert.equal(f.state.models[0]._destroyed, true)
  assert.equal(f.state.modelDestroys, internal ? 1 : 0); assert.equal(f.state.containerDestroys, internal ? 0 : 1)
  assert.equal(f.library.Live2DLoader.middlewares.length, 1)
})

test('two models share a middleware registration but own independent scopes and textures', async () => {
  const f = fixture(), first = createModelLoad(config, f.options), second = createModelLoad({ ...config, modelUrl: '/yao/yao.model3.json' }, f.options)
  const [a, b] = await Promise.all([first.ready, second.ready])
  assert.equal(f.library.Live2DLoader.middlewares.length, 2)
  assert.notEqual(a.model.internalModel.settings.textures[0], b.model.internalModel.settings.textures[0])
  first.dispose(); assert.equal(f.library.Live2DLoader.middlewares.length, 2)
  const settings = b.model.internalModel.settings
  await f.library.Live2DLoader.load({ settings, url: 'tap.motion3.json', type: 'json' })
  assert.ok(f.state.fetches.some(entry => entry.url === 'https://app.test/yao/tap.motion3.json' && !entry.signal.aborted))
  second.dispose(); assert.equal(f.library.Live2DLoader.middlewares.length, 1); assert.equal(f.state.releases, 2)
})
