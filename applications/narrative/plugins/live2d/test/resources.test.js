import test from 'node:test'
import assert from 'node:assert/strict'
import { createResources } from '../resources.js'

test('a model owns and deduplicates its fetches without changing global fetch', async () => {
  const before = globalThis.fetch, requests = [], controller = new AbortController()
  const resources = createResources(controller.signal, 'https://models.test/lin/lin.model3.json', async (url, options) => {
    requests.push({ url, options }); return new Response(JSON.stringify({ value: 3 }))
  })
  const [first, second] = await Promise.all([resources.read('lin.exp3.json'), resources.read('lin.exp3.json')])
  assert.deepEqual(first, { value: 3 }); assert.equal(first, second)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'https://models.test/lin/lin.exp3.json')
  assert.equal(requests[0].options.signal, controller.signal)
  assert.equal(globalThis.fetch, before)
  resources.dispose()
})

test('abort cancels an in-flight resource and prevents later downloads', async () => {
  const controller = new AbortController(), requests = []
  let started
  const began = new Promise(resolve => { started = resolve })
  const resources = createResources(controller.signal, 'https://models.test/lin.model3.json', (url, { signal }) => new Promise((resolve, reject) => {
    requests.push(url); started(); signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })
  }))
  const pending = resources.read('lin.moc3', 'arraybuffer')
  await began; controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  await assert.rejects(resources.read('texture.png', 'blob'), { name: 'AbortError' })
  assert.equal(requests.length, 1); resources.dispose()
})

test('private blob URLs are revoked and failed HTTP requests remain errors', async () => {
  const controller = new AbortController()
  const resources = createResources(controller.signal, 'https://models.test/lin.model3.json', async url => url.endsWith('missing') ? new Response('', { status: 404 }) : new Response('image bytes'))
  const image = await resources.image('texture.png')
  assert.equal(await (await fetch(image)).text(), 'image bytes')
  await assert.rejects(resources.read('missing'), /HTTP 404/)
  resources.dispose(); resources.dispose()
  await assert.rejects(fetch(image))
})
