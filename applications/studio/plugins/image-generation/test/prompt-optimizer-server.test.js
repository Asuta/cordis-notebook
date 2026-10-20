import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPromptOptimizerServer } from '../prompt-optimizer-server.js'

const modelId = '11111111-1111-4111-8111-111111111111'
const templateId = '22222222-2222-4222-8222-222222222222'
const model = { id: modelId, name: '测试模型', baseUrl: 'https://example.test/v1', model: 'test-model', apiKey: 'test-key', reasoningMode: 'default', reasoningEffort: 'medium' }

function deferred() {
  let resolve
  const promise = new Promise(accept => { resolve = accept })
  return { promise, resolve }
}

function documents(initial = []) {
  let current = structuredClone(initial)
  return {
    records(namespace) {
      assert.equal(namespace, 'prompt-optimization')
      return {
        read: () => structuredClone(current),
        change: async callback => {
          const next = structuredClone(current)
          const result = callback({ records: next })
          current = next
          return result
        },
      }
    },
  }
}

async function withDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), 'image-generation-prompt-optimizer-'))
  try { await run(directory) }
  finally { await rm(directory, { recursive: true, force: true }) }
}

test('停用服务会取消在途提示词优化请求', async () => withDirectory(async directory => {
  await writeFile(join(directory, 'llm-private.json'), JSON.stringify({ version: 1, defaultModelId: modelId, models: [model] }))
  const started = deferred()
  const server = await createPromptOptimizerServer(documents([{ id: templateId, title: '优化', instruction: '提升清晰度' }]), {
    directory,
    writeSnapshot: async () => {},
    request: (_url, { signal }) => {
      started.resolve(signal)
      return new Promise((resolve, reject) => {
        if (signal.aborted) reject(Object.assign(Error('aborted'), { name: 'AbortError' }))
        else signal.addEventListener('abort', () => reject(Object.assign(Error('aborted'), { name: 'AbortError' })), { once: true })
      })
    },
  })

  const optimizing = server.optimize({ prompt: '一座山', templateId })
  const signal = await started.promise
  const closing = server.close()
  assert.equal(signal.aborted, true)
  await assert.rejects(optimizing, error => error.status === 503)
  await closing
  await assert.rejects(server.optimize({ prompt: '另一座山', templateId }), error => error.status === 503)
}))

test('停用服务会等待已启动的模型设置和模板写入完成', async () => withDirectory(async directory => {
  const snapshotStarted = deferred(), snapshotGate = deferred(), snapshotFinished = deferred()
  const templateStarted = deferred(), templateGate = deferred()
  let savedTemplates = []
  const docs = {
    records(namespace) {
      assert.equal(namespace, 'prompt-optimization')
      return {
        read: () => structuredClone(savedTemplates),
        change: async callback => {
          const next = structuredClone(savedTemplates)
          const result = callback({ records: next })
          templateStarted.resolve()
          await templateGate.promise
          savedTemplates = next
          return result
        },
      }
    },
  }
  const server = await createPromptOptimizerServer(docs, {
    directory,
    writeSnapshot: async (_file, serialized) => {
      snapshotStarted.resolve(JSON.parse(serialized))
      await snapshotGate.promise
      snapshotFinished.resolve()
    },
  })

  const savingModel = server.saveModel({ name: model.name, baseUrl: model.baseUrl, model: model.model, apiKey: model.apiKey })
  const savingTemplate = server.saveTemplate({ title: '优化', instruction: '提升清晰度' })
  const [savedConfig] = await Promise.all([snapshotStarted.promise, templateStarted.promise])
  let closed = false
  const closing = server.close().then(() => { closed = true })
  await Promise.resolve()
  assert.equal(closed, false, '待写入期间 close 不应完成')

  snapshotGate.resolve()
  await snapshotFinished.promise
  assert.equal(closed, false, '模板事务仍在写入时 close 不应完成')
  templateGate.resolve()
  await Promise.all([savingModel, savingTemplate, closing])

  assert.equal(closed, true)
  assert.equal(savedConfig.defaultModelId, server.publicConfig().defaultModelId)
  assert.equal(server.listTemplates().length, 1)
}))
