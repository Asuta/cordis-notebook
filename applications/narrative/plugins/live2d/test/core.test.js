import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { setImmediate } from 'node:timers/promises'
import { createCoreManager } from '../core.js'

const source = 'var Live2DCubismCore = { Moc: { fromArrayBuffer() {} }, Model: { fromMoc() {} }, Version: { csmGetVersion() { return 4 } } };'
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }

// Core API/lifecycle fixture, without a renderer, model asset or UI assertions.
function fixture({ body = source, fetcher, importer, prior, scriptGate } = {}) {
  const target = {}, events = [], scripts = new Set(), blobs = new Map()
  if (prior) Object.defineProperty(target, 'Live2DCubismCore', prior)
  const context = vm.createContext(target)
  const PIXI = { Ticker: class Ticker {} }
  const live2d = {
    Live2DModel: { registerTicker(value) { assert.equal(value, PIXI.Ticker); events.push('ticker') } },
    startUpCubism4() { events.push('startup'); assert.ok(target.Live2DCubismCore) },
    CubismFramework: { dispose() { events.push('dispose') }, cleanUp() { events.push('cleanup') } },
  }
  const env = {
    window: target, Blob,
    URL: { createObjectURL(blob) { const url = `blob:unit-${blobs.size}`; blobs.set(url, blob); return url }, revokeObjectURL(url) { blobs.delete(url) } },
    fetch: fetcher || (async () => { events.push('fetch'); return new Response(body) }),
    document: {
      baseURI: 'https://app.test/editor/',
      createElement(tag) { assert.equal(tag, 'script'); return { dataset: {}, remove() { scripts.delete(this) } } },
      head: { append(script) {
        scripts.add(script)
        queueMicrotask(async () => {
          if (scriptGate) await scriptGate.promise
          if (!scripts.has(script)) return
          try { vm.runInContext(await blobs.get(script.src).text(), context); events.push('script'); script.onload?.() } catch { script.onerror?.() }
        })
      } },
    },
  }
  const manager = createCoreManager({
    environment: () => env,
    importPixi: async () => { events.push('pixi'); assert.ok(target.Live2DCubismCore); return PIXI },
    importLive2D: async () => { events.push('cubism'); assert.ok(target.Live2DCubismCore); if (importer) await importer.promise; return live2d },
  })
  return { manager, target, events, scripts, blobs }
}

test('Core loads before module evaluation, registers Ticker and restores the original binding', async () => {
  const previous = { prior: true }, descriptor = { value: previous, writable: true, configurable: true, enumerable: false }
  const f = fixture({ prior: descriptor })
  const lease = await f.manager.acquire('/sdk/core.js', new AbortController().signal)
  assert.deepEqual(f.events.slice(0, 6), ['fetch', 'script', 'pixi', 'cubism', 'ticker', 'startup'])
  assert.equal(f.target.PIXI, undefined)
  assert.notEqual(f.target.Live2DCubismCore, previous)
  lease.release(); lease.release()
  assert.deepEqual(Object.getOwnPropertyDescriptor(f.target, 'Live2DCubismCore'), descriptor)
  assert.equal(f.scripts.size, 0); assert.equal(f.blobs.size, 0)
  assert.equal(f.events.filter(event => event === 'dispose').length, 1)
})

test('SDK var binding is removed entirely; re-enable starts the framework again', async () => {
  const f = fixture()
  for (let index = 0; index < 2; index++) {
    const lease = await f.manager.acquire('/sdk/core.js', new AbortController().signal)
    lease.release()
    assert.equal(Object.hasOwn(f.target, 'Live2DCubismCore'), false)
  }
  assert.equal(f.events.filter(event => event === 'startup').length, 2)
})

test('concurrent consumers share Core and release only their own reference', async () => {
  const f = fixture(), c1 = new AbortController(), c2 = new AbortController()
  const [first, second] = await Promise.all([f.manager.acquire('/sdk/core.js', c1.signal), f.manager.acquire('/sdk/core.js', c2.signal)])
  assert.equal(f.events.filter(event => event === 'fetch').length, 1)
  await assert.rejects(f.manager.acquire('/sdk/another.js', new AbortController().signal), /不同的 Core/)
  first.release(); assert.ok(f.target.Live2DCubismCore)
  c2.abort(); assert.ok(f.target.Live2DCubismCore, 'an acquired model owns the Core until its own cleanup')
  second.release(); assert.equal(Object.hasOwn(f.target, 'Live2DCubismCore'), false)
})

test('abort cancels remote Core fetch before importing either optional module', async () => {
  let requestedSignal
  const f = fixture({ fetcher: (url, { signal }) => new Promise((resolve, reject) => { requestedSignal = signal; signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), { once: true }) }) })
  const controller = new AbortController(), pending = f.manager.acquire('/sdk/core.js', controller.signal)
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(requestedSignal.aborted, true)
  assert.deepEqual(f.events, []); assert.equal(f.scripts.size, 0); assert.equal(f.blobs.size, 0)
})

test('abort while a local script is pending removes it and restores the previous global', async () => {
  const scriptGate = deferred(), previous = { prior: true }
  const f = fixture({ scriptGate, prior: { value: previous, writable: true, configurable: true } })
  const controller = new AbortController(), pending = f.manager.acquire('/sdk/core.js', controller.signal)
  await setImmediate(); assert.equal(f.scripts.size, 1)
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' })
  scriptGate.resolve(); await setImmediate()
  assert.equal(f.target.Live2DCubismCore, previous); assert.equal(f.scripts.size, 0); assert.equal(f.blobs.size, 0)
  assert.equal(f.events.includes('cubism'), false)
})

test('abort during module evaluation keeps Core until that evaluation unwinds', async () => {
  const importer = deferred(), f = fixture({ importer }), controller = new AbortController()
  const pending = f.manager.acquire('/sdk/core.js', controller.signal)
  await setImmediate(); assert.equal(f.events.includes('cubism'), true)
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' })
  assert.ok(f.target.Live2DCubismCore)
  importer.resolve(); await setImmediate()
  assert.equal(Object.hasOwn(f.target, 'Live2DCubismCore'), false); assert.equal(f.scripts.size, 0)
})

test('invalid SDK and missing URL fail without evaluating optional modules', async () => {
  const f = fixture({ body: 'var Live2DCubismCore = { invalid: true }' })
  await assert.rejects(f.manager.acquire('/sdk/core.js', new AbortController().signal), /SDK/)
  await assert.rejects(f.manager.acquire('', new AbortController().signal), /尚未配置/)
  assert.equal(f.events.includes('cubism'), false); assert.equal(f.scripts.size, 0); assert.equal(Object.hasOwn(f.target, 'Live2DCubismCore'), false)
})

test('cleanup preserves a later replacement of the global by another owner', async () => {
  const f = fixture(), lease = await f.manager.acquire('/sdk/core.js', new AbortController().signal)
  const replacement = {}; f.target.Live2DCubismCore = replacement
  lease.release(); assert.equal(f.target.Live2DCubismCore, replacement); assert.equal(f.scripts.size, 0)
})

test('a new scene waits for an aborted model to release a different Core', async () => {
  const f = fixture(), previousScene = new AbortController()
  const first = await f.manager.acquire('/sdk/first.js', previousScene.signal)
  previousScene.abort()
  const pending = f.manager.acquire('/sdk/second.js', new AbortController().signal)
  await setImmediate()
  assert.equal(f.events.filter(event => event === 'fetch').length, 1)
  first.release()
  const second = await pending
  assert.equal(f.events.filter(event => event === 'fetch').length, 2)
  second.release(); assert.equal(f.scripts.size, 0)
})

test('a new load can reuse a URL after cancellation during module evaluation', async () => {
  const importer = deferred(), f = fixture({ importer }), previousScene = new AbortController()
  const first = f.manager.acquire('/sdk/core.js', previousScene.signal)
  await setImmediate(); previousScene.abort(); await assert.rejects(first, { name: 'AbortError' })
  const second = f.manager.acquire('/sdk/core.js', new AbortController().signal)
  importer.resolve()
  const lease = await second
  assert.equal(f.events.filter(event => event === 'fetch').length, 2)
  lease.release(); assert.equal(f.scripts.size, 0); assert.equal(f.blobs.size, 0)
})

test('an optional Cubism module import failure restores Core and removes its script', async () => {
  const importer = deferred(), previous = { prior: true }
  const f = fixture({ importer, prior: { value: previous, configurable: true, writable: true } })
  const pending = f.manager.acquire('/sdk/core.js', new AbortController().signal)
  await setImmediate(); importer.reject(Error('optional module unavailable'))
  await assert.rejects(pending, /optional module unavailable/)
  assert.equal(f.target.Live2DCubismCore, previous)
  assert.equal(f.scripts.size, 0); assert.equal(f.blobs.size, 0)
})
