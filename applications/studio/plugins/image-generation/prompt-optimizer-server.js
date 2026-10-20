import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { reasoningModes, reasoningEfforts } from './prompt-optimizer-reasoning.js'

const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }) }
const boundedText = (value, max, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(label + '格式无效')
  return value.trim()
}
const modelId = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value) ? value : fail('模型配置不存在', 404)

function normalizeReasoning(input, existing = {}) {
  const reasoningMode = input.reasoningMode === undefined ? existing.reasoningMode ?? 'default' : input.reasoningMode
  const reasoningEffort = input.reasoningEffort === undefined ? existing.reasoningEffort ?? 'medium' : input.reasoningEffort
  if (!reasoningModes.some(([value]) => value === reasoningMode)) fail('推理模式无效')
  if (!reasoningEfforts.some(([value]) => value === reasoningEffort)) fail('推理强度无效')
  return { reasoningMode, reasoningEffort }
}

function normalizeBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) fail('接口地址格式无效')
  let url
  try { url = new URL(value.trim()) } catch { fail('接口地址格式无效') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail('接口地址必须是 HTTP 或 HTTPS 地址，且不能包含账号、查询参数或片段')
  return url.toString().replace(/\/+$/, '')
}

function responsesUrl(baseUrl) {
  const url = new URL(baseUrl)
  if (!/\/responses\/?$/.test(url.pathname)) url.pathname = url.pathname.replace(/\/+$/, '') + '/responses'
  return url.toString()
}

function outputText(value) {
  if (typeof value?.output_text === 'string' && value.output_text.trim()) return value.output_text.trim()
  const parts = []
  for (const item of Array.isArray(value?.output) ? value.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if ((content?.type === 'output_text' || content?.type === 'text') && typeof content.text === 'string') parts.push(content.text)
    }
  }
  if (parts.length) return parts.join('\n').trim()
  const legacy = value?.choices?.[0]?.message?.content
  if (typeof legacy === 'string') return legacy.trim()
  return ''
}

function cleanOptimizedPrompt(value) {
  return value.trim().replace(/^```(?:[a-z0-9_-]+)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim()
}

export async function createPromptOptimizerServer(documents, { directory, writeSnapshot, request = globalThis.fetch, timeout = 60_000 } = {}) {
  if (!directory || typeof writeSnapshot !== 'function' || typeof request !== 'function') throw Error('提示词优化服务缺少运行环境')
  const configFile = join(directory, 'llm-private.json')
  const templates = documents.records('prompt-optimization')
  let config = { version: 1, models: [], defaultModelId: null }
  try {
    const stored = JSON.parse(await readFile(configFile, 'utf8'))
    if (stored?.version !== 1 || !Array.isArray(stored.models)) throw Error('大模型配置无效')
    config = {
      version: 1,
      models: stored.models.flatMap(item => {
        if (!item || typeof item.id !== 'string' || typeof item.apiKey !== 'string' || !item.apiKey) return []
        try {
          return [{
            id: item.id,
            name: boundedText(item.name, 120, '模型名称'),
            baseUrl: normalizeBaseUrl(item.baseUrl),
            model: boundedText(item.model, 200, '模型 ID'),
            apiKey: boundedText(item.apiKey, 8000, 'API Key'),
            ...normalizeReasoning(item),
          }]
        } catch { return [] }
      }),
      defaultModelId: typeof stored.defaultModelId === 'string' ? stored.defaultModelId : null,
    }
    if (!config.models.some(item => item.id === config.defaultModelId)) config.defaultModelId = config.models[0]?.id || null
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  let writes = Promise.resolve()
  function persist(next) {
    const task = writes.then(async () => {
      await writeSnapshot(configFile, JSON.stringify(next, null, 2))
      config = structuredClone(next)
      return publicConfig()
    })
    writes = task.catch(() => {})
    return task
  }

  function publicConfig() {
    return {
      format: 'openai-responses',
      defaultModelId: config.defaultModelId,
      models: config.models.map(({ apiKey, ...item }) => ({ ...structuredClone(item), hasKey: Boolean(apiKey) })),
    }
  }

  function listTemplates() { return structuredClone(templates.read()) }

  async function saveTemplate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('提示词优化配置无效')
    if (input.action === 'delete') {
      await templates.change(tx => {
        const index = tx.records.findIndex(item => item.id === input.id)
        if (index < 0) fail('提示词优化按钮不存在', 404)
        tx.records.splice(index, 1)
      })
      return { templates: listTemplates() }
    }
    const title = boundedText(input.title, 60, '按钮名称'), instruction = boundedText(input.instruction, 8000, '优化指令')
    await templates.change(tx => {
      const index = input.id ? tx.records.findIndex(item => item.id === input.id) : -1
      if (input.id && index < 0) fail('提示词优化按钮不存在', 404)
      if (index >= 0 && input.updatedAt !== tx.records[index].updatedAt) fail('提示词优化按钮已在其他页面修改，请重新打开', 409)
      if (index < 0 && tx.records.length >= 50) fail('最多配置 50 个提示词优化按钮')
      const now = Date.now()
      const saved = {
        id: index >= 0 ? tx.records[index].id : randomUUID(),
        title,
        instruction,
        createdAt: index >= 0 ? tx.records[index].createdAt : now,
        updatedAt: Math.max(now, (index >= 0 ? tx.records[index].updatedAt : 0) + 1),
      }
      if (index >= 0) tx.records[index] = saved
      else tx.records.push(saved)
    })
    return { templates: listTemplates() }
  }

  async function saveModel(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('大模型配置请求无效')
    if (input.action === 'delete') {
      const id = modelId(input.id)
      if (!config.models.some(item => item.id === id)) fail('模型配置不存在', 404)
      const next = structuredClone(config)
      next.models = next.models.filter(item => item.id !== id)
      if (next.defaultModelId === id) next.defaultModelId = next.models[0]?.id || null
      return persist(next)
    }
    if (input.action === 'default') {
      const id = modelId(input.id)
      if (!config.models.some(item => item.id === id)) fail('模型配置不存在', 404)
      const next = structuredClone(config); next.defaultModelId = id
      return persist(next)
    }
    const id = input.id ? modelId(input.id) : randomUUID(), existing = config.models.find(item => item.id === id)
    if (input.id && !existing) fail('模型配置不存在', 404)
    const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''
    if (!existing && !apiKey) fail('API Key 不能为空')
    if (apiKey.length > 8000) fail('API Key 格式无效')
    const baseUrl = normalizeBaseUrl(input.baseUrl)
    if (existing && !apiKey && new URL(baseUrl).origin !== new URL(existing.baseUrl).origin) {
      fail('接口域名或端口已改变，请重新填写 API Key')
    }
    const next = structuredClone(config), index = next.models.findIndex(item => item.id === id)
    const saved = {
      id,
      name: boundedText(input.name, 120, '模型名称'),
      baseUrl,
      model: boundedText(input.model, 200, '模型 ID'),
      apiKey: apiKey || existing.apiKey,
      ...normalizeReasoning(input, existing),
    }
    if (index >= 0) next.models[index] = saved
    else next.models.push(saved)
    if (input.default === true || !next.defaultModelId) next.defaultModelId = id
    return persist(next)
  }

  async function callModel(item, instructions, input, maxOutputTokens) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout)
    let response
    try {
      response = await request(responsesUrl(item.baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + item.apiKey },
        body: JSON.stringify({
          model: item.model, instructions, input, store: false,
          ...(item.reasoningMode === 'off' ? { reasoning: { effort: 'none' } } : {}),
          ...(item.reasoningMode === 'on' ? { reasoning: { effort: item.reasoningEffort } } : {}),
          ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}),
        }),
        signal: controller.signal,
      })
    } catch (error) {
      if (error?.name === 'AbortError' || controller.signal.aborted) fail('模型服务响应超时', 504)
      fail('无法连接模型服务：' + (error?.message || '网络错误'), 502)
    } finally { clearTimeout(timer) }
    const raw = await response.text().catch(() => '')
    if (!response.ok) {
      const detail = raw.replaceAll(item.apiKey, '[已隐藏]').slice(0, 500).trim()
      fail(`模型服务返回 ${response.status}${detail ? '：' + detail : ''}`, 502)
    }
    let body
    try { body = JSON.parse(raw) } catch { fail('模型服务返回了无法解析的数据', 502) }
    const text = outputText(body)
    if (!text) fail('模型服务没有返回文本结果', 502)
    return text
  }

  async function testModel(input) {
    const id = modelId(input?.id), item = config.models.find(item => item.id === id)
    if (!item) fail('模型配置不存在', 404)
    // 输出预算也包含推理 token，给开启推理的模型留出生成答案的空间。
    const result = await callModel(item, 'Return exactly OK. Do not add any explanation.', 'Connection test', 4096)
    return { ok: true, message: result.slice(0, 200) }
  }

  async function optimize(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('提示词优化请求无效')
    const prompt = boundedText(input.prompt, 24_000, '提示词')
    if (typeof input.templateId !== 'string') fail('请选择提示词优化按钮')
    const template = templates.read().find(item => item.id === input.templateId)
    if (!template) fail('提示词优化按钮不存在', 404)
    const model = config.models.find(item => item.id === config.defaultModelId)
    if (!model) fail('请先在应用设置中配置默认大模型')
    const instructions = 'You are a prompt editor. Follow the optimization instruction exactly. Return only the rewritten prompt, without commentary, labels, or code fences.\n\nOptimization instruction:\n' + template.instruction
    const optimized = cleanOptimizedPrompt(await callModel(model, instructions, prompt))
    if (!optimized) fail('模型没有返回可用的提示词', 502)
    if (optimized.length > 24_000) fail('优化后的提示词超过 24000 字符', 422)
    return {
      prompt: optimized,
      originalPrompt: prompt,
      template: { id: template.id, title: template.title },
      model: { id: model.id, name: model.name, model: model.model },
    }
  }

  return { publicConfig, saveModel, testModel, listTemplates, saveTemplate, optimize }
}
