import { writeSnapshot } from '../../shared/persistence.js'
import { createRegistry } from '../../applications/studio/plugins/canvas/registry.js'
import { createStore as openStore } from '../../applications/studio/plugins/canvas/store.js'
import { applyOperation as apply } from '../../applications/studio/plugins/canvas/model.js'
import { definitions } from '../../applications/studio/plugins/canvas-basic-cards/definitions.js'
import { definition, generationInput as input } from '../../applications/studio/plugins/image-generation/definition.js'
import { createJobs as openJobs } from '../../applications/studio/plugins/image-generation/jobs.js'

export function owner() {
  const cleanups = []
  return { effect(fn) { const cleanup = fn(); cleanups.push(cleanup); return cleanup }, async dispose() { for (const fn of cleanups.splice(0).reverse()) await fn?.() } }
}
export function createTypes() {
  const types = createRegistry(), context = owner()
  for (const item of [...definitions, definition]) types.register(context, item)
  return types
}
export const applyOperation = (board, operation, assets) => apply(board, operation, assets, createTypes())
export const generationInput = (board, id) => input(board, id, createTypes())
export const createStore = directory => openStore(directory, writeSnapshot, createTypes())
export async function createJobs(store, config, pixel) {
  const jobs = await openJobs(store)
  jobs.register(owner(), { id: 'fake', label: '测试服务', public: () => ({}), prepare(input) {
    const snapshot = config.private()
    return { model: snapshot.model, generate: (images, signal) => pixel.generate(input, snapshot, images, signal) }
  } })
  return jobs
}
