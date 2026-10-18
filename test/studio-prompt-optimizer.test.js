import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeSnapshot } from '../shared/persistence.js'
import { createPromptOptimizerServer } from '../applications/studio/plugins/image-generation/prompt-optimizer-server.js'

function documentsFixture() {
  const values = []
  return {
    values,
    records(namespace) {
      assert.equal(namespace, 'prompt-optimization')
      return {
        read: () => structuredClone(values),
        async change(callback) { callback({ records: values }) },
      }
    },
  }
}

async function setup(t, request = async () => { throw Error('未配置模型请求') }) {
  const directory = await mkdtemp(join(tmpdir(), 'cordis-prompt-optimizer-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const documents = documentsFixture()
  return { directory, documents, service: await createPromptOptimizerServer(documents, { directory, writeSnapshot, request }) }
}

test('大模型配置支持多个模型、默认切换和私有 Key 不回传', async t => {
  const { directory, documents, service } = await setup(t)
  let config = await service.saveModel({ name: '主模型', baseUrl: 'https://api.example.com/v1', model: 'model-a', apiKey: 'secret-a', default: true })
  config = await service.saveModel({ name: '备用模型', baseUrl: 'https://backup.example.com/v1/responses', model: 'model-b', apiKey: 'secret-b' })
  assert.equal(config.models.length, 2)
  assert.equal(config.defaultModelId, config.models[0].id)
  assert.doesNotMatch(JSON.stringify(config), /secret-a|secret-b/)
  assert.equal(config.models.every(item => item.hasKey), true)

  const backup = config.models[1]
  config = await service.saveModel({ action: 'default', id: backup.id })
  assert.equal(config.defaultModelId, backup.id)
  const reopened = await createPromptOptimizerServer(documents, { directory, writeSnapshot })
  assert.equal(reopened.publicConfig().defaultModelId, backup.id)
  assert.doesNotMatch(JSON.stringify(reopened.publicConfig()), /secret-a|secret-b/)
})

test('编辑模型时更换接口 origin 必须重新填写 API Key', async t => {
  const { service } = await setup(t)
  const config = await service.saveModel({ name: '主模型', baseUrl: 'https://api.example.com/v1', model: 'model-a', apiKey: 'secret-a', default: true })
  const id = config.models[0].id
  await assert.rejects(() => service.saveModel({ id, name: '主模型', baseUrl: 'https://evil.example.com/v1', model: 'model-a', apiKey: '' }), /重新填写 API Key/)
  await assert.rejects(() => service.saveModel({ id, name: '主模型', baseUrl: 'http://api.example.com/v1', model: 'model-a', apiKey: '' }), /重新填写 API Key/)
  const sameOrigin = await service.saveModel({ id, name: '主模型', baseUrl: 'https://api.example.com/v2', model: 'model-a', apiKey: '' })
  assert.equal(sameOrigin.models[0].baseUrl, 'https://api.example.com/v2')
  const rotated = await service.saveModel({ id, name: '主模型', baseUrl: 'https://new.example.com/v1', model: 'model-a', apiKey: 'secret-b' })
  assert.equal(rotated.models[0].baseUrl, 'https://new.example.com/v1')
  assert.doesNotMatch(JSON.stringify(rotated), /secret-b/)
})

test('提示词优化使用默认模型和指定指令，并只发送主提示词', async t => {
  const calls = []
  const request = async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'English optimized prompt' }] }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const { service } = await setup(t, request)
  const config = await service.saveModel({ name: '默认模型', baseUrl: 'https://api.example.com/v1', model: 'model-main', apiKey: 'secret-key', default: true })
  const templates = await service.saveTemplate({ title: '改成英文', instruction: '将提示词翻译为英文' })
  const result = await service.optimize({ prompt: '只有主提示词，不带尾缀', templateId: templates.templates[0].id })
  assert.equal(result.prompt, 'English optimized prompt')
  assert.equal(result.originalPrompt, '只有主提示词，不带尾缀')
  assert.equal(result.model.id, config.defaultModelId)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.example.com/v1/responses')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret-key')
  const body = JSON.parse(calls[0].options.body)
  assert.equal(body.model, 'model-main')
  assert.equal(body.input, '只有主提示词，不带尾缀')
  assert.equal(body.store, false)
  assert.match(body.instructions, /将提示词翻译为英文/)
})

test('优化按钮模板可编辑、删除并阻止过期覆盖', async t => {
  const { service } = await setup(t)
  const first = await service.saveTemplate({ title: '简写', instruction: '把提示词改得更短' })
  const item = first.templates[0]
  const updated = await service.saveTemplate({ id: item.id, updatedAt: item.updatedAt, title: '精简', instruction: '只保留核心描述' })
  assert.equal(updated.templates[0].title, '精简')
  await assert.rejects(() => service.saveTemplate({ id: item.id, updatedAt: item.updatedAt, title: '过期', instruction: '过期修改' }), error => error.status === 409)
  const removed = await service.saveTemplate({ action: 'delete', id: item.id })
  assert.deepEqual(removed.templates, [])
})
