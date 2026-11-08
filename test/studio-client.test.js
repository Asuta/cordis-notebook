import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import client from '../applications/studio/plugins/canvas/client.js'
import ui from '../applications/studio/plugins/canvas-ui/client.js'
import basic from '../applications/studio/plugins/canvas-basic-cards/client.js'
import generation from '../applications/studio/plugins/image-generation/client.js'
import agent from '../applications/studio/plugins/canvas-agent-tools/client.js'
import { newBoard } from '../applications/studio/plugins/canvas/store.js'
import { applyOperation, createTypes, generationInput } from './helpers/studio-fixture.js'
import { copySelection } from '../applications/studio/plugins/canvas/copy.js'
import { normalizeModels } from '../applications/studio/plugins/image-provider-wavespeed/schema.js'
import { modelRows } from './helpers/studio-wavespeed.js'
import { snapshotGenerator } from '../applications/studio/plugins/image-generation/snapshot.js'

async function setup(t, { models = {}, providers = [], systemDark = false, library = null, libraryService = null, llmConfig = null, promptOptimizations = null, broadcastChannel = null } = {}) {
  const window = new Window({ settings: { disableCSSFileLoading: true } }), previous = { window: globalThis.window, document: globalThis.document, FileReader: globalThis.FileReader }
  if (broadcastChannel) window.BroadcastChannel = broadcastChannel
  window.matchMedia = query => ({ matches: query === '(prefers-color-scheme: dark)' && systemDark, media: query, addEventListener() {}, removeEventListener() {} })
  globalThis.window = window; globalThis.document = window.document; globalThis.FileReader = window.FileReader
  const cleanups = [], hooks = new Map(), tools = new Map(), editBatches = []
  const board = newBoard('测试画板'), state = {
    boards: [board], assets: {}, jobs: [], config: { hasKey: true, model: 'test-model', baseUrl: 'https://example.com' },
    llmConfig: llmConfig || { format: 'openai-responses', defaultModelId: null, models: [] }, promptOptimizations: promptOptimizations || { templates: [] },
  }
  const generated = [], toasts = [], assetFavorites = new Set()
  const ctx = { effect: fn => cleanups.push(fn()), on: (name, fn) => hooks.set(name, fn) }
  const sdk = {
    application: { id: 'studio', name: '灵感画布', manageData: true },
    provide(name, service) { ctx[name] = service; return service },
    el(tag, props = {}, text) { const node = window.document.createElement(tag); for (const [key, value] of Object.entries(props)) { if (key === 'class') node.className = value; else if (key.startsWith('aria-') || key.startsWith('data-')) node.setAttribute(key, value); else node[key] = value }; if (text !== undefined) node.textContent = text; return node },
    mount: (name, node) => window.document.body.append(node), toast: message => toasts.push(message),
    storage: { local: window.localStorage }, agent: { register: (definition, callback) => tools.set(definition.name, callback) },
    listen(target, name, fn) { target.addEventListener(name, fn); cleanups.push(() => target.removeEventListener(name, fn)) },
    async request(path, method, body) {
      if (path === '/api/studio/summary') return { revision: JSON.stringify([state.boards, state.assets, state.jobs]) }
      if (path === '/api/studio') return structuredClone({ ...state, stateRevision: JSON.stringify([state.boards, state.assets, state.jobs]) })
      if (path === '/api/studio/copy') return copySelection(state.boards[0], body.nodeIds, createTypes(), state.assets)
      if (path === '/api/studio/generation-library') {
        if (libraryService) return libraryService({ method, body, state })
        return library ? structuredClone(library) : { prompts: [], models: [], cards: [], results: [], suffixes: [], history: [] }
      }
      if (path === '/api/studio/asset-favorites') {
        if (method === 'POST') { if (body.favorite) assetFavorites.add(body.assetId); else assetFavorites.delete(body.assetId) }
        return { assetIds: [...assetFavorites] }
      }
      if (path === '/api/studio/result-parameters') {
        const sourceBoard = state.boards.find(board => board.id === body.boardId), result = sourceBoard?.nodes.find(node => node.id === body.nodeId)
        const job = state.jobs.find(job => job.resultNodeId === result?.id)
        if (!job?.cardSnapshot) throw Error('找不到这张结果的生成参数')
        const node = structuredClone(job.cardSnapshot)
        delete node.id; delete node.x; delete node.y
        return { node, sourceTitle: job.cardSnapshot.title }
      }
      if (path === '/api/studio/llm/config') {
        if (method !== 'POST') return structuredClone(state.llmConfig)
        const models = state.llmConfig.models
        if (body.action === 'delete') {
          state.llmConfig.models = models.filter(item => item.id !== body.id)
          if (state.llmConfig.defaultModelId === body.id) state.llmConfig.defaultModelId = state.llmConfig.models[0]?.id || null
        } else if (body.action === 'default') state.llmConfig.defaultModelId = body.id
        else {
          const item = { id: body.id || 'llm-config-test', name: body.name, baseUrl: body.baseUrl, model: body.model, hasKey: true, reasoningMode: body.reasoningMode, reasoningEffort: body.reasoningEffort }
          const index = models.findIndex(model => model.id === item.id)
          if (index >= 0) models[index] = item; else models.push(item)
          if (body.default || !state.llmConfig.defaultModelId) state.llmConfig.defaultModelId = item.id
        }
        return structuredClone(state.llmConfig)
      }
      if (path === '/api/studio/prompt-optimizations') {
        if (method !== 'POST') return structuredClone(state.promptOptimizations)
        if (body.action === 'delete') state.promptOptimizations.templates = state.promptOptimizations.templates.filter(item => item.id !== body.id)
        else {
          const item = { id: body.id || 'optimization-' + state.promptOptimizations.templates.length, title: body.title, instruction: body.instruction, createdAt: 1, updatedAt: 2 }
          const index = state.promptOptimizations.templates.findIndex(template => template.id === item.id)
          if (index >= 0) state.promptOptimizations.templates[index] = item; else state.promptOptimizations.templates.push(item)
        }
        return structuredClone(state.promptOptimizations)
      }
      if (path === '/api/studio/prompt-optimize') {
        state.lastOptimizeRequest = structuredClone(body)
        return { prompt: '优化后的主提示词', originalPrompt: body.prompt, template: { id: body.templateId, title: '英文' }, model: { id: 'llm-config-test', name: '测试模型', model: 'gpt-test' } }
      }
      if (path === '/api/studio/llm/test') return { ok: true, message: 'OK' }
      if (path.startsWith('/api/studio/providers/wavespeed/model?')) {
        const id = new URL(path, 'http://localhost').searchParams.get('id')
        if (!models[id]) throw Error('测试模型不存在')
        return structuredClone(models[id])
      }
      if (path.startsWith('/api/studio/providers/wavespeed/models?')) return { items: Object.values(models), total: Object.keys(models).length, catalogTotal: Object.keys(models).length, types: [], offset: 0, limit: 30 }
      if (path === '/api/studio/edit') {
        const boardIndex = state.boards.findIndex(board => board.id === body.boardId)
        if (boardIndex < 0) throw Error('画板不存在')
        if (body.revision !== state.boards[boardIndex].revision) throw Object.assign(Error('画布已变化'), { status: 409 })
        editBatches.push(structuredClone(body.operations))
        const inverse = []
        for (const op of body.operations) { const result = applyOperation(state.boards[boardIndex], op, state.assets); state.boards[boardIndex] = result.board; inverse.unshift(result.inverse) }
        return { board: structuredClone(state.boards[boardIndex]), inverse }
      }
      if (path === '/api/studio/generate') { generated.push(structuredClone(state.boards[0])); return { id: 'job', status: 'queued' } }
      if (path === '/api/studio/cancel') { state.cancelledJob = body.id; const job = state.jobs.find(item => item.id === body.id); if (job) job.status = 'interrupted'; return { ok: true } }
      if (path === '/api/studio/upload') {
        state.uploadRequested = true
        if (state.uploadGate) await state.uploadGate
        const asset = { id: 'uploaded-reference', name: body.name, kind: 'image', width: 80, height: 60 }
        state.assets[asset.id] = asset; return structuredClone(asset)
      }
      if (path === '/api/studio/import') { const asset = { id: 'imported-image', name: '参考图', width: 8, height: 6 }; state.assets[asset.id] = asset; return structuredClone(asset) }
      if (path === '/api/application-data-directory') {
        if (method === 'POST') { state.dataDirectoryAction = { action: body.action, path: body.path }; return { path: body.path } }
        return { app: { id: 'studio', name: '灵感画布' }, path: 'C:/cordis/data/apps/studio', defaultPath: 'C:/cordis/data/apps/studio', standalone: false }
      }
      if (path === '/api/application-data-directory/pick') return { path: 'C:/cordis/studio-copy' }
      throw Error('未处理请求：' + path)
    },
  }
  t.after(async () => { for (const cleanup of cleanups.reverse()) await cleanup?.(); await window.happyDOM.close(); Object.assign(globalThis, previous) })
  state.providers = [{ id: Object.keys(models).length ? 'fake' : 'wavespeed', label: '测试服务', defaultProvider: true, hasKey: true, model: 'test-model', ratios: ['auto', '1:1'], resolutions: ['1k'] }]
  if (Object.keys(models).length) state.providers.push({ id: 'wavespeed', label: 'WaveSpeed', defaultProvider: false, hasKey: true, modelCatalog: true, resumable: true })
  state.providers.push(...providers)
  const modules = { canvas: client, ui, basic, generation, agent }, running = new Map()
  async function start(id) {
    const releases = [], child = Object.create(ctx)
    child.effect = fn => { const release = fn(); let active = true; const dispose = () => { if (active) { active = false; return release?.() } }; releases.push(dispose); return dispose }
    const childSdk = { ...sdk,
      provide(name, service) { ctx[name] = service; child.effect(() => () => { if (ctx[name] === service) delete ctx[name] }); return service },
      mount(name, node) { sdk.mount(name, node); child.effect(() => () => node.remove()) },
      listen(target, name, fn) { target.addEventListener(name, fn); child.effect(() => () => target.removeEventListener(name, fn)) },
      agent: { register(definition, callback) { tools.set(definition.name, callback); child.effect(() => () => tools.delete(definition.name)) } },
    }
    const stop = async () => { for (const release of releases.reverse()) await release(); running.delete(id) }
    running.set(id, stop); cleanups.push(stop)
    await modules[id](child, childSdk)
  }
  for (const id of Object.keys(modules)) await start(id)
  return { window, state, tools, hooks, generated, toasts, editBatches, assetFavorites, ctx, start, stop: id => running.get(id)() }
}

async function waitUntil(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail('等待自动保存超时')
}

const dynamicModels = () => Object.fromEntries(normalizeModels(structuredClone(modelRows)))
async function addDynamic(env, model = 'mock/image', extra = {}) {
  await env.tools.get('studio_edit')({ revision: 0, operations: [{ type: 'add', node: { id: 'g', type: 'generator', provider: 'wavespeed', model, prompt: '测试', ...extra } }] })
  await waitUntil(() => env.window.document.querySelector('[data-parameter]'))
}

test('默认生成服务与 Pixel 的图片比例支持自动', async t => {
  const { window, state, tools } = await setup(t)
  await tools.get('studio_edit')({ revision: 0, operations: [{ type: 'add', node: { id: 'g', type: 'generator', prompt: '测试' } }] })
  await waitUntil(() => window.document.querySelector('.studio-generation-options select'))
  const ratio = window.document.querySelector('.studio-generation-options select')
  assert.deepEqual([...ratio.options].map(option => [option.value, option.textContent]), [['auto', '自动'], ['1:1', '1:1']])
  ratio.value = 'auto'; await ratio.onchange()
  await waitUntil(() => state.boards[0].nodes[0].ratio === 'auto')
})

test('4dai 生成卡独立选择 Sunburst 和 Flare，切换服务时写入卡片模型', async t => {
  const models = [
    { id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst' },
    { id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare' },
  ]
  const provider = { id: 'four-dai', label: '4dai · GPT Image', model: models[0].id, models, hasKey: true, ratios: ['auto', '1:1'], resolutions: ['1k'] }
  const { window, state, tools, ctx, generated } = await setup(t, { providers: [provider] })
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'g1', type: 'generator', model: 'other-provider-model', prompt: '第一张', x: 0, y: 0 } },
    { type: 'add', node: { id: 'g2', type: 'generator', provider: 'four-dai', prompt: '第二张', x: 500, y: 0 } },
  ] })
  const card = id => window.document.querySelector('[data-node="' + id + '"]')
  await waitUntil(() => card('g1')?.querySelector('[aria-label="图片服务"]') && card('g2')?.querySelector('[aria-label="4dai 模型"]'))
  const service = card('g1').querySelector('[aria-label="图片服务"]')
  service.value = 'four-dai'; await service.onchange()
  assert.equal(state.boards[0].nodes.find(node => node.id === 'g1').model, models[0].id)
  const first = card('g1').querySelector('[aria-label="4dai 模型"]')
  assert.deepEqual([...first.options].map(option => option.value), models.map(model => model.id))
  first.value = models[1].id; await first.onchange()
  assert.equal(state.boards[0].nodes.find(node => node.id === 'g1').model, models[1].id)
  assert.match(card('g1').querySelector('.studio-job-status').textContent, /gpt-image-2.5-flare/)
  assert.equal(card('g2').querySelector('[aria-label="4dai 模型"]').value, models[0].id, '旧卡片沿用设置中的默认模型')
  await ctx.canvasSession.execute('generate', { nodeId: 'g1' })
  assert.equal(generated[0].nodes.find(node => node.id === 'g1').model, models[1].id)
  const second = card('g2').querySelector('[aria-label="4dai 模型"]')
  second.value = models[0].id; await second.onchange()
  assert.equal(state.boards[0].nodes.find(node => node.id === 'g2').model, models[0].id)
  assert.equal(state.boards[0].nodes.find(node => node.id === 'g1').model, models[1].id)
  const back = card('g1').querySelector('[aria-label="图片服务"]')
  back.value = ''; await back.onchange()
  assert.equal(state.boards[0].nodes.find(node => node.id === 'g1').model, '', '离开 4dai 时不保留其模型 ID 给其他服务')
  assert.equal(card('g1').querySelector('[aria-label="4dai 模型"]'), null)
})

test('速登与 4dai 独立选模型，卡片切换渠道时保留兼容模型', async t => {
  const models = [
    { id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare' },
    { id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst' },
  ]
  const sudeng = { id: 'sudeng', label: '速登 · GPT Image', model: models[0].id, models, hasKey: true, ratios: ['auto', '1:1'], resolutions: ['1k'] }
  const fourDai = { id: 'four-dai', label: '4dai · GPT Image', model: models[1].id, models, hasKey: true, ratios: ['auto', '1:1'], resolutions: ['1k'] }
  const { window, state, tools, ctx, generated } = await setup(t, { providers: [sudeng, fourDai] })
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'g1', type: 'generator', provider: 'sudeng', prompt: '第一张', x: 0, y: 0 } },
    { type: 'add', node: { id: 'g2', type: 'generator', provider: 'sudeng', prompt: '第二张', x: 500, y: 0 } },
  ] })
  const card = id => window.document.querySelector('[data-node="' + id + '"]')
  await waitUntil(() => card('g1')?.querySelector('[aria-label="速登模型"]') && card('g2')?.querySelector('[aria-label="速登模型"]'))
  const first = card('g1').querySelector('[aria-label="速登模型"]')
  assert.deepEqual([...first.options].map(option => option.value), models.map(model => model.id))
  first.value = models[1].id; await first.onchange()
  assert.equal(state.boards[0].nodes.find(node => node.id === 'g1').model, models[1].id)
  assert.equal(card('g2').querySelector('[aria-label="速登模型"]').value, models[0].id)
  await ctx.canvasSession.execute('generate', { nodeId: 'g1' })
  assert.equal(generated[0].nodes.find(node => node.id === 'g1').model, models[1].id)
  const selector = card('g1').querySelector('[aria-label="图片服务"]')
  selector.value = 'four-dai'; await selector.onchange()
  assert.equal(state.boards[0].nodes.find(node => node.id === 'g1').model, models[1].id)
  assert.equal(card('g1').querySelector('[aria-label="4dai 模型"]').value, models[1].id)
  assert.equal(card('g2').querySelector('[aria-label="速登模型"]').value, models[0].id)
})

test('任务占位卡通过共享动作取消，并在生成插件停用后显示不可用状态', async t => {
  const { window, state, ctx, tools, stop } = await setup(t), jobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const job = { id: jobId, boardId: state.boards[0].id, nodeId: 'pending', provider: 'wavespeed', status: 'running', createdAt: 1 }
  state.jobs.push(job); ctx.canvasSession.state.jobs.push(structuredClone(job))
  await tools.get('studio_edit')({ revision: 0, operations: [{ type: 'add', node: { id: 'pending', type: 'image', title: '生成中', sourceNodeId: 'generator', jobId } }] })
  const cancel = [...window.document.querySelectorAll('.studio-pending-actions button')].find(button => /停止生成|暂停查询/.test(button.textContent))
  assert.ok(cancel)
  await cancel.onclick()
  assert.equal(state.cancelledJob, jobId)
  assert.equal(state.jobs[0].status, 'interrupted')
  await stop('generation')
  assert.match(window.document.querySelector('.studio-pending-media').textContent, /生成插件未启用/)
  assert.equal(window.document.querySelector('.studio-pending-actions button'), null)
})

test('图片和视频结果卡在低倍率总览显示实际任务状态', async t => {
  const { window, state, ctx, tools } = await setup(t)
  const ids = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']
  for (const id of ids) {
    const job = { id, status: 'queued', boardId: state.boards[0].id, provider: 'wavespeed' }
    state.jobs.push(job); ctx.canvasSession.state.jobs.push(structuredClone(job))
  }
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'pending-image', type: 'image', jobId: ids[0], sourceNodeId: 'generator', x: 0, y: 0 } },
    { type: 'add', node: { id: 'pending-video', type: 'video', jobId: ids[1], sourceNodeId: 'generator', x: 400, y: 0 } },
  ] })
  ctx.canvasSession.viewport = { x: 0, y: 0, zoom: 0.18 }; ctx.canvasUI.render()
  for (const [status, label] of [['queued', '排队中'], ['running', '正在生成'], ['paused', '已暂停查询'], ['failed', '生成失败'], ['interrupted', '生成已中断']]) {
    for (const job of ctx.canvasSession.state.jobs) job.status = status
    ctx.canvasUI.render()
    assert.match(window.document.querySelector('[data-node="pending-image"] .studio-overview-placeholder').textContent, new RegExp(label))
    assert.match(window.document.querySelector('[data-node="pending-video"] .studio-overview-placeholder').textContent, new RegExp(label))
  }
})

test('深色模式跟随系统、可切换并记住用户选择', async t => {
  const { window, start, stop } = await setup(t, { systemDark: true })
  let root = window.document.querySelector('.studio-app'), toggle = window.document.querySelector('.studio-theme-toggle')
  assert.equal(root.dataset.theme, 'dark')
  assert.equal(root.style.colorScheme, 'dark')
  assert.equal(toggle.getAttribute('aria-pressed'), 'true')
  toggle.click()
  assert.equal(root.dataset.theme, 'light')
  assert.equal(window.localStorage.getItem('studio-theme'), 'light')
  await stop('ui'); await start('ui')
  root = window.document.querySelector('.studio-app'); toggle = window.document.querySelector('.studio-theme-toggle')
  assert.equal(root.dataset.theme, 'light')
  assert.equal(toggle.getAttribute('aria-pressed'), 'false')
})

test('应用设置页承载数据目录，不再占用宿主顶栏', async t => {
  const { window } = await setup(t)
  const document = window.document, entry = document.querySelector('.studio-app-settings-entry')
  assert.equal(document.querySelector('#manage-data'), null)
  assert.equal(entry.textContent, '⚙ 应用设置')
  await entry.onclick()
  const dialog = document.querySelector('.studio-app-settings')
  await waitUntil(() => dialog.querySelector('#studio-app-data-path').textContent.includes('data/apps/studio'))
  assert.equal(dialog.open, true)
  assert.match(dialog.textContent, /仅当前应用/)
  assert.match(dialog.textContent, /笔记、画图和项目状态不会随这里切换/)
  dialog.getBoundingClientRect = () => ({ left: 100, top: 100, right: 600, bottom: 500, width: 500, height: 400, x: 100, y: 100 })
  dialog.dispatchEvent(new window.MouseEvent('click', { bubbles: true, clientX: 250, clientY: 250 }))
  assert.equal(dialog.open, true, '点击弹窗内部留白不应关闭')
  dialog.dispatchEvent(new window.MouseEvent('click', { bubbles: true, clientX: 750, clientY: 250 }))
  assert.equal(dialog.open, false, '点击弹窗外仍应关闭')
})

test('提示词优化按钮使用默认模型，预览后才替换主提示词', async t => {
  const { window, state, tools } = await setup(t, {
    llmConfig: { format: 'openai-responses', defaultModelId: 'llm-one', models: [{ id: 'llm-one', name: '主模型', baseUrl: 'https://api.example.com/v1', model: 'gpt-test', hasKey: true }] },
    promptOptimizations: { templates: [{ id: 'english', title: '改成英文', instruction: '把提示词全部改成英文', createdAt: 1, updatedAt: 2 }] },
  })
  await tools.get('studio_edit')({ revision: 0, operations: [{ type: 'add', node: {
    id: 'g', type: 'generator', prompt: '一段主提示词', promptSuffixes: [{ id: 'fixed', title: '固定镜头', text: '固定镜头，无 bgm', enabled: true }],
  } }] })
  await waitUntil(() => window.document.querySelector('[data-node="g"] .studio-prompt-optimizer'))
  const optimize = window.document.querySelector('[data-node="g"] .studio-prompt-optimizer')
  assert.equal(optimize.textContent, '改成英文')
  await optimize.onclick()
  await waitUntil(() => window.document.querySelector('.studio-optimizer-preview').open)
  assert.equal(state.lastOptimizeRequest.prompt, '一段主提示词', '优化只应发送主提示词，不包含固定尾缀')
  assert.equal(state.boards[0].nodes.find(node => node.id === 'g').prompt, '一段主提示词', '预览阶段不应修改卡片')
  const dialog = window.document.querySelector('.studio-optimizer-preview')
  assert.match(dialog.textContent, /一段主提示词/)
  assert.match(dialog.textContent, /优化后的主提示词/)
  await [...dialog.querySelectorAll('button')].find(button => button.textContent === '使用优化结果').onclick()
  await waitUntil(() => state.boards[0].nodes.find(node => node.id === 'g').prompt === '优化后的主提示词')
  assert.equal(state.boards[0].nodes.find(node => node.id === 'g').promptSuffixes[0].text, '固定镜头，无 bgm')
  assert.equal(dialog.open, false)
})

test('应用设置展示多个大模型且默认模型用于优化', async t => {
  const { window } = await setup(t, {
    llmConfig: { format: 'openai-responses', defaultModelId: 'model-two', models: [
      { id: 'model-one', name: '备用模型', baseUrl: 'https://one.example.com/v1', model: 'model-one', hasKey: true },
      { id: 'model-two', name: '默认模型', baseUrl: 'https://two.example.com/v1', model: 'model-two', hasKey: true },
    ] },
  })
  await window.document.querySelector('.studio-app-settings-entry').onclick()
  const dialog = window.document.querySelector('.studio-app-settings')
  await waitUntil(() => /默认模型：默认模型/.test(dialog.textContent))
  assert.match(dialog.textContent, /备用模型/)
  assert.match(dialog.textContent, /https:\/\/one\.example\.com\/v1/)
  assert.match(dialog.textContent, /管理优化按钮/)
  assert.doesNotMatch(dialog.textContent, /sk-secret/)
})

test('大模型设置可保存推理模式和强度，编辑时回显且清空时恢复默认', async t => {
  const { window, state } = await setup(t)
  await window.document.querySelector('.studio-app-settings-entry').onclick()
  const host = window.document.querySelector('.studio-llm-settings')
  const mode = host.querySelector('[aria-label="推理模式"]'), effort = host.querySelector('[aria-label="推理强度"]')
  const clickButton = (parent, text) => [...parent.querySelectorAll('button')].find(button => button.textContent === text).onclick()
  const changeMode = value => { mode.value = value; mode.dispatchEvent(new window.Event('change')) }
  assert.equal(mode.value, 'default'); assert.equal(effort.disabled, true)
  host.querySelector('input[type=text]').value = '测试推理模型'
  host.querySelector('input[type=url]').value = 'https://api.example.com/v1'
  host.querySelector('input[placeholder="例如：gpt-5.1"]').value = 'model-a'
  host.querySelector('input[type=password]').value = 'secret-test'
  changeMode('on'); assert.equal(effort.disabled, false)
  effort.value = 'xhigh'
  await clickButton(host, '保存模型')
  assert.equal(state.llmConfig.models[0].reasoningMode, 'on')
  assert.equal(state.llmConfig.models[0].reasoningEffort, 'xhigh')
  assert.equal(mode.value, 'default'); assert.equal(effort.value, 'medium'); assert.equal(effort.disabled, true)
  assert.match(host.querySelector('.studio-llm-model').textContent, /推理：极高/)
  await clickButton(host.querySelector('.studio-llm-model'), '编辑')
  assert.equal(mode.value, 'on'); assert.equal(effort.value, 'xhigh'); assert.equal(effort.disabled, false)
  assert.equal(host.querySelector('input[type=password]').value, '')
  changeMode('off'); assert.equal(effort.disabled, true)
  await clickButton(host, '保存修改')
  assert.equal(state.llmConfig.models[0].reasoningMode, 'off')
  assert.match(host.querySelector('.studio-llm-model').textContent, /推理：关闭/)
  await clickButton(host.querySelector('.studio-llm-model'), '编辑')
  assert.equal(mode.value, 'off'); assert.equal(effort.disabled, true)
  changeMode('on'); assert.equal(effort.value, 'xhigh')
  await clickButton(host, '清空')
  assert.equal(mode.value, 'default'); assert.equal(effort.value, 'medium'); assert.equal(effort.disabled, true)
})

test('模型参数快速输入后立即生成使用最新值，change 与 blur 同时保存只写一次', async t => {
  const env = await setup(t, { models: dynamicModels() }), { window, state, ctx, generated } = env
  await addDynamic(env)
  let steps = window.document.querySelector('[data-parameter="/steps"]')
  assert.equal(steps.value, '20')
  steps.onfocus(); steps.value = '7'; steps.oninput()
  await ctx.canvasSession.execute('generate', { nodeId: 'g' })
  assert.equal(generated[0].nodes[0].modelParameters['wavespeed:mock/image'].steps, 7)
  const revision = state.boards[0].revision
  steps.value = '9'; steps.oninput()
  await Promise.all([steps.onchange(), steps.onblur()])
  assert.equal(state.boards[0].nodes[0].modelParameters['wavespeed:mock/image'].steps, 9)
  assert.equal(state.boards[0].revision, revision + 1)
  steps = window.document.querySelector('[data-parameter="/steps"]')
  steps.onfocus(); steps.value = '11'; steps.oninput()
  const seed = window.document.querySelector('[data-parameter="/seed"]')
  seed.value = '42'; seed.oninput()
  await ctx.canvasSession.flush()
  assert.deepEqual(state.boards[0].nodes[0].modelParameters['wavespeed:mock/image'], { steps: 11, seed: 42 })
})

test('前一个输入框失焦保存结束后，不打断另一个参数的输入或允许 Agent 覆盖', async t => {
  const env = await setup(t, { models: dynamicModels() }), { window, ctx, generated, toasts } = env
  await addDynamic(env)
  const steps = window.document.querySelector('[data-parameter="/steps"]')
  const strength = window.document.querySelector('[data-parameter="/options/strength"]')
  const prompt = window.document.querySelector('.studio-generator textarea')
  for (const input of [steps, prompt, window.document.querySelector('[aria-label="画板名称"]')]) {
    input.onfocus(); input.value = input === steps ? '28' : '连续编辑'; input.oninput()
    const blurred = input.onblur()
    strength.onfocus(); strength.value = '0.7'; strength.oninput()
    await blurred
    assert.equal(ctx.canvasSession.editing, true)
    assert.equal(ctx.canvasSession.editable(), false)
    assert.equal(window.document.querySelector('[data-parameter="/options/strength"]'), strength)
  }
  strength.value = '0.8'; strength.oninput()
  await ctx.canvasSession.execute('generate', { nodeId: 'g' })
  assert.equal(generated[0].nodes[0].modelParameters['wavespeed:mock/image'].options.strength, 0.8)
  await strength.onblur()
  assert.equal(ctx.canvasSession.editing, false)
  assert.deepEqual(toasts, [])
})

test('动态模型参数自动保存后继续编辑，切换模型及重新加载视图保留各自数值', async t => {
  const env = await setup(t, { models: dynamicModels() }), { window, state, ctx, tools, start, stop, toasts } = env
  await addDynamic(env)
  const steps = window.document.querySelector('[data-parameter="/steps"]')
  steps.onfocus(); steps.value = '8'; steps.oninput()
  await waitUntil(() => !ctx.canvasSession.drafts.size)
  steps.value = '12'; steps.oninput(); await steps.onblur()
  assert.deepEqual(toasts, [])
  const selectModel = async model => tools.get('studio_edit')({ revision: state.boards[0].revision, operations: [{ type: 'update', id: 'g', patch: { model } }] })
  await selectModel('mock/video'); await waitUntil(() => window.document.querySelector('[data-parameter="/duration"]'))
  const duration = window.document.querySelector('[data-parameter="/duration"]')
  duration.value = '1'; duration.oninput(); await duration.onblur()
  await selectModel('mock/image'); await waitUntil(() => window.document.querySelector('[data-parameter="/steps"]'))
  assert.equal(window.document.querySelector('[data-parameter="/steps"]').value, '12')
  assert.equal(state.boards[0].nodes[0].modelParameters['wavespeed:mock/video'].duration, 5)
  await stop('generation'); await start('generation')
  await waitUntil(() => window.document.querySelector('[data-parameter="/steps"]'))
  assert.equal(window.document.querySelector('[data-parameter="/steps"]').value, '12')
})

test('错误 JSON 保留原文并阻止生成，修正后生成；对象参数遵守其他页面冲突保护', async t => {
  const env = await setup(t, { models: dynamicModels() }), { window, state, ctx, generated } = env
  await addDynamic(env)
  let metadata = window.document.querySelector('[data-parameter="/metadata"]')
  const run = () => [...window.document.querySelectorAll('button')].find(button => button.textContent === '✦ 生成图片')
  metadata.onfocus(); metadata.value = '{broken'; metadata.oninput()
  assert.equal(run().disabled, true, '输入错误参数时立即禁止生成，无需重绘输入框')
  await metadata.onblur()
  metadata = window.document.querySelector('[data-parameter="/metadata"]')
  assert.equal(metadata.value, '{broken')
  await assert.rejects(ctx.canvasSession.execute('generate', { nodeId: 'g' }), /修正模型参数/)
  assert.equal(generated.length, 0)
  metadata.onfocus(); metadata.value = '{"tag":"ok"}'; metadata.oninput()
  assert.equal(run().disabled, false, '修正参数后立即恢复生成，无需先离开编辑')
  await metadata.onblur()
  await ctx.canvasSession.execute('generate', { nodeId: 'g' })
  assert.equal(generated[0].nodes[0].modelParameters['wavespeed:mock/image'].metadata.tag, 'ok')
  const steps = window.document.querySelector('[data-parameter="/steps"]')
  steps.onfocus(); steps.value = '19'; steps.oninput()
  state.boards[0] = applyOperation(state.boards[0], { type: 'update', id: 'g', patch: { modelParameters: { 'wavespeed:mock/image': { steps: 30 } } } }, state.assets).board
  await assert.rejects(ctx.canvasSession.flush(), /其他页面/)
  assert.equal(state.boards[0].nodes[0].modelParameters['wavespeed:mock/image'].steps, 30)
  assert.equal(ctx.canvasSession.drafts.size, 1)
})

test('参考区共同排序卡片内和连线素材，可绑定首尾帧；Agent 可发现目录和恢复操作', async t => {
  const env = await setup(t, { models: dynamicModels() }), { window, state, tools } = env
  state.assets.one = { id: 'one', name: '卡片内图片', kind: 'image', width: 64, height: 48 }
  state.assets.two = { id: 'two', name: '连线图片', kind: 'image', width: 64, height: 48 }
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'i', type: 'image', assetId: 'two' } },
    { type: 'add', node: { id: 'g', type: 'generator', provider: 'wavespeed', model: 'mock/video', references: [{ id: 'inside', assetId: 'one' }] } },
    { type: 'connect', id: 'edge', from: 'i', to: 'g' },
  ] })
  await waitUntil(() => window.document.querySelector('[aria-label="参考素材 1 输入位置"]'))
  assert.deepEqual([...window.document.querySelectorAll('.studio-reference-row')].map(n => n.getAttribute('data-reference')), ['direct:inside', 'edge:edge'])
  assert.equal(window.document.querySelector('[aria-label="参考素材 1 下移"]'), null)
  await window.document.querySelector('[aria-label="调整参考素材 1 顺序"]').onkeydown({ key: 'ArrowDown', preventDefault() {} })
  await waitUntil(() => window.document.querySelectorAll('.studio-reference-row')[0]?.dataset.reference === 'edge:edge')
  await window.document.querySelector('[aria-label="调整参考素材 2 顺序"]').onkeydown({ key: 'ArrowUp', preventDefault() {} })
  await waitUntil(() => window.document.querySelectorAll('.studio-reference-row')[0]?.dataset.reference === 'direct:inside')
  const quick = window.document.querySelector('[aria-label="快速编辑参考素材 1"]')
  assert.ok(quick, '图片参考提供快速编辑入口')
  await quick.onclick()
  const editor = window.document.querySelector('.studio-quick-edit')
  assert.equal(editor.open, true)
  assert.ok(editor.querySelector('.studio-quick-edit-canvas'))
  assert.ok(editor.querySelector('[aria-label="笔刷粗细"]'))
  const mirror = editor.querySelector('.studio-quick-edit-mirror')
  assert.ok(mirror, '快速编辑提供一键镜像')
  assert.equal(mirror.getAttribute('aria-pressed'), 'false')
  await mirror.onclick()
  assert.equal(mirror.getAttribute('aria-pressed'), 'true')
  await mirror.onclick()
  assert.equal(mirror.getAttribute('aria-pressed'), 'false')
  const rotation = editor.querySelector('[aria-label="旋转角度"]')
  assert.ok(rotation, '快速编辑提供 360 度旋转')
  rotation.value = '90'; rotation.oninput()
  assert.match(editor.querySelector('.studio-quick-edit-tools').textContent, /90°/)
  const crop = editor.querySelector('.studio-quick-edit-crop-toggle')
  assert.ok(crop, '快速编辑提供裁切')
  assert.equal(crop.disabled, true, '原图加载前不能裁切')
  assert.equal(editor.querySelector('.studio-quick-edit-crop-clear').disabled, true, '未选择裁切区域时不能重置')
  assert.equal(editor.querySelector('.studio-quick-edit-actions .studio-primary').disabled, true, '未画线或未变换前不能保存')
  editor.close()
  assert.equal(editor.open, false)
  const rows = [...window.document.querySelectorAll('.studio-reference-row')]
  rows[0].getBoundingClientRect = () => ({ top: 100, height: 40, bottom: 140 })
  rows[1].getBoundingClientRect = () => ({ top: 146, height: 40, bottom: 186 })
  const grip = rows[1].querySelector('.studio-reference-grip'), pointer = (type, y) => grip.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 17, clientY: y }))
  pointer('pointerdown', 160)
  assert.equal(rows[1].classList.contains('is-pointer-dragging'), true)
  pointer('pointermove', 110)
  assert.equal(rows[0].classList.contains('is-drop-before'), true)
  pointer('pointerup', 110)
  await waitUntil(() => state.boards[0].nodes.find(n => n.id === 'g').referenceOrder?.[0] === 'edge:edge')
  assert.deepEqual(state.boards[0].nodes.find(n => n.id === 'g').referenceOrder, ['edge:edge', 'direct:inside'])
  const binding = window.document.querySelector('[aria-label="参考素材 1 输入位置"]')
  binding.value = '/start_image'; await binding.onchange()
  assert.equal(state.boards[0].nodes.find(n => n.id === 'g').referenceBindings['wavespeed:mock/video']['edge:edge'], '/start_image')
  const actions = tools.get('studio_read')().actions.map(a => a.id)
  for (const id of ['models', 'model', 'resume', 'detach']) assert.ok(actions.includes(id))
  const catalog = await tools.get('studio_action')({ id: 'models', revision: state.boards[0].revision, args: { provider: 'wavespeed', kind: 'video' } })
  assert.ok(catalog.items.some(m => m.id === 'mock/video'))
})

test('快速替换参考图复用素材库并保留槽位、排序和输入绑定', async t => {
  const env = await setup(t, { models: dynamicModels() }), { window, state } = env
  state.assets.one = { id: 'one', name: '原图片.png', kind: 'image', width: 64, height: 48 }
  state.assets.two = { id: 'two', name: '新图片.png', kind: 'image', width: 96, height: 72 }
  state.assets.clip = { id: 'clip', name: '视频.mp4', kind: 'video', extension: 'mp4', width: 64, height: 64, duration: 2 }
  await addDynamic(env, 'mock/video', {
    references: [{ id: 'replace-me', assetId: 'one' }],
    referenceOrder: ['direct:replace-me'],
    referenceBindings: { 'wavespeed:mock/video': { 'direct:replace-me': '/start_image' } },
  })
  await waitUntil(() => window.document.querySelector('[aria-label="快速替换参考素材 1"]'))
  const controls = window.document.querySelector('.studio-reference-controls')
  assert.deepEqual([...controls.children].map(item => item.textContent), ['快速编辑', '快速替换', '×'])
  await window.document.querySelector('[aria-label="快速替换参考素材 1"]').onclick()
  const picker = window.document.querySelector('.studio-asset-picker')
  assert.equal(picker.open, true)
  assert.equal(picker.querySelector('h2').textContent, '快速替换参考图')
  assert.equal(picker.querySelector('input[type=file]').accept, 'image/png,image/jpeg,image/webp')
  assert.equal(picker.querySelector('[aria-label="使用素材 视频.mp4"]'), null, '快速替换只展示图片素材')
  await picker.querySelector('[aria-label="使用素材 新图片.png"]').onclick()
  await waitUntil(() => state.boards[0].nodes.find(node => node.id === 'g').references[0].assetId === 'two')
  const node = state.boards[0].nodes.find(node => node.id === 'g')
  assert.equal(picker.open, false)
  assert.deepEqual(node.referenceOrder, ['direct:replace-me'])
  assert.equal(node.referenceBindings['wavespeed:mock/video']['direct:replace-me'], '/start_image')
})

test('快速替换上传结束后始终写入发起上传时的参考槽位', async t => {
  const env = await setup(t, { models: dynamicModels() }), { window, state } = env
  state.assets.one = { id: 'one', name: '第一张.png', kind: 'image', width: 64, height: 48 }
  state.assets.two = { id: 'two', name: '第二张.png', kind: 'image', width: 96, height: 72 }
  await addDynamic(env, 'mock/video', { references: [
    { id: 'first', assetId: 'one' },
    { id: 'second', assetId: 'one' },
  ] })
  await waitUntil(() => window.document.querySelectorAll('[aria-label^="快速替换参考素材"]').length === 2)
  const replaces = [...window.document.querySelectorAll('[aria-label^="快速替换参考素材"]')]
  await replaces[0].onclick()
  let releaseUpload
  state.uploadGate = new Promise(resolve => { releaseUpload = resolve })
  const picker = window.document.querySelector('.studio-asset-picker'), input = picker.querySelector('input[type=file]')
  Object.defineProperty(input, 'files', { configurable: true, value: [new window.File(['png'], '上传替换.png', { type: 'image/png' })] })
  const pending = input.onchange()
  await waitUntil(() => state.uploadRequested)
  picker.querySelector('.studio-dialog-head button').onclick()
  await replaces[1].onclick()
  await picker.querySelector('[aria-label="使用素材 第二张.png"]').onclick()
  assert.equal(state.boards[0].nodes.find(node => node.id === 'g').references[1].assetId, 'two')
  releaseUpload()
  await pending
  await waitUntil(() => state.boards[0].nodes.find(node => node.id === 'g').references[0].assetId === 'uploaded-reference')
  const references = state.boards[0].nodes.find(node => node.id === 'g').references
  assert.equal(references[0].assetId, 'uploaded-reference')
  assert.equal(references[1].assetId, 'two')
})

test('快速替换连线参考图会断开原连线并迁移输入绑定', async t => {
  const env = await setup(t, { models: dynamicModels() }), { window, state, tools } = env
  state.assets.one = { id: 'one', name: '连线图片.png', kind: 'image', width: 64, height: 48 }
  state.assets.two = { id: 'two', name: '替换图片.png', kind: 'image', width: 96, height: 72 }
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'source', type: 'image', assetId: 'one' } },
    { type: 'add', node: { id: 'g', type: 'generator', provider: 'wavespeed', model: 'mock/video', referenceOrder: ['edge:linked'], referenceBindings: { 'wavespeed:mock/video': { 'edge:linked': '/start_image' } } } },
    { type: 'connect', id: 'linked', from: 'source', to: 'g' },
  ] })
  await waitUntil(() => window.document.querySelector('[aria-label="快速替换参考素材 1"]'))
  await window.document.querySelector('[aria-label="快速替换参考素材 1"]').onclick()
  const picker = window.document.querySelector('.studio-asset-picker')
  await picker.querySelector('[aria-label="使用素材 替换图片.png"]').onclick()
  await waitUntil(() => !state.boards[0].edges.some(edge => edge.id === 'linked'))
  const node = state.boards[0].nodes.find(item => item.id === 'g'), reference = node.references[0], key = 'direct:' + reference.id
  assert.equal(reference.assetId, 'two')
  assert.deepEqual(node.referenceOrder, [key])
  assert.deepEqual(node.referenceBindings['wavespeed:mock/video'], { [key]: '/start_image' })
})

test('素材拖入参考槽位时按模型能力拒绝不兼容类型', async t => {
  const env = await setup(t, { models: dynamicModels() }), { window, state, tools, toasts } = env
  state.assets.one = { id: 'one', name: '参考图片.png', kind: 'image', width: 64, height: 48 }
  state.assets.clip = { id: 'clip', name: '参考视频.mp4', kind: 'video', extension: 'mp4', width: 64, height: 64, duration: 2 }
  await tools.get('studio_edit')({ revision: 0, operations: [{ type: 'add', node: { id: 'g', type: 'generator', provider: 'wavespeed', model: 'mock/video-edit', prompt: '测试', references: [{ id: 'inside', assetId: 'one' }] } }] })
  await waitUntil(() => window.document.querySelector('.studio-reference-row'))
  await waitUntil(() => /不接受这类参考/.test(window.document.querySelector('.studio-references').textContent))
  const row = window.document.querySelector('.studio-reference-row'), transfer = id => ({ types: ['application/x-cordis-studio-asset'], getData: type => type === 'application/x-cordis-studio-asset' ? id : '', dropEffect: '' })
  await row.ondrop({ preventDefault() {}, stopPropagation() {}, dataTransfer: transfer('one') })
  assert.match(toasts.at(-1), /不接受图片参考/)
  assert.equal(state.boards[0].nodes.find(node => node.id === 'g').references[0].assetId, 'one')
  await row.ondrop({ preventDefault() {}, stopPropagation() {}, dataTransfer: transfer('clip') })
  await waitUntil(() => state.boards[0].nodes.find(node => node.id === 'g').references[0].assetId === 'clip')
})

test('参考区可先新建多个空槽位，再点槽位从素材库填入；空槽位不进入生成入参', async t => {
  const env = await setup(t), { window, state, tools } = env
  const asset = await tools.get('studio_import_image')({ path: 'C:/test/slot.png' })
  await tools.get('studio_edit')({ revision: 0, operations: [{ type: 'add', node: { id: 'g', type: 'generator', prompt: '槽位测试' } }] })
  const addSlot = () => window.document.querySelector('.studio-reference-add')
  await waitUntil(() => addSlot())
  assert.equal(addSlot().textContent, '＋ 添加参考')
  assert.doesNotMatch(window.document.querySelector('.studio-references').textContent, /共同排序/)
  const slotButton = addSlot()
  await Promise.all([slotButton.onclick(), slotButton.onclick()])
  await waitUntil(() => state.boards[0].nodes.find(node => node.id === 'g').references?.length === 2)
  const node = state.boards[0].nodes.find(node => node.id === 'g')
  assert.deepEqual(node.references.map(ref => ref.assetId), [null, null])
  assert.ok(node.references.every(ref => /^[a-f0-9-]{36}$/.test(ref.id)))
  assert.deepEqual(generationInput(state.boards[0], 'g').assetIds, [])
  assert.equal(window.document.querySelectorAll('.studio-reference-row.is-empty').length, 2)
  await window.document.querySelector('[aria-label="选择参考素材 2"]').onclick()
  const picker = window.document.querySelector('.studio-asset-picker')
  assert.equal(picker.open, true)
  await window.document.querySelector('[aria-label="使用素材 ' + asset.name + '"]').onclick()
  await waitUntil(() => state.boards[0].nodes.find(node => node.id === 'g').references[1].assetId === asset.id)
  assert.equal(picker.open, false)
  assert.deepEqual(generationInput(state.boards[0], 'g').assetIds, [asset.id])
  await waitUntil(() => window.document.querySelectorAll('.studio-reference-row.is-empty').length === 1)
  assert.ok(window.document.querySelector('.studio-picker-grid .is-upload'), '选择框提供本地上传入口')
  assert.equal(window.document.querySelector('.studio-asset-picker input[type=file]').accept, 'image/png,image/jpeg,image/webp')
  const rows = () => [...window.document.querySelectorAll('.studio-reference-row')], [first, second] = rows()
  first.getBoundingClientRect = () => ({ top: 100, height: 40, bottom: 140 })
  second.getBoundingClientRect = () => ({ top: 146, height: 40, bottom: 186 })
  const grip = first.querySelector('.studio-reference-grip'), pointer = (type, y) => grip.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 18, clientY: y }))
  pointer('pointerdown', 110); pointer('pointermove', 180)
  assert.equal(second.classList.contains('is-drop-after'), true)
  pointer('pointerup', 180)
  await waitUntil(() => state.boards[0].nodes.find(node => node.id === 'g').referenceOrder?.length === 2)
  const reordered = state.boards[0].nodes.find(node => node.id === 'g'), [slotRef, filledRef] = reordered.references
  assert.deepEqual(reordered.referenceOrder, ['direct:' + filledRef.id, 'direct:' + slotRef.id])
  await waitUntil(() => rows()[0].dataset.reference === 'direct:' + filledRef.id)
  assert.equal(window.document.querySelectorAll('.studio-reference-row.is-drop-after').length, 0)
})

test('卡片视图、生成操作与 Agent 可分别卸载和恢复，不删除内容或重复入口', async t => {
  const { window, tools, state, stop, start } = await setup(t)
  await tools.get('studio_edit')({ revision: 0, operations: [{ type: 'add', node: { id: 'g', type: 'generator', prompt: '保留内容' } }] })
  await stop('generation')
  assert.match(window.document.querySelector('.studio-missing-card').textContent, /对应功能/)
  assert.equal(state.boards[0].nodes[0].prompt, '保留内容')
  await assert.rejects(tools.get('studio_generate')({ nodeId: 'g', revision: state.boards[0].revision }), /不可用/)
  await start('generation')
  assert.deepEqual([...window.document.querySelector('.studio-action-dock').children].slice(0, 3).map(node => node.textContent), ['＋ 文字', '↑ 图片', '✦ 生成卡片'])
  assert.equal(window.document.querySelectorAll('.studio-generator textarea').length, 1)
  assert.equal(window.document.querySelector('textarea').value, '保留内容')
  await stop('agent')
  assert.equal(tools.size, 0)
  await [...window.document.querySelectorAll('button')].find(b => b.textContent === '＋ 文字').onclick()
  assert.equal(state.boards[0].nodes.length, 2)
  await start('agent')
  assert.equal(tools.size, 10)
})

test('前端扩展注册菜单、卡片和操作，Agent 可发现并执行；卸载撤销注册', async t => {
  const { window, tools, ctx } = await setup(t), releases = [], plugin = { effect(fn) { const release = fn(); releases.push(release); return release } }
  let calls = 0
  ctx.canvasUI.menu(plugin, { id: 'custom', label: '扩展入口', run: () => calls++ })
  ctx.canvasSession.actions.register(plugin, { id: 'custom-action', label: '扩展操作', schema: { type: 'object' }, run: () => ++calls })
  assert.ok(tools.get('studio_read')().actions.some(action => action.id === 'custom-action'))
  await tools.get('studio_action')({ id: 'custom-action', revision: 0 })
  await [...window.document.querySelectorAll('button')].find(b => b.textContent === '扩展入口').onclick()
  assert.equal(calls, 2)
  for (const release of releases.reverse()) release()
  assert.equal(tools.get('studio_read')().actions.some(action => action.id === 'custom-action'), false)
  assert.equal([...window.document.querySelectorAll('button')].some(b => b.textContent === '扩展入口'), false)
})

test('灵感卡片选择显示上下文工具，批量排列及带内部连线的副本一次撤销', async t => {
  const { window, tools, state } = await setup(t)
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'text', type: 'text', text: '参考文字', x: 0, y: 0 } },
    { type: 'add', node: { id: 'generator', type: 'generator', prompt: '提示词', x: 500, y: 30 } },
    { type: 'connect', id: 'edge', from: 'text', to: 'generator' },
  ] })
  const stage = window.document.querySelector('.studio-stage'), context = window.document.querySelector('.studio-context-tools')
  assert.equal(context.hidden, true)
  stage.focus()
  stage.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }))
  assert.equal(context.hidden, false)
  assert.match(context.textContent, /已选 2 张卡片.*整理为网格/)
  const original = structuredClone(state.boards[0].nodes)
  const click = text => [...window.document.querySelectorAll('button')].find(b => b.textContent === text).onclick()
  await click('整理为网格')
  assert.equal(state.boards[0].nodes[1].x, 336)
  assert.equal(state.boards[0].nodes[1].y, 0)
  assert.equal(state.boards[0].nodes[1].prompt, '提示词')
  await click('↶')
  assert.deepEqual(state.boards[0].nodes, original)
  await click('创建副本')
  assert.equal(state.boards[0].nodes.length, 4)
  assert.equal(state.boards[0].edges.length, 2)
  assert.notEqual(state.boards[0].edges[1].from, 'text')
  await click('↶')
  assert.deepEqual(state.boards[0].nodes, original)
  assert.equal(state.boards[0].edges.length, 1)
  window.document.querySelector('.studio-text').dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }))
  assert.match(context.textContent, /文字灵感.*编辑文字/)
  assert.doesNotMatch(context.textContent, /整理为网格|整理子集/)
})

test('选中卡片可置于顶层或底层，画布顺序持久化并可撤销', async t => {
  const { window, state, tools } = await setup(t)
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'a', type: 'text', text: '第一张', x: 0, y: 0 } },
    { type: 'add', node: { id: 'b', type: 'text', text: '第二张', x: 320, y: 0 } },
    { type: 'add', node: { id: 'c', type: 'text', text: '第三张', x: 640, y: 0 } },
  ] })
  await waitUntil(() => window.document.querySelector('[data-node="b"] .studio-card-head'))
  const head = window.document.querySelector('[data-node="b"] .studio-card-head'), context = window.document.querySelector('.studio-context-tools')
  head.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 71, clientX: 330, clientY: 20 }))
  window.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 71, clientX: 330, clientY: 20 }))
  assert.equal(context.hidden, false)
  assert.match(context.textContent, /置于顶层.*置于底层/)
  const click = label => [...context.querySelectorAll('button')].find(button => button.textContent === label).onclick()
  await click('置于顶层')
  await waitUntil(() => state.boards[0].nodes.at(-1).id === 'b')
  assert.deepEqual(state.boards[0].nodes.map(node => node.id), ['a', 'c', 'b'])
  await waitUntil(() => [...window.document.querySelector('.studio-cards').children].map(card => card.dataset.node).join() === 'a,c,b')
  await click('置于底层')
  await waitUntil(() => state.boards[0].nodes[0].id === 'b')
  assert.deepEqual(state.boards[0].nodes.map(node => node.id), ['b', 'a', 'c'])
  await [...window.document.querySelectorAll('button')].find(button => button.textContent === '↶').onclick()
  await waitUntil(() => state.boards[0].nodes.map(node => node.id).join() === 'a,c,b')
  assert.deepEqual([...window.document.querySelector('.studio-cards').children].map(card => card.dataset.node), ['a', 'c', 'b'])
})

test('图片和视频素材可等比缩放或调整显示框裁剪', async t => {
  const { window, state, tools, ctx } = await setup(t)
  state.assets.pic = ctx.canvasSession.rememberAsset({ id: 'pic', kind: 'image', name: '竖图.png', width: 300, height: 600 })
  state.assets.clip = ctx.canvasSession.rememberAsset({ id: 'clip', kind: 'video', name: '视频.mp4', extension: 'mp4', width: 640, height: 360, duration: 3 })
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'pic', type: 'image', assetId: 'pic', x: 100, y: 50 } },
    { type: 'add', node: { id: 'clip', type: 'video', assetId: 'clip', x: 600, y: 50 } },
  ] })
  await waitUntil(() => window.document.querySelector('[data-node="pic"] .studio-media-frame'))
  const select = id => {
    const head = window.document.querySelector(`[data-node="${id}"] .studio-card-head`)
    head.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 81, clientX: 110, clientY: 60 }))
    window.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 81, clientX: 110, clientY: 60 }))
  }
  const context = window.document.querySelector('.studio-context-tools')
  select('pic')
  assert.match(context.textContent, /缩放素材.*调整显示框/)
  await [...context.querySelectorAll('button')].find(button => button.textContent === '缩放素材').onclick()
  const overlay = window.document.querySelector('[data-node="pic"] .studio-resize-overlay')
  assert.ok(overlay, '进入缩放模式后显示调整框')
  assert.equal(overlay.querySelectorAll('.studio-resize-handle').length, 8)
  const drag = async (target, dir, from, to) => {
    target.querySelector(`[data-dir="${dir}"]`).dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 91, clientX: from, clientY: 200 }))
    await new Promise(resolve => setTimeout(resolve, 10))
    window.dispatchEvent(new window.PointerEvent('pointermove', { bubbles: true, button: 0, pointerId: 91, clientX: to, clientY: 200 }))
    window.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 91, clientX: to, clientY: 200 }))
  }
  await drag(overlay, 'e', 300, 360)
  await waitUntil(() => Number.isFinite(state.boards[0].nodes.find(node => node.id === 'pic').frameWidth))
  let image = state.boards[0].nodes.find(node => node.id === 'pic')
  assert.equal(image.mediaWidth, image.frameWidth, '等比缩放时素材宽度跟随显示框宽度')
  assert.equal(Math.round(image.frameHeight), Math.round(image.frameWidth * 2), '等比缩放保持素材宽高比')
  assert.equal(image.x, 100, '拖右侧缩放时不移动左边位置')
  const card = window.document.querySelector('[data-node="pic"]'), frame = card.querySelector('.studio-media-frame'), content = frame.querySelector('.studio-media-content')
  assert.equal(card.style.width, Math.round(image.frameWidth + 4) + 'px')
  assert.equal(frame.style.height, Math.round(image.frameHeight) + 'px')
  assert.equal(content.style.width, Math.round(image.mediaWidth) + 'px')
  const scaledWidth = image.frameWidth, mediaWidth = image.mediaWidth
  await [...context.querySelectorAll('button')].find(button => button.textContent === '调整显示框').onclick()
  const frameOverlay = window.document.querySelector('[data-node="pic"] .studio-resize-overlay')
  await drag(frameOverlay, 'e', 300, 240)
  await waitUntil(() => state.boards[0].nodes.find(node => node.id === 'pic').frameWidth < scaledWidth)
  const cropped = state.boards[0].nodes.find(node => node.id === 'pic')
  assert.ok(cropped.frameWidth < scaledWidth, '调整显示框时宽度独立变化')
  assert.equal(cropped.mediaWidth, mediaWidth, '调整显示框不缩放内部素材')
  assert.equal(cropped.frameHeight, image.frameHeight, '只拖右侧不改变显示框高度')
  const undo = () => [...window.document.querySelectorAll('button')].find(button => button.textContent === '↶').onclick()
  await undo()
  await waitUntil(() => state.boards[0].nodes.find(node => node.id === 'pic').frameWidth === Math.round(scaledWidth))
  await undo()
  await waitUntil(() => state.boards[0].nodes.find(node => node.id === 'pic').frameWidth === undefined)
  assert.equal(window.document.querySelector('[data-node="pic"]').style.width, '', '撤销缩放后恢复默认卡片宽度')
  select('clip')
  assert.match(context.textContent, /缩放素材.*调整显示框/, '视频也提供两种调整入口')
})

async function startProtectedResize(t) {
  const env = await setup(t), { window, state, ctx, tools } = env
  state.assets.pic = ctx.canvasSession.rememberAsset({ id: 'pic', kind: 'image', width: 300, height: 600 })
  await tools.get('studio_edit')({ revision: 0, operations: [{ type: 'add', node: { id: 'pic', type: 'image', assetId: 'pic', x: 0, y: 0 } }] })
  ctx.canvasUI.select(['pic'])
  await [...window.document.querySelectorAll('.studio-context-tools button')].find(button => button.textContent === '缩放素材').onclick()
  const pointer = (type, x = 300) => new window.PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 91, clientX: x, clientY: 200 })
  window.document.querySelector('.studio-resize-handle[data-dir="e"]').dispatchEvent(pointer('pointerdown'))
  assert.equal(ctx.canvasSession.editable(), false, '等待草稿保存期间也应锁定交互')
  await new Promise(resolve => setTimeout(resolve, 10))
  window.dispatchEvent(pointer('pointermove', 400))
  env.toasts.length = 0
  return { ...env, pointer }
}

test('媒体缩放拖拽阻止 Agent 修改，保存完成后恢复编辑', async t => {
  const { window, state, ctx, tools, pointer, toasts } = await startProtectedResize(t)
  await assert.rejects(tools.get('studio_edit')({ revision: state.boards[0].revision, operations: [{ type: 'update', id: 'pic', patch: { frameWidth: 500, frameHeight: 500, mediaWidth: 500 } }] }), /用户正在编辑/)
  window.dispatchEvent(pointer('pointerup', 400))
  await waitUntil(() => ctx.canvasSession.editable())
  assert.ok(state.boards[0].nodes[0].frameWidth > 80)
  assert.deepEqual(toasts, [])
})

test('媒体缩放拖拽遇到远端版本冲突时保留远端尺寸并恢复显示', async t => {
  const { window, state, ctx, pointer, toasts } = await startProtectedResize(t)
  state.boards[0] = applyOperation(state.boards[0], { type: 'update', id: 'pic', patch: { frameWidth: 700, frameHeight: 500, mediaWidth: 600 } }, state.assets).board
  await ctx.canvasSession.refresh({ fresh: true })
  assert.equal(ctx.canvasSession.board().nodes[0].frameWidth, undefined, '拖拽期间不替换本地画板')
  window.dispatchEvent(pointer('pointerup', 400))
  await waitUntil(() => toasts.length > 0 && ctx.canvasSession.board().nodes[0].frameWidth === 700)
  assert.equal(state.boards[0].nodes[0].frameWidth, 700)
  assert.match(toasts[0], /画布已变化/)
  assert.equal(window.document.querySelector('[data-node="pic"]').style.width, '704px')
  assert.equal(ctx.canvasSession.editable(), true)
})

test('媒体缩放提交校验拖拽起点版本而非更新后的本地版本', async t => {
  const { window, state, ctx, pointer, toasts } = await startProtectedResize(t)
  await ctx.canvasSession.edit([{ type: 'update', id: 'pic', patch: { frameWidth: 900, frameHeight: 500, mediaWidth: 600 } }])
  window.dispatchEvent(pointer('pointerup', 400))
  await waitUntil(() => toasts.some(message => /画布已变化/.test(message)))
  assert.equal(state.boards[0].nodes[0].frameWidth, 900)
  await waitUntil(() => ctx.canvasSession.editable())
  assert.equal(window.document.querySelector('[data-node="pic"]').style.width, '904px')
})

test('媒体缩放取消和扩展卸载均释放交互保护且不保存预览', async t => {
  const { window, state, ctx, pointer, stop } = await startProtectedResize(t)
  window.dispatchEvent(pointer('pointercancel'))
  assert.equal(ctx.canvasSession.editable(), true)
  assert.equal(state.boards[0].nodes[0].frameWidth, undefined)
  assert.equal(window.document.querySelector('[data-node="pic"]').style.width, '')
  window.document.querySelector('.studio-resize-handle[data-dir="e"]').dispatchEvent(pointer('pointerdown'))
  assert.equal(ctx.canvasSession.editable(), false)
  await stop('basic')
  assert.equal(ctx.canvasSession.editable(), true)
  assert.equal(state.boards[0].nodes[0].frameWidth, undefined)
})

test('图片和视频可设置透明度并保存，调整后能看到后方内容', async t => {
  const { window, state, tools, ctx } = await setup(t)
  state.assets.pic = ctx.canvasSession.rememberAsset({ id: 'pic', kind: 'image', name: '透明图.png', width: 300, height: 200 })
  state.assets.clip = ctx.canvasSession.rememberAsset({ id: 'clip', kind: 'video', name: '透明视频.mp4', extension: 'mp4', width: 640, height: 360, duration: 3 })
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'pic', type: 'image', assetId: 'pic', x: 100, y: 50 } },
    { type: 'add', node: { id: 'clip', type: 'video', assetId: 'clip', x: 600, y: 50 } },
  ] })
  await waitUntil(() => window.document.querySelector('[data-node="pic"] .studio-media-frame'))
  const select = id => {
    const head = window.document.querySelector(`[data-node="${id}"] .studio-card-head`)
    head.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 83, clientX: 110, clientY: 60 }))
    window.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 83, clientX: 110, clientY: 60 }))
  }
  const context = window.document.querySelector('.studio-context-tools')
  select('pic')
  assert.match(context.textContent, /透明度/, '图片提供透明度入口')
  await [...context.querySelectorAll('button')].find(button => button.textContent === '透明度').onclick()
  const panel = window.document.querySelector('.studio-media-opacity-panel')
  assert.equal(panel.hidden, false)
  const card = window.document.querySelector('[data-node="pic"]'), content = card.querySelector('.studio-media-content'), slider = panel.querySelector('input[type=range]')
  slider.value = '40'; slider.oninput()
  assert.equal(content.style.opacity, '0.4', '拖动时立即预览透明度')
  assert.equal(card.classList.contains('has-media-opacity'), true)
  assert.equal(card.style.backgroundColor, 'transparent', '卡片底色必须清空，不能挡住后方卡片')
  assert.equal(content.parentElement.style.backgroundColor, 'transparent', '媒体框底色必须清空')
  assert.equal(card.querySelector('img').style.backgroundColor, 'transparent', '图片自身底色必须清空')
  slider.onchange()
  await waitUntil(() => state.boards[0].nodes.find(node => node.id === 'pic').opacity === 0.4)
  assert.equal(content.style.opacity, '0.4')
  panel.querySelector('.studio-media-opacity-reset').onclick()
  await waitUntil(() => state.boards[0].nodes.find(node => node.id === 'pic').opacity === undefined)
  assert.equal(content.style.opacity, '', '恢复 100% 时清除透明度和持久化字段')
  assert.equal(card.classList.contains('has-media-opacity'), false)
  assert.equal(card.style.backgroundColor, '', '恢复 100% 时还原卡片底色')
  assert.equal(content.parentElement.style.backgroundColor, '', '恢复 100% 时还原媒体框底色')
  select('clip')
  assert.match(context.textContent, /透明度/, '视频提供透明度入口')
  await [...context.querySelectorAll('button')].find(button => button.textContent === '透明度').onclick()
  const videoCard = window.document.querySelector('[data-node="clip"]'), videoContent = videoCard.querySelector('.studio-media-content')
  const videoSlider = panel.querySelector('input[type=range]')
  videoSlider.value = '25'; videoSlider.oninput()
  assert.equal(videoContent.style.opacity, '0.25')
  assert.equal(videoCard.classList.contains('has-media-opacity'), true, '视频透明度不依赖素材本身是否支持透明通道')
  assert.equal(videoCard.style.backgroundColor, 'transparent')
  assert.equal(videoContent.parentElement.style.backgroundColor, 'transparent')
  assert.equal(videoCard.querySelector('video').style.backgroundColor, 'transparent', '播放器默认黑底也必须清空')
  videoSlider.onchange()
  await waitUntil(() => state.boards[0].nodes.find(node => node.id === 'clip').opacity === 0.25)
  assert.equal(panel.hidden, false, '保存后保持面板可用于继续调整')
  panel.querySelector('.studio-media-opacity-close').onclick()
  assert.equal(panel.hidden, true)
})

test('重置显示一次恢复缩放、显示框和透明度并可撤销', async t => {
  const { window, state, tools, ctx } = await setup(t)
  state.assets.pic = ctx.canvasSession.rememberAsset({ id: 'pic', kind: 'image', name: '重置.png', width: 300, height: 200 })
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'pic', type: 'image', assetId: 'pic', x: 100, y: 50, frameWidth: 420, frameHeight: 300, mediaWidth: 380, opacity: 0.4 } },
  ] })
  await waitUntil(() => window.document.querySelector('[data-node="pic"] .studio-media-frame'))
  const select = () => {
    const head = window.document.querySelector('[data-node="pic"] .studio-card-head')
    head.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 85, clientX: 110, clientY: 60 }))
    window.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 85, clientX: 110, clientY: 60 }))
  }
  select()
  const context = window.document.querySelector('.studio-context-tools')
  const reset = () => [...context.querySelectorAll('button')].find(button => button.textContent === '重置显示')
  assert.equal(reset().disabled, false, '有自定义显示设置时可重置')
  await reset().onclick()
  await waitUntil(() => state.boards[0].nodes[0].frameWidth === undefined && state.boards[0].nodes[0].opacity === undefined)
  const node = state.boards[0].nodes[0]
  assert.equal(node.frameWidth, undefined); assert.equal(node.frameHeight, undefined); assert.equal(node.mediaWidth, undefined)
  let card = window.document.querySelector('[data-node="pic"]')
  assert.equal(card.style.width, '', '重置后卡片恢复默认宽度')
  assert.equal(card.querySelector('.studio-media-frame').style.height, '', '重置后显示框恢复默认高度')
  assert.equal(card.querySelector('.studio-media-content').style.width, '', '重置后素材恢复默认宽度')
  assert.equal(card.querySelector('.studio-media-content').style.opacity, '', '重置后媒体恢复不透明')
  assert.equal(card.style.backgroundColor, '', '重置后卡片底色恢复主题默认')
  assert.equal(card.classList.contains('has-media-opacity'), false)
  await waitUntil(() => reset()?.disabled === true)
  assert.equal(reset().disabled, true, '恢复默认后重置按钮不可用')
  await [...window.document.querySelectorAll('button')].find(button => button.textContent === '↶').onclick()
  await waitUntil(() => state.boards[0].nodes[0].frameWidth === 420 && state.boards[0].nodes[0].opacity === 0.4)
  card = window.document.querySelector('[data-node="pic"]')
  assert.equal(card.style.width, '424px')
  assert.equal(card.querySelector('.studio-media-frame').style.height, '300px')
  assert.equal(card.querySelector('.studio-media-content').style.width, '380px')
  assert.equal(card.querySelector('.studio-media-content').style.opacity, '0.4')
})

test('重复重绘复用卡片、素材和连线，连续拖动合并到一帧且保存最终位置', async t => {
  const { window, ctx, tools, state } = await setup(t), document = window.document
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'text', type: 'text', x: 0, y: 0, text: '拖动测试' } },
    { type: 'add', node: { id: 'g', type: 'generator', x: 400, y: 0 } },
    { type: 'connect', id: 'edge', from: 'text', to: 'g' },
  ] })
  ctx.canvasSession.rememberAsset({ id: 'asset', name: '素材', kind: 'image', width: 10, height: 10 })
  const text = document.querySelector('[data-node="text"]'), generator = document.querySelector('[data-node="g"]')
  const asset = document.querySelector('.studio-asset-card'), wire = document.querySelector('.studio-wires path')
  for (let i = 0; i < 5; i++) ctx.canvasUI.render()
  assert.equal(document.querySelector('[data-node="text"]'), text)
  assert.equal(document.querySelector('[data-node="g"]'), generator)
  assert.equal(document.querySelector('.studio-asset-card'), asset)
  assert.equal(document.querySelector('.studio-wires path'), wire)
  const pointer = (type, target, x, y) => target.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 91, clientX: x, clientY: y }))
  pointer('pointerdown', text.querySelector('.studio-card-head'), 40, 40)
  for (let i = 1; i <= 60; i++) pointer('pointermove', window, 40 + i, 40 + i)
  assert.equal(ctx.canvasSession.board().nodes[0].x, 0, '同一帧中的事件不逐个更新布局')
  await new Promise(resolve => window.requestAnimationFrame(resolve))
  assert.equal(ctx.canvasSession.board().nodes[0].x, 60)
  assert.equal(document.querySelector('.studio-wires path'), wire)
  pointer('pointerup', window, 110, 120)
  await waitUntil(() => state.boards[0].nodes[0].x === 70)
  assert.equal(state.boards[0].nodes[0].y, 80, '松手坐标在保存前应用，不丢失最后一帧')
  assert.equal(document.querySelector('[data-node="text"]'), text)
  assert.equal(document.querySelectorAll('.studio-wires path').length, 1)
  assert.equal(document.querySelectorAll('.studio-wires title').length, 1)
})

test('画布裁剪视口外卡片，选中卡片保留且平移后重新挂载', async t => {
  const { window, ctx, tools, state } = await setup(t)
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'near', type: 'text', x: 0, y: 0 } },
    { type: 'add', node: { id: 'far', type: 'text', x: 10000, y: 0 } },
  ] })
  const stage = window.document.querySelector('.studio-stage')
  Object.defineProperties(stage, { clientWidth: { value: 1200 }, clientHeight: { value: 800 } })
  ctx.canvasSession.viewport = { x: 0, y: 0, zoom: 1 }; ctx.canvasUI.render()
  assert.ok(window.document.querySelector('[data-node="near"]'))
  assert.equal(window.document.querySelector('[data-node="far"]'), null)
  ctx.canvasUI.select(['far'])
  assert.ok(window.document.querySelector('[data-node="far"]'))
  ctx.canvasUI.select([])
  assert.equal(window.document.querySelector('[data-node="far"]'), null)
  ctx.canvasSession.viewport = { x: -10000, y: 0, zoom: 1 }; ctx.canvasUI.render()
  assert.ok(window.document.querySelector('[data-node="far"]'))
  assert.equal(window.document.querySelector('[data-node="near"]'), null)
})

test('视口裁剪读取未挂载和已更新媒体卡片的自定义尺寸', async t => {
  const { window, ctx, tools, state } = await setup(t)
  Object.defineProperties(ctx.canvasUI.stage, { clientWidth: { value: 1200 }, clientHeight: { value: 800 } })
  ctx.canvasSession.viewport = { x: 0, y: 0, zoom: 1 }
  for (const kind of ['image', 'video']) state.assets[kind] = ctx.canvasSession.rememberAsset({ id: kind, kind, width: 300, height: 600 })
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'wide', type: 'image', assetId: 'image', x: -1500, y: 0, frameWidth: 2000, frameHeight: 200, mediaWidth: 2000 } },
    { type: 'add', node: { id: 'tall', type: 'video', assetId: 'video', x: 0, y: -1500, frameWidth: 200, frameHeight: 2000, mediaWidth: 200 } },
  ] })
  assert.ok(window.document.querySelector('[data-node="wide"]'), '从左侧延伸入视口的大图片必须挂载')
  assert.ok(window.document.querySelector('[data-node="tall"]'), '从上方延伸入视口的大视频必须挂载')
  const wide = window.document.querySelector('[data-node="wide"]')
  Object.defineProperties(wide, { offsetWidth: { value: 2004 }, offsetHeight: { value: 320 } })
  ctx.canvasUI.render()
  await tools.get('studio_edit')({ revision: state.boards[0].revision, operations: [{ type: 'update', id: 'wide', patch: { frameWidth: 200 } }] })
  assert.equal(window.document.querySelector('[data-node="wide"]'), null, '缩小后不能沿用旧 DOM 尺寸缓存')
  await tools.get('studio_edit')({ revision: state.boards[0].revision, operations: [{ type: 'update', id: 'wide', patch: { frameWidth: 2000 } }] })
  assert.ok(window.document.querySelector('[data-node="wide"]'), '再次放大后恢复挂载')
})

test('低倍率总览简化卡片并保留切换与放大后的完整交互', async t => {
  const { window, ctx, tools, state } = await setup(t)
  ctx.canvasSession.rememberAsset({ id: 'light-image', kind: 'image', name: '总览图.png', width: 640, height: 480 })
  ctx.canvasSession.rememberAsset({ id: 'light-video', kind: 'video', name: '总览视频.mp4', extension: 'mp4', width: 640, height: 480, duration: 8 })
  Object.assign(state.assets, ctx.canvasSession.state.assets)
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'light-image-node', type: 'image', x: 0, y: 0, assetId: 'light-image' } },
    { type: 'add', node: { id: 'light-video-node', type: 'video', x: 400, y: 0, assetId: 'light-video' } },
    { type: 'add', node: { id: 'light-generator-node', type: 'generator', x: 800, y: 0, prompt: '总览时不用创建参数表单' } },
  ] })
  const toggle = window.document.querySelector('.studio-light-overview-toggle')
  assert.ok(toggle)
  assert.equal(window.document.querySelector('[data-node="light-image-node"] img').getAttribute('src'), '/api/studio/images/light-image.webp')
  ctx.canvasSession.viewport = { x: 0, y: 0, zoom: 0.18 }; ctx.canvasUI.render()
  assert.equal(toggle.getAttribute('aria-pressed'), 'true')
  assert.equal(window.document.querySelector('[data-node="light-image-node"] img').getAttribute('src'), '/api/studio/images/light-image.small.webp')
  assert.equal(window.document.querySelector('[data-node="light-video-node"] video'), null, '总览时不应创建播放器')
  assert.equal(window.document.querySelector('[data-node="light-generator-node"] .studio-generator-body'), null, '总览时不应创建生成表单')
  const generatorHead = window.document.querySelector('[data-node="light-generator-node"] .studio-card-head')
  generatorHead.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 51, clientX: 50, clientY: 50 }))
  window.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 51, clientX: 50, clientY: 50 }))
  await new Promise(resolve => window.requestAnimationFrame(resolve))
  assert.ok(window.document.querySelector('[data-node="light-generator-node"] .studio-generator-body'), '点击总览卡片后恢复完整交互')
  ctx.canvasUI.select([])
  ctx.canvasUI.select(['light-video-node'])
  const selectedPlayer = window.document.querySelector('[data-node="light-video-node"] video')
  assert.ok(selectedPlayer, '选中卡片可进入完整交互态')
  assert.equal(selectedPlayer.hasAttribute('src'), false, '低倍率下仍需点击后才加载视频')
  ctx.canvasUI.select([])
  assert.equal(window.document.querySelector('[data-node="light-video-node"] video'), null)
  toggle.click()
  assert.equal(toggle.getAttribute('aria-pressed'), 'false')
  assert.equal(window.document.querySelector('[data-node="light-image-node"] img').getAttribute('src'), '/api/studio/images/light-image.webp')
  assert.equal(window.localStorage.getItem('studio-light-overview'), '0')
  assert.ok(window.document.querySelector('[data-node="light-video-node"] video'))
  assert.ok(window.document.querySelector('[data-node="light-generator-node"] .studio-generator-body'))
  toggle.click()
  assert.equal(window.localStorage.getItem('studio-light-overview'), '1')
  assert.equal(window.document.querySelector('[data-node="light-video-node"] video'), null)
  ctx.canvasSession.viewport = { x: 0, y: 0, zoom: 0.5 }; ctx.canvasUI.render()
  assert.ok(window.document.querySelector('[data-node="light-video-node"] video'), '放大后恢复完整播放器')
  assert.ok(window.document.querySelector('[data-node="light-generator-node"] .studio-generator-body'))
  assert.equal(window.document.querySelector('[data-node="light-image-node"] img').getAttribute('src'), '/api/studio/images/light-image.webp')
})

test('拖动取消与无移动点击不写布局，文字组词中的 Esc 不退出编辑', async t => {
  const { window, tools, state } = await setup(t)
  await tools.get('studio_edit')({ revision: 0, operations: [{ type: 'add', node: { id: 'text', type: 'text', x: 0, y: 0 } }] })
  const stage = window.document.querySelector('.studio-stage'), original = structuredClone(state.boards[0])
  const pointer = (type, target, x, y) => target.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: x, clientY: y }))
  pointer('pointerdown', window.document.querySelector('.studio-card-head'), 40, 40)
  pointer('pointermove', stage, 120, 160)
  await new Promise(resolve => window.requestAnimationFrame(resolve))
  assert.notEqual(tools.get('studio_read')().board.nodes[0].x, 0)
  pointer('pointercancel', stage, 120, 160)
  assert.deepEqual(tools.get('studio_read')().board, original)
  assert.deepEqual(state.boards[0], original)
  assert.equal(window.document.querySelector('.studio-card').style.left, '0px')
  assert.equal(window.document.querySelector('.studio-card').style.top, '0px')
  pointer('pointerdown', window.document.querySelector('.studio-card-head'), 40, 40)
  pointer('pointerup', stage, 40, 40)
  assert.deepEqual(state.boards[0], original, '单击标题只选择卡片，不写坐标和撤销步骤')
  assert.equal(window.document.querySelector('.studio-context-tools').hidden, false, '无移动的单击选中后应立即显示卡片工具')
  const input = window.document.querySelector('textarea'); input.focus()
  const composingEscape = new window.KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true })
  input.dispatchEvent(composingEscape)
  assert.equal(window.document.activeElement, input)
  assert.equal(composingEscape.defaultPrevented, false)
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  await waitUntil(() => window.document.querySelector('.studio-context-tools').hidden === false)
  assert.equal(window.document.activeElement, stage)
})

test('空白左键框选、卡片中键拖动与空白中键平移正确分流', async t => {
  const { window, tools, state, ctx } = await setup(t)
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'left', type: 'text', text: '左', x: 0, y: 0 } },
    { type: 'add', node: { id: 'right', type: 'text', text: '右', x: 400, y: 0 } },
  ] })
  ctx.canvasSession.viewport = { x: 0, y: 0, zoom: 1 }
  ctx.canvasSession.rememberAsset({ id: 'pan-video', kind: 'video', name: '平移视频.mp4', extension: 'mp4', width: 480, height: 640, duration: 5.2, createdAt: 1 })
  await window.document.querySelector('.studio-sidebar-tab[data-side-page="assets"]').onclick()
  await waitUntil(() => window.document.querySelector('.studio-assets .studio-asset-card video'))
  const stage = window.document.querySelector('.studio-stage'), context = window.document.querySelector('.studio-context-tools')
  const pointer = (type, target, x, y, button = 0) => target.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, button, pointerId: 21, clientX: x, clientY: y }))
  pointer('pointerdown', stage, 0, 0)
  pointer('pointermove', stage, 760, 500)
  pointer('pointerup', stage, 760, 500)
  await waitUntil(() => /已选 2 张卡片/.test(context.textContent))
  assert.deepEqual(ctx.canvasSession.viewport, { x: 0, y: 0, zoom: 1 }, '空白左键框选不移动画布')

  const first = () => state.boards[0].nodes.find(node => node.id === 'left'), second = () => state.boards[0].nodes.find(node => node.id === 'right')
  pointer('pointerdown', window.document.querySelector('[data-node="left"] textarea'), 20, 20, 1)
  pointer('pointermove', stage, 60, 50, 1)
  pointer('pointerup', stage, 60, 50, 1)
  await waitUntil(() => first().x === 40 && second().x === 440)
  assert.equal(first().y, 30); assert.equal(second().y, 30)
  assert.match(context.textContent, /已选 2 张卡片/, '中键从输入框拖动时保留整组选择')

  const videoBeforePan = window.document.querySelector('.studio-assets .studio-asset-card video')
  pointer('pointerdown', stage, 100, 100, 1)
  pointer('pointermove', stage, 150, 130, 1)
  pointer('pointerup', stage, 150, 130, 1)
  assert.deepEqual(ctx.canvasSession.viewport, { x: 50, y: 30, zoom: 1 }, '空白中键拖动只平移画布')
  assert.ok(window.document.querySelector('.studio-assets .studio-asset-card video') === videoBeforePan, '平移后不重建素材库视频')

  stage.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true }))
  pointer('pointerdown', stage, 100, 100)
  pointer('pointermove', stage, 120, 90)
  pointer('pointerup', stage, 120, 90)
  stage.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true }))
  assert.deepEqual(ctx.canvasSession.viewport, { x: 70, y: 20, zoom: 1 }, 'Space + 左键继续平移画布')
})

test('滚轮和 Ctrl+滚轮围绕指针缩放，整理画布可单步撤销', async t => {
  const { window, state, ctx, tools } = await setup(t)
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'text', type: 'text', x: 20, y: 300, text: '输入' } },
    { type: 'add', node: { id: 'g', type: 'generator', x: 500, y: 100, prompt: '生成' } },
    { type: 'connect', id: 'edge', from: 'text', to: 'g' },
  ] })
  await waitUntil(() => window.document.querySelector('[data-node="g"]'))
  ctx.canvasSession.viewport = { x: 0, y: 0, zoom: 1 }
  const stage = window.document.querySelector('.studio-stage'), wheel = (ctrlKey, deltaY) => {
    const event = new window.Event('wheel', { bubbles: true, cancelable: true })
    Object.defineProperties(event, { ctrlKey: { value: ctrlKey }, metaKey: { value: false }, deltaY: { value: deltaY }, deltaX: { value: 0 }, clientX: { value: 200 }, clientY: { value: 160 } })
    stage.dispatchEvent(event); return event
  }
  assert.equal(wheel(false, 90).defaultPrevented, true)
  assert.ok(ctx.canvasSession.viewport.zoom < 1)
  const zoomedOut = ctx.canvasSession.viewport.zoom
  wheel(true, -80)
  assert.ok(ctx.canvasSession.viewport.zoom > zoomedOut)
  const before = state.boards[0].nodes.map(node => [node.id, node.x, node.y])
  await [...window.document.querySelectorAll('.studio-action-dock button')].find(button => button.textContent === '整理画布').onclick()
  const arranged = state.boards[0].nodes
  assert.ok(arranged.find(node => node.id === 'text').x < arranged.find(node => node.id === 'g').x)
  await [...window.document.querySelectorAll('.studio-action-dock button')].find(button => button.textContent === '↶').onclick()
  assert.deepEqual(state.boards[0].nodes.map(node => [node.id, node.x, node.y]), before)
})

test('整理画布下拉选择五种方案，记住选择并支持一次撤销，关闭菜单不修改画板', async t => {
  const { window, state, tools, editBatches, ctx } = await setup(t)
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'text', type: 'text', x: 20, y: 300, text: '输入' } },
    { type: 'add', node: { id: 'g', type: 'generator', x: 900, y: 100, prompt: '生成' } },
    { type: 'add', node: { id: 'g2', type: 'generator', x: 1700, y: 900, prompt: '另一个生成卡' } },
    { type: 'connect', id: 'edge', from: 'text', to: 'g' },
  ] })
  await waitUntil(() => window.document.querySelector('[data-node="g2"]'))
  const document = window.document, toggle = document.querySelector('.studio-layout-toggle'), menu = document.querySelector('.studio-layout-menu')
  const snapshot = () => structuredClone(state.boards[0].nodes), original = snapshot(), edges = structuredClone(state.boards[0].edges)
  const stage = document.querySelector('.studio-stage'), control = document.querySelector('.studio-layout-control')
  stage.getBoundingClientRect = () => ({ left: 100, top: 100 })
  control.getBoundingClientRect = () => ({ left: 500, top: 700 })
  Object.defineProperties(stage, { clientWidth: { value: 1000 }, clientHeight: { value: 700 } })
  Object.defineProperties(menu, { offsetWidth: { value: 310 }, offsetHeight: { value: 350 } })
  stage.scrollTop = 125; stage.scrollLeft = 80
  await toggle.onclick()
  assert.equal(menu.hidden, false)
  assert.equal(toggle.getAttribute('aria-expanded'), 'true')
  assert.equal(menu.style.left, '480px')
  assert.equal(menu.style.top, '365px', '浏览器滚动容器后仍应贴近按钮显示')
  const choices = [...menu.querySelectorAll('[role=menuitemradio]')]
  assert.equal(choices.length, 5)
  assert.ok(choices.every(choice => choice.querySelector('small').textContent))
  choices[0].focus()
  choices[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
  assert.equal(document.activeElement, choices[1])
  choices[1].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  assert.equal(menu.hidden, true)
  assert.equal(document.activeElement, toggle)
  assert.deepEqual(snapshot(), original)
  const clickUndo = () => [...document.querySelectorAll('.studio-action-dock button')].find(button => button.textContent === '↶').onclick()
  for (const choice of choices) {
    await toggle.onclick()
    await choice.onclick()
    assert.equal(menu.hidden, true)
    assert.equal(choice.getAttribute('aria-checked'), 'true')
    assert.equal(window.localStorage.getItem('studio-canvas-layout'), choice.dataset.layout)
    assert.deepEqual(editBatches.at(-1).map(operation => operation.type), ['layout'])
    assert.deepEqual(state.boards[0].edges, edges)
    await clickUndo()
    assert.deepEqual(snapshot(), original, '一次撤销应恢复每张卡片的位置和内容')
  }
  const primary = document.querySelector('.studio-layout-control button')
  assert.match(primary.title, /紧凑瀑布流/)
  await primary.onclick()
  assert.equal(window.localStorage.getItem('studio-canvas-layout'), 'masonry')
  await clickUndo()
  await toggle.onclick()
  document.querySelector('.studio-stage').dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 2 }))
  assert.equal(menu.hidden, true)
  assert.deepEqual(snapshot(), original)
  // UI-only preference storage must not enter the saved canvas document.
  assert.equal(ctx.canvasSession.board().layout, undefined)
})

test('生成卡片正文和图片区域可直接拖动，文字输入区保持编辑', async t => {
  const { window, tools, state } = await setup(t)
  const asset = await tools.get('studio_import_image')({ path: 'C:/test/drag.png' })
  const videoAsset = { id: 'drag-video', kind: 'video', name: '拖动视频.mp4', extension: 'mp4', width: 480, height: 640, duration: 5.2, createdAt: 1 }
  state.assets[videoAsset.id] = videoAsset
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'generator', type: 'generator', x: 0, y: 0, prompt: '拖动测试', provider: 'wavespeed' } },
    { type: 'add', node: { id: 'image', type: 'image', x: 400, y: 0, assetId: asset.id } },
    { type: 'add', node: { id: 'video', type: 'video', x: 800, y: 0, assetId: videoAsset.id } },
  ] })
  const stage = window.document.querySelector('.studio-stage')
  const pointer = (type, target, x, y) => target.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 7, clientX: x, clientY: y }))
  pointer('pointerdown', window.document.querySelector('.studio-generator-body'), 50, 50)
  pointer('pointermove', stage, 90, 95); pointer('pointerup', stage, 90, 95)
  await waitUntil(() => state.boards[0].nodes.find(node => node.id === 'generator').x === 40)
  assert.equal(state.boards[0].nodes.find(node => node.id === 'generator').y, 45)
  pointer('pointerdown', window.document.querySelector('.studio-generator-body textarea'), 50, 50)
  pointer('pointermove', stage, 130, 130); pointer('pointerup', stage, 130, 130)
  assert.equal(state.boards[0].nodes.find(node => node.id === 'generator').x, 40)
  pointer('pointerdown', window.document.querySelector('.studio-image .studio-media-frame img'), 450, 50)
  pointer('pointermove', stage, 480, 80); pointer('pointerup', stage, 480, 80)
  await waitUntil(() => state.boards[0].nodes.find(node => node.id === 'image').x === 430)
  assert.equal(state.boards[0].nodes.find(node => node.id === 'image').y, 30)
  const videoCard = window.document.querySelector('[data-node="video"]'), videoPlayer = videoCard.querySelector('video')
  pointer('pointerdown', videoCard, 850, 50)
  pointer('pointermove', stage, 890, 90); pointer('pointerup', stage, 890, 90)
  await waitUntil(() => state.boards[0].nodes.find(node => node.id === 'video').x === 840)
  assert.equal(state.boards[0].nodes.find(node => node.id === 'video').y, 40)
  assert.ok(window.document.querySelector('[data-node="video"] video') === videoPlayer, '移动视频卡片后不重建播放器')
})

test('左侧素材单击预览，拖到画布按落点创建卡片', async t => {
  const { window, tools, state } = await setup(t)
  const asset = await tools.get('studio_import_image')({ path: 'C:/test/sidebar.png' })
  assert.equal(window.document.querySelectorAll('.studio-assets .studio-asset-card').length, 0, '未打开侧栏时不创建素材卡')
  await window.document.querySelector('.studio-sidebar-tab[data-side-page="assets"]').onclick()
  const button = window.document.querySelector('.studio-assets button')
  assert.ok(button)
  await button.onclick()
  const viewer = window.document.querySelector('.studio-viewer')
  assert.equal(viewer.open, true)
  assert.equal(viewer.querySelector('.studio-viewer-stage img').getAttribute('src'), `/api/studio/images/${asset.id}.png`)
  viewer.close()
  assert.equal(state.boards[0].nodes.length, 0)
  const drop = new window.Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperties(drop, {
    clientX: { value: 360 }, clientY: { value: 260 },
    dataTransfer: { value: { files: [], getData: type => type === 'application/x-cordis-studio-asset' ? asset.id : '' } },
  })
  window.document.querySelector('.studio-stage').dispatchEvent(drop)
  await waitUntil(() => state.boards[0].nodes.length === 1)
  const node = state.boards[0].nodes[0]
  assert.equal(node.type, 'image'); assert.equal(node.assetId, asset.id)
  assert.equal(node.x, 300); assert.equal(node.y, 200)
})

test('素材库支持模糊搜索、类型筛选、排序和完整视图', async t => {
  const { window, ctx } = await setup(t)
  const assets = [
    { id: 'asset-camera', kind: 'image', name: 'Camera_Alpha.png', width: 1024, height: 768, createdAt: 100 },
    { id: 'asset-character', kind: 'image', name: '角色立绘.png', width: 720, height: 1280, createdAt: 200 },
    { id: 'asset-video', kind: 'video', name: '动作片段.mp4', extension: 'mp4', width: 720, height: 1280, duration: 5.2, createdAt: 300 },
    { id: 'asset-scene', kind: 'image', name: '场景草图.webp', width: 1600, height: 900, createdAt: 400 },
  ]
  for (const asset of assets) ctx.canvasSession.rememberAsset(asset)
  assert.equal(window.document.querySelector('.studio-asset-count').textContent, '4')
  assert.equal(window.document.querySelectorAll('.studio-assets .studio-asset-card').length, 0, '隐藏素材库不提前渲染')
  await window.document.querySelector('.studio-sidebar-tab[data-side-page="assets"]').onclick()
  assert.equal(window.document.querySelectorAll('.studio-assets .studio-asset-card').length, 4)
  assert.equal(window.document.querySelector('.studio-assets .studio-asset-card img').dataset.src, '/api/studio/images/asset-scene.small.webp')

  const search = window.document.querySelector('[aria-label="搜索素材"]')
  search.value = 'CAMERA'; search.oninput()
  let cards = [...window.document.querySelectorAll('.studio-assets .studio-asset-card')]
  assert.equal(cards.length, 1)
  assert.match(cards[0].textContent, /Camera_Alpha\.png/)

  search.value = ''; search.oninput(); await window.document.querySelector('.studio-assets-tools [data-kind="video"]').onclick()
  cards = [...window.document.querySelectorAll('.studio-assets .studio-asset-card')]
  assert.equal(cards.length, 1); assert.ok(cards[0].querySelector('video'))

  await window.document.querySelector('.studio-assets-tools [data-kind="all"]').onclick()
  await window.document.querySelector('.studio-assets-all').onclick()
  const manager = window.document.querySelector('.studio-asset-manager')
  assert.equal(manager.open, true)
  assert.equal(manager.querySelectorAll('.studio-asset-card').length, 0)
  assert.match(manager.querySelector('.studio-asset-manager-empty').textContent, /还没有收藏素材/)

  await manager.querySelector('.studio-asset-filter[data-kind="all"]').onclick()
  assert.equal(manager.querySelectorAll('.studio-asset-card').length, 4)
  const star = manager.querySelector('.studio-asset-favorite')
  assert.equal(star.getAttribute('aria-pressed'), 'false')
  await star.onclick()
  assert.equal(manager.querySelector('.studio-asset-favorite').getAttribute('aria-pressed'), 'true')
  await manager.querySelector('.studio-asset-filter[data-kind="favorites"]').onclick()
  assert.equal(manager.querySelectorAll('.studio-asset-card').length, 1)

  await manager.querySelector('.studio-asset-filter[data-kind="all"]').onclick()
  const sort = manager.querySelector('[aria-label="素材排序"]')
  sort.value = 'name'; sort.onchange()
  const names = [...manager.querySelectorAll('.studio-asset-card .studio-asset-caption strong')].map(node => node.textContent)
  const expected = [...assets].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true, sensitivity: 'base' })).map(asset => asset.name)
  assert.deepEqual(names, expected)

  await window.document.querySelector('.studio-sidebar-tab[data-side-page="assets"]').onclick()
  assert.equal(window.document.querySelector('#studio-side-canvas').hidden, true)
  assert.equal(window.document.querySelector('#studio-side-assets').hidden, false)
  const sidebarMedia = window.document.querySelectorAll('.studio-assets .studio-asset-card img, .studio-assets .studio-asset-card video')
  assert.equal(sidebarMedia.length, 4)
  const favoriteOnly = window.document.querySelector('.studio-asset-favorite-only')
  await favoriteOnly.onclick()
  assert.equal(favoriteOnly.getAttribute('aria-pressed'), 'true')
  assert.equal(window.document.querySelectorAll('.studio-assets .studio-asset-card').length, 1)
  await window.document.querySelector('.studio-sidebar-tab[data-side-page="canvas"]').onclick()
  assert.equal(window.document.querySelector('#studio-side-canvas').hidden, false)
  assert.equal(window.document.querySelectorAll('.studio-assets .studio-asset-card').length, 0, '离开素材库后释放预览')
})

test('收藏页临时置顶只调整当前排序，再次置顶时前一张顺位', async t => {
  const { window, ctx } = await setup(t)
  const document = window.document
  const assets = [
    { id: 'asset-a', kind: 'image', name: 'A.png', width: 300, height: 200, createdAt: 100 },
    { id: 'asset-b', kind: 'image', name: 'B.png', width: 320, height: 240, createdAt: 200 },
    { id: 'asset-c', kind: 'image', name: 'C.png', width: 360, height: 280, createdAt: 300 },
  ]
  for (const asset of assets) ctx.canvasSession.rememberAsset(asset)

  await document.querySelector('.studio-sidebar-tab[data-side-page="assets"]').onclick()
  for (const id of ['asset-a', 'asset-b', 'asset-c']) await document.querySelector(`[data-favorite-asset="${id}"]`).onclick()
  await document.querySelector('.studio-asset-favorite-only').onclick()
  const sideOrder = () => [...document.querySelectorAll('.studio-assets .studio-asset-card')].map(card => card.dataset.asset)
  const managerOrder = () => [...document.querySelectorAll('.studio-asset-manager-grid .studio-asset-card')].map(card => card.dataset.asset)
  assert.deepEqual(sideOrder(), ['asset-c', 'asset-b', 'asset-a'])
  assert.equal(managerOrder().length, 0, '关闭的素材库不构建隐藏网格')
  await document.querySelector('.studio-asset-expand').onclick()

  await document.querySelector('[data-promote-asset="asset-b"]').onclick()
  assert.deepEqual(sideOrder(), ['asset-b', 'asset-c', 'asset-a'])
  assert.deepEqual(managerOrder(), ['asset-b', 'asset-c', 'asset-a'])

  await document.querySelector('[data-promote-asset="asset-a"]').onclick()
  assert.deepEqual(sideOrder(), ['asset-a', 'asset-b', 'asset-c'])
  assert.equal(document.querySelector('[data-promote-asset="asset-a"]').getAttribute('aria-pressed'), 'true')
  assert.equal(document.querySelector('[data-promote-asset="asset-b"]').getAttribute('aria-pressed'), 'false')
})

test('切回标签页和打开素材库时重新读取其他页面修改的收藏', async t => {
  const channels = []
  class FavoriteChannel {
    constructor() { this.listeners = new Set(); channels.push(this) }
    addEventListener(type, listener) { if (type === 'message') this.listeners.add(listener) }
    removeEventListener(type, listener) { if (type === 'message') this.listeners.delete(listener) }
    postMessage() {}
    emit() { for (const listener of this.listeners) listener({ data: 'changed' }) }
    close() {}
  }
  const { window, ctx, assetFavorites } = await setup(t, { broadcastChannel: FavoriteChannel })
  const document = window.document, id = 'cross-tab-image'
  ctx.canvasSession.rememberAsset({ id, kind: 'image', name: '跨页图片.png', width: 640, height: 480 })
  await document.querySelector('.studio-sidebar-tab[data-side-page="assets"]').onclick()
  const star = () => document.querySelector('.studio-assets [data-favorite-asset="cross-tab-image"]')
  await waitUntil(() => star()?.getAttribute('aria-pressed') === 'false')
  assetFavorites.add(id)
  channels[0].emit()
  await waitUntil(() => star()?.getAttribute('aria-pressed') === 'true')
  assetFavorites.delete(id)
  let hidden = true
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  document.dispatchEvent(new window.Event('visibilitychange'))
  hidden = false
  document.dispatchEvent(new window.Event('visibilitychange'))
  await waitUntil(() => star()?.getAttribute('aria-pressed') === 'false')
  assetFavorites.add(id)
  window.dispatchEvent(new window.Event('focus'))
  await waitUntil(() => star()?.getAttribute('aria-pressed') === 'true')
  await document.querySelector('.studio-sidebar-tab[data-side-page="canvas"]').onclick()
  assetFavorites.delete(id)
  await document.querySelector('.studio-sidebar-tab[data-side-page="assets"]').onclick()
  await waitUntil(() => star()?.getAttribute('aria-pressed') === 'false')
})

test('大量素材仅在打开侧栏时分批挂载，后台标签释放预览并在返回时恢复', async t => {
  const { window, ctx, tools, state } = await setup(t)
  const document = window.document
  for (let i = 0; i < 100; i++) ctx.canvasSession.rememberAsset({ id: 'asset-' + i, kind: 'image', name: '图片' + i, width: 640, height: 480, createdAt: i })
  state.assets['background-video'] = ctx.canvasSession.rememberAsset({ id: 'background-video', kind: 'video', name: '测试.mp4', width: 640, height: 480, duration: 2, createdAt: 100 })
  await tools.get('studio_edit')({ revision: 0, operations: [{ type: 'add', node: { id: 'video-card', type: 'video', assetId: 'background-video', x: 0, y: 0 } }] })
  const player = document.querySelector('[data-node="video-card"] video')
  player.setAttribute('src', '/api/studio/videos/background-video')
  const list = document.querySelector('.studio-assets')
  assert.equal(list.querySelectorAll('.studio-asset-card').length, 0)
  await document.querySelector('.studio-sidebar-tab[data-side-page="assets"]').onclick()
  assert.equal(list.querySelectorAll('.studio-asset-card').length, 48)
  list.dispatchEvent(new window.Event('scroll'))
  assert.equal(list.querySelectorAll('.studio-asset-card').length, 96)
  let hidden = true
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  document.dispatchEvent(new window.Event('visibilitychange'))
  assert.equal(list.querySelectorAll('.studio-asset-card').length, 0)
  assert.equal(player.hasAttribute('src'), false, '后台标签释放画布视频资源')
  assert.equal(player.dataset.src, '/api/studio/videos/background-video')
  hidden = false
  document.dispatchEvent(new window.Event('visibilitychange'))
  await waitUntil(() => list.querySelectorAll('.studio-asset-card').length === 48)
  assert.equal(list.querySelector('img').dataset.src.endsWith('.small.webp'), true)
})

test('用户与 Agent 共用画布操作、自动保存、撤销和版本冲突规则，连线不自动生图', async t => {
    const { window, state, tools, hooks, generated } = await setup(t)
    let current = tools.get('studio_read')()
    await tools.get('studio_edit')({ revision: current.board.revision, operations: [
      { type: 'add', node: { id: 'text', type: 'text', text: '参考要求', x: 0, y: 0 } },
      { type: 'add', node: { id: 'generator', type: 'generator', x: 340, y: 0 } },
      { type: 'connect', id: 'edge', from: 'text', to: 'generator' },
    ] })
    assert.equal(window.document.querySelectorAll('.studio-card').length, 2)
    assert.equal(window.document.querySelectorAll('.studio-wires path').length, 1)
    assert.equal(generated.length, 0)
    await assert.rejects(tools.get('studio_edit')({ revision: 0, operations: [{ type: 'remove', ids: ['text'] }] }), /重新/)
    const input = window.document.querySelector('textarea')
    input.onfocus(); input.value = '用户编辑后的内容'; input.oninput()
    current = tools.get('studio_read')()
    assert.equal(current.dirty, true)
    await assert.rejects(tools.get('studio_generate')({ revision: current.board.revision, nodeId: 'generator' }), /重新/)
    await input.onblur()
    assert.equal(state.boards[0].nodes.find(n => n.id === 'text').text, '用户编辑后的内容')
    const undo = [...window.document.querySelectorAll('button')].find(b => b.textContent === '↶')
    await undo.onclick()
    assert.equal(state.boards[0].nodes.find(n => n.id === 'text').text, '参考要求')
    current = tools.get('studio_read')()
    await tools.get('studio_generate')({ revision: current.board.revision, nodeId: 'generator' })
    assert.equal(generated.length, 1)
    let released
    await hooks.get('plugins/before-stop')({ hold: callback => { released = callback } })
    await assert.rejects(tools.get('studio_edit')({ revision: tools.get('studio_read')().board.revision, operations: [{ type: 'rename', title: '停止期间' }] }), /重新/)
    released()
})

test('其他页面保存视口后，热更新继续保存且保留最新内容', async t => {
  const { state, tools, hooks, ctx } = await setup(t)
  await tools.get('studio_edit')({ revision: 0, operations: [{ type: 'add', node: { id: 'text', type: 'text', text: '原文' } }] })
  state.boards[0] = applyOperation(state.boards[0], { type: 'update', id: 'text', patch: { text: '另一页面已保存' } }, {}).board
  const viewport = { x: 120, y: 80, zoom: 0.8 }
  state.boards[0] = applyOperation(state.boards[0], { type: 'viewport', viewport }, {}).board
  let released
  await hooks.get('plugins/before-stop')({ hold: callback => { released = callback } })
  assert.equal(ctx.canvasSession.held, true)
  assert.equal(state.boards[0].nodes[0].text, '另一页面已保存')
  assert.deepEqual(state.boards[0].viewport, viewport)
  assert.equal(tools.get('studio_read')().board.nodes[0].text, '另一页面已保存')
  assert.equal(tools.get('studio_read')().dirty, false)
  released()
})

test('同步其他页面编辑后撤销或重做，不覆盖对方的文字', async t => {
  const { window, state, tools, toasts } = await setup(t)
  const edit = operations => tools.get('studio_edit')({ revision: tools.get('studio_read')().board.revision, operations })
  await edit([{ type: 'add', node: { id: 'text', type: 'text', text: '原文' } }])
  await edit([{ type: 'update', id: 'text', patch: { text: '本页编辑' } }])
  state.boards[0] = applyOperation(state.boards[0], { type: 'update', id: 'text', patch: { text: '外部编辑' } }, {}).board
  await tools.get('studio_jobs')()
  await [...window.document.querySelectorAll('button')].find(b => b.textContent === '↶').onclick()
  assert.equal(state.boards[0].nodes[0].text, '外部编辑')
  assert.match(toasts.at(-1), /冲突|其他页面/)
  await edit([{ type: 'update', id: 'text', patch: { text: '再次本页编辑' } }])
  await [...window.document.querySelectorAll('button')].find(b => b.textContent === '↶').onclick()
  state.boards[0] = applyOperation(state.boards[0], { type: 'update', id: 'text', patch: { text: '外部最新编辑' } }, {}).board
  await tools.get('studio_jobs')()
  await [...window.document.querySelectorAll('button')].find(b => b.textContent === '↷').onclick()
  assert.equal(state.boards[0].nodes[0].text, '外部最新编辑')
  assert.match(toasts.at(-1), /冲突|其他页面/)
})

test('Agent 导入后立即读取并添加图片，不依赖下一轮刷新', async t => {
  const { window, tools } = await setup(t)
  const asset = await tools.get('studio_import_image')({ path: 'C:/test/reference.png' })
  const current = tools.get('studio_read')()
  assert.deepEqual(current.assets[asset.id], asset)
  await tools.get('studio_edit')({ revision: current.board.revision, operations: [{ type: 'add', node: { id: 'image', type: 'image', assetId: asset.id } }] })
  assert.equal(window.document.querySelector('.studio-image img').getAttribute('src'), `/api/studio/images/${asset.id}.webp`)
  assert.match(window.document.querySelector('.studio-image-foot').textContent, /8 × 6/)
})

test('画板名称编辑阻止 Agent 写入，保留草稿并自动保存，不被后台结果重绘覆盖', async t => {
  const { window, state, tools, toasts } = await setup(t)
  const title = window.document.querySelector('[aria-label="画板名称"]')
  title.focus()
  await assert.rejects(tools.get('studio_edit')({ revision: 0, operations: [{ type: 'rename', title: 'Agent 覆盖' }] }), /正在编辑|重新/)
  state.boards[0] = applyOperation(state.boards[0], { type: 'add', node: { id: 'background', type: 'text' } }, {}).board
  await tools.get('studio_jobs')()
  title.value = '新画板名称'; title.oninput()
  assert.equal(tools.get('studio_read')().dirty, true)
  assert.match(window.localStorage.getItem('drafts'), /新画板名称/)
  await tools.get('studio_jobs')()
  assert.equal(title.value, '新画板名称')
  await waitUntil(() => !tools.get('studio_read')().dirty)
  assert.equal(state.boards[0].title, '新画板名称')
  title.value = '新画板名称第二段'; title.oninput()
  await title.onblur()
  assert.equal(state.boards[0].title, '新画板名称第二段')
  assert.equal(state.boards[0].nodes[0].id, 'background')
  assert.deepEqual(toasts, [])
})

test('另一页面同时重命名时保留本页名称草稿，停止应用前也不覆盖', async t => {
  const { window, state, tools, hooks, toasts } = await setup(t)
  const title = window.document.querySelector('[aria-label="画板名称"]')
  title.focus()
  state.boards[0] = applyOperation(state.boards[0], { type: 'rename', title: '另一页面名称' }, {}).board
  await tools.get('studio_jobs')()
  title.value = '我的未保存名称'; title.oninput()
  await title.onblur()
  assert.equal(state.boards[0].title, '另一页面名称')
  assert.equal(title.value, '我的未保存名称')
  assert.equal(tools.get('studio_read')().dirty, true)
  assert.match(window.localStorage.getItem('drafts'), /我的未保存名称/)
  assert.match(toasts.at(-1), /名称.*其他页面|其他页面.*名称/)
  await assert.rejects(hooks.get('plugins/before-stop')({ hold() {} }), /其他页面/)
})

test('提示词停顿自动保存后继续输入，点击生成使用最新内容而不误报冲突', async t => {
  const { window, state, tools, generated, toasts } = await setup(t)
  await tools.get('studio_edit')({ revision: 0, operations: [{ type: 'add', node: { id: 'generator', type: 'generator' } }] })
  const input = window.document.querySelector('textarea')
  input.focus(); input.value = '鳄'; input.oninput()
  await waitUntil(() => !tools.get('studio_read')().dirty)
  assert.equal(state.boards[0].nodes[0].prompt, '鳄')
  assert.equal(window.document.querySelector('textarea'), input, '保存不能打断输入或更换正在使用的输入框')
  input.value = '鳄鱼'; input.oninput()
  await input.onblur()
  await [...window.document.querySelectorAll('button')].find(b => b.textContent === '✦ 生成图片').onclick()
  assert.deepEqual(toasts, [])
  assert.equal(generated.length, 1)
  assert.equal(generated[0].nodes[0].prompt, '鳄鱼')
  assert.equal(tools.get('studio_read')().dirty, false)
  assert.equal(window.localStorage.getItem('drafts'), null)
})

test('自动保存后其他页面修改同一提示词，仍阻止覆盖并保留本页草稿', async t => {
  const { window, state, tools, generated, toasts } = await setup(t)
  await tools.get('studio_edit')({ revision: 0, operations: [{ type: 'add', node: { id: 'generator', type: 'generator' } }] })
  const input = window.document.querySelector('textarea')
  input.focus(); input.value = '鳄'; input.oninput()
  await waitUntil(() => !tools.get('studio_read')().dirty)
  state.boards[0] = applyOperation(state.boards[0], { type: 'update', id: 'generator', patch: { prompt: '另一页面的内容' } }, {}).board
  await tools.get('studio_jobs')()
  assert.equal(window.document.querySelector('textarea'), input)
  input.value = '鳄鱼'; input.oninput()
  await [...window.document.querySelectorAll('button')].find(b => b.textContent === '✦ 生成图片').onclick()
  assert.equal(generated.length, 0)
  assert.equal(state.boards[0].nodes[0].prompt, '另一页面的内容')
  assert.match(toasts.at(-1), /其他页面修改/)
  assert.equal(tools.get('studio_read')().dirty, true)
  assert.equal(JSON.parse(window.localStorage.getItem('drafts')).drafts[0][1].patch.prompt, '鳄鱼')
})

test('图片预览支持缩小放大、拖动平移、滚轮缩放与适应窗口', async t => {
  const { window, tools, toasts } = await setup(t)
  const asset = await tools.get('studio_import_image')({ path: 'C:/test/reference.png' })
  await tools.get('studio_edit')({ revision: tools.get('studio_read')().board.revision, operations: [{ type: 'add', node: { id: 'image', type: 'image', assetId: asset.id } }] })
  const viewer = window.document.querySelector('.studio-viewer')
  assert.equal(viewer.open, false)
  const click = async (text, scope = viewer) => { await [...scope.querySelectorAll('button')].find(b => b.textContent === text).onclick() }
  await [...window.document.querySelectorAll('.studio-image-foot button')].find(b => b.textContent === '预览').onclick()
  assert.equal(viewer.open, true, '预览按钮必须打开预览弹层')
  const stage = viewer.querySelector('.studio-viewer-stage'), image = stage.querySelector('img'), label = viewer.querySelector('.studio-viewer-zoom')
  assert.equal(image.getAttribute('src'), `/api/studio/images/${asset.id}.png`)
  assert.equal(viewer.querySelector('.studio-viewer-resolution').textContent, `${asset.width} × ${asset.height}`)
  const scale = () => Number(/scale\(([\d.]+)\)/.exec(image.style.transform)?.[1])
  const offset = () => /translate\((-?[\d.]+)px,(-?[\d.]+)px\)/.exec(image.style.transform)?.slice(1, 3).map(Number)
  assert.ok(scale() > 0 && scale() <= 1, '打开时按适应窗口显示，不超过 100%')
  assert.equal(label.textContent, Math.round(scale() * 100) + '%')
  await click('＋')
  assert.ok(scale() > 1, '放大后可超过 100%，不再受原始尺寸限制')
  await click('−')
  await click('1:1')
  assert.equal(scale(), 1)
  assert.equal(label.textContent, '100%')
  await click('适应窗口')
  assert.ok(scale() <= 1)
  const wheel = new window.MouseEvent('wheel', { bubbles: true, cancelable: true, clientX: 120, clientY: 120 })
  Object.defineProperty(wheel, 'deltaY', { value: -240 })
  stage.dispatchEvent(wheel)
  assert.ok(scale() > 1, '滚轮向上滚动放大图片')
  const pointer = (type, x, y) => stage.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 3, clientX: x, clientY: y }))
  const moved = { scale: scale(), offset: offset() }
  pointer('pointerdown', 100, 100); pointer('pointermove', 160, 140)
  assert.deepEqual(offset(), [moved.offset[0] + 60, moved.offset[1] + 40], '拖动按指针位移平移图片')
  assert.equal(scale(), moved.scale, '平移不改变缩放')
  assert.equal(stage.classList.contains('grabbing'), true)
  pointer('pointerup', 160, 140)
  assert.equal(stage.classList.contains('grabbing'), false)
  const held = offset()
  pointer('pointermove', 220, 180)
  assert.deepEqual(offset(), held, '松开后不再跟随指针')
  const wheelIn = new window.MouseEvent('wheel', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 })
  Object.defineProperty(wheelIn, 'deltaY', { value: 240 })
  stage.dispatchEvent(wheelIn)
  assert.ok(scale() < moved.scale, '滚轮向下滚动缩小图片')
  await click('关闭预览')
  assert.equal(viewer.open, false)
  const thumb = window.document.querySelector('.studio-image .studio-media-frame img')
  assert.equal(thumb.title, '双击放大预览')
  assert.equal(thumb.onclick, null, '图片自身不再处理单击')
  await thumb.ondblclick({ stopPropagation() {} })
  assert.equal(viewer.open, true, '双击图片卡片缩略图必须打开同一个放大预览')
  assert.equal(viewer.querySelector('.studio-viewer-stage img').getAttribute('src'), `/api/studio/images/${asset.id}.png`)
  assert.deepEqual(toasts, [])
})

for (const saved of [true, false]) test(`提示词${saved ? '已保存' : '仍待保存'}时，按下再松开生成按钮只需一次点击`, async t => {
  const { window, tools, generated, toasts } = await setup(t)
  await tools.get('studio_edit')({ revision: 0, operations: [{ type: 'add', node: { id: 'generator', type: 'generator' } }] })
  const input = window.document.querySelector('textarea')
  input.focus(); input.value = '人类'; input.oninput()
  if (saved) await waitUntil(() => !tools.get('studio_read')().dirty)
  const run = [...window.document.querySelectorAll('button')].find(b => b.textContent === '✦ 生成图片')
  // A real pointer click moves focus on press, then dispatches click on release.
  // Allow blur/autosave to settle between these two events, as with a held click.
  const focusOnPress = run.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))
  if (focusOnPress) run.focus()
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(run.isConnected, true, '松开前必须保留原按钮，否则浏览器不会触发它的 click')
  assert.equal(generated.length, 0, '按下还未松开时不能提前发起生成')
  run.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0 }))
  run.click()
  await waitUntil(() => generated.length === 1)
  assert.equal(generated[0].nodes[0].prompt, '人类')
  assert.equal(tools.get('studio_read')().dirty, false)
  assert.deepEqual(toasts, [])
})

test('固定尾缀显示在提示词输入框底部，保持只读且不写入提示词正文', async t => {
  const { window, state, tools } = await setup(t)
  await tools.get('studio_edit')({ revision: 0, operations: [{ type: 'add', node: { id: 'g', type: 'generator', prompt: '人物提示词', promptSuffixes: [
    { id: 'suffix', title: '固定镜头', text: '固定镜头，无bgm，动作幅度非常大', enabled: true },
    { id: 'off', title: '不启用', text: '不应显示', enabled: false },
  ] } }] })
  await waitUntil(() => window.document.querySelector('.studio-prompt-area'))
  const area = window.document.querySelector('.studio-prompt-area'), preview = area.querySelector('.studio-prompt-suffix-preview')
  assert.equal(area.querySelector('textarea').value, '人物提示词')
  assert.match(preview.textContent, /尾缀 · 只读/)
  assert.match(preview.textContent, /固定镜头，无bgm/)
  assert.doesNotMatch(preview.textContent, /不应显示/)
  assert.equal(preview.querySelector('textarea,input'), null)
  const convert = window.document.querySelector('.studio-suffix-convert')
  await convert.onclick()
  await waitUntil(() => state.boards[0].nodes[0].prompt === '人物提示词\n\n固定镜头，无bgm，动作幅度非常大')
  assert.equal(state.boards[0].nodes[0].promptSuffixes[0].enabled, false)
})

test('编辑尾缀保存后只读预览、按钮和转正文立即使用新内容', async t => {
  let template = { id: 'suffix-camera', kind: 'suffix', title: '固定镜头', text: '旧的镜头尾缀', updatedAt: 1 }
  const env = await setup(t, { libraryService: ({ method, body, state }) => {
    if (method === 'POST') {
      template = { ...template, ...body, updatedAt: 2 }
      const node = state.boards[0].nodes.find(node => node.id === 'g')
      state.boards[0] = applyOperation(state.boards[0], { type: 'update', id: node.id, patch: { promptSuffixes: node.promptSuffixes.map(suffix => ({ ...suffix, title: template.title, text: template.text })) } }, state.assets).board
    }
    return { prompts: [], models: [], cards: [], results: [], suffixes: [structuredClone(template)], history: [] }
  } })
  const { window, tools, state } = env
  await tools.get('studio_edit')({ revision: 0, operations: [{ type: 'add', node: { id: 'g', type: 'generator', prompt: '主提示词', promptSuffixes: [{ id: template.id, title: template.title, text: template.text, enabled: true }] } }] })
  await waitUntil(() => window.document.querySelector('.studio-suffix-manage'))
  await window.document.querySelector('.studio-suffix-manage').onclick()
  await [...window.document.querySelectorAll('.studio-suffix-record button')].find(button => button.textContent === '编辑').onclick()
  const editor = window.document.querySelector('.studio-library-editor')
  editor.querySelector('input').value = '新的镜头模板'
  editor.querySelector('textarea').value = '新的镜头尾缀，不要背景音乐'
  await [...editor.querySelectorAll('button')].find(button => button.textContent === '保存尾缀').onclick()
  assert.equal(editor.open, false)
  const preview = window.document.querySelector('.studio-prompt-suffix-preview')
  assert.match(preview.textContent, /新的镜头尾缀，不要背景音乐/)
  assert.doesNotMatch(preview.textContent, /旧的镜头尾缀/)
  assert.equal(window.document.querySelector('.studio-prompt-suffix').textContent, '新的镜头模板')
  window.document.querySelector('.studio-suffix-list').closest('dialog').close()
  await window.document.querySelector('.studio-suffix-convert').onclick()
  assert.equal(state.boards[0].nodes[0].prompt, '主提示词\n\n新的镜头尾缀，不要背景音乐')
  assert.equal(state.boards[0].nodes[0].promptSuffixes[0].enabled, false)
})

test('未收藏的图片和视频结果显示参数卡入口，点击或拖出恢复当次参数且保持视角', async t => {
  const { window, state, tools, ctx, generated } = await setup(t)
  state.assets.image = { id: 'image', kind: 'image', name: '结果.png', width: 64, height: 48 }
  state.assets.video = { id: 'video', kind: 'video', name: '结果.mp4', width: 480, height: 640, duration: 5, extension: 'mp4' }
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'g', type: 'generator', prompt: '生成时的提示词', references: [{ id: 'reference', assetId: 'image' }], textReferences: [{ id: 'text-ref', title: '文字', text: '外部文字' }] } },
    { type: 'add', node: { id: 'image-result', type: 'image', assetId: 'image', sourceNodeId: 'g', x: 600, y: 100 } },
    { type: 'add', node: { id: 'video-result', type: 'video', assetId: 'video', sourceNodeId: 'g', x: 1000, y: 100 } },
  ] })
  const cardSnapshot = snapshotGenerator(state.boards[0].nodes[0], { board: state.boards[0], types: createTypes(), assets: state.assets })
  for (const id of ['image-result', 'video-result']) state.jobs.push({ id: 'job-' + id, boardId: state.boards[0].id, nodeId: 'g', resultNodeId: id, status: 'succeeded', cardSnapshot: structuredClone(cardSnapshot) })
  await tools.get('studio_edit')({ revision: state.boards[0].revision, operations: [{ type: 'update', id: 'g', patch: { prompt: '现在已经修改的提示词' } }] })
  const video = window.document.querySelector('[data-node="video-result"] video')
  ctx.canvasSession.viewport = { x: 123, y: -456, zoom: .5 }
  await waitUntil(() => window.document.querySelectorAll('.studio-result-parameter').length === 2)
  await window.document.querySelector('[data-node="image-result"] .studio-result-parameter').onclick({ stopPropagation() {} })
  let restored = state.boards[0].nodes.at(-1)
  assert.equal(restored.type, 'generator')
  assert.equal(restored.prompt, '生成时的提示词')
  assert.equal(restored.references[0].assetId, 'image')
  assert.equal(restored.textReferences[0].text, '外部文字')
  const values = new Map(), dataTransfer = { setData(type, value) { values.set(type, value) }, getData(type) { return values.get(type) || '' }, files: [], get types() { return [...values.keys()] } }
  const drag = window.document.querySelector('[data-node="video-result"] .studio-result-parameter')
  drag.ondragstart({ stopPropagation() {}, dataTransfer })
  assert.equal(state.boards[0].nodes.length, 4, '开始拖动时不能创建卡片')
  const event = new window.Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperties(event, { dataTransfer: { value: dataTransfer }, clientX: { value: 500 }, clientY: { value: 250 } })
  window.document.querySelector('.studio-stage').dispatchEvent(event)
  await waitUntil(() => state.boards[0].nodes.length === 5)
  restored = state.boards[0].nodes.at(-1)
  assert.equal(restored.prompt, '生成时的提示词')
  assert.deepEqual({ x: restored.x, y: restored.y }, { x: 754, y: 1412 })
  assert.deepEqual(ctx.canvasSession.viewport, { x: 123, y: -456, zoom: .5 })
  assert.equal(window.document.querySelector('[data-node="video-result"] video'), video, '添加参数卡不能刷新已有视频')
  assert.equal(window.document.querySelectorAll('[data-node="video-result"] .studio-result-parameter').length, 1)
  assert.equal(generated.length, 0, '恢复参数卡不能自动生成')
})

test('视频标题自动保存并刷新后失焦恢复标题，重复编辑仍保留播放器', async t => {
  const { window, state, tools, ctx, toasts } = await setup(t)
  state.assets.clip = { id: 'clip', kind: 'video', name: '视频.mp4', extension: 'mp4', width: 480, height: 640, duration: 5.2 }
  await tools.get('studio_edit')({ revision: 0, operations: [{ type: 'add', node: { id: 'video', type: 'video', title: '原始标题', assetId: 'clip' } }] })
  const card = window.document.querySelector('[data-node="video"]'), player = card.querySelector('video')
  player.currentTime = 2.5
  const blur = async input => {
    const onblur = input.onblur
    let pending
    input.onblur = event => { pending = onblur(event) }
    input.blur()
    await pending
  }
  for (const title of ['自动保存后的标题', '再次修改后的标题']) {
    card.querySelector('[title="双击修改卡片标题"]').dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }))
    const input = card.querySelector('.studio-card-head input')
    assert.ok(window.document.activeElement === input, '标题输入框应获得焦点')
    input.value = title; input.oninput()
    await waitUntil(() => !tools.get('studio_read')().dirty)
    assert.equal(state.boards[0].nodes[0].title, title)
    state.jobs.push({ id: 'background-' + state.jobs.length, status: 'running' })
    await ctx.canvasSession.refresh({ fresh: true })
    assert.equal(ctx.canvasSession.state.jobs.length, state.jobs.length, '编辑期间仍接收轮询结果')
    assert.ok(card.querySelector('.studio-card-head input') === input, '刷新不能打断正在编辑的标题')
    await blur(input)
    assert.equal(ctx.canvasSession.editing, false)
    assert.ok(!card.querySelector('.studio-card-head input'), '失焦后应恢复正常标题')
    assert.equal(card.querySelector('[title="双击修改卡片标题"]').textContent, title)
    assert.ok(window.document.querySelector('[data-node="video"]') === card, '恢复标题不能重建卡片')
    assert.ok(card.querySelector('video') === player, '恢复标题不能重建播放器')
    assert.equal(player.currentTime, 2.5)
    state.jobs.at(-1).status = 'succeeded'
    await ctx.canvasSession.refresh({ fresh: true })
    assert.ok(!card.querySelector('.studio-card-head input'), '后续轮询不能恢复编辑框')
    assert.ok(window.document.querySelector('[data-node="video"]') === card, '后续轮询继续复用卡片')
    assert.ok(window.document.querySelector('[data-node="video"] video') === player, '后续轮询继续复用播放器')
    assert.equal(player.currentTime, 2.5)
  }
  assert.deepEqual(toasts, [])
})

test('视频标题保存冲突时保留输入和草稿，不重建播放器', async t => {
  const { window, state, tools, toasts } = await setup(t)
  state.assets.clip = { id: 'clip', kind: 'video', name: '视频.mp4', extension: 'mp4', width: 480, height: 640, duration: 5.2 }
  await tools.get('studio_edit')({ revision: 0, operations: [{ type: 'add', node: { id: 'video', type: 'video', title: '原始标题', assetId: 'clip' } }] })
  const card = window.document.querySelector('[data-node="video"]'), player = card.querySelector('video')
  card.querySelector('[title="双击修改卡片标题"]').dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }))
  const input = card.querySelector('.studio-card-head input')
  input.value = '本页草稿'; input.oninput()
  state.boards[0] = applyOperation(state.boards[0], { type: 'update', id: 'video', patch: { title: '另一页面标题' } }, state.assets).board
  await input.onblur()
  assert.equal(state.boards[0].nodes[0].title, '另一页面标题')
  assert.ok(card.querySelector('.studio-card-head input') === input, '保存冲突时保留标题编辑框')
  assert.equal(input.value, '本页草稿')
  assert.equal(tools.get('studio_read')().dirty, true)
  assert.equal(JSON.parse(window.localStorage.getItem('drafts')).drafts[0][1].patch.title, '本页草稿')
  assert.ok(window.document.querySelector('[data-node="video"] video') === player, '保存冲突不能重建播放器')
  assert.match(toasts.at(-1), /其他页面修改/)
})

test('生成视频首次播放后写入播放状态，导入视频不显示未播放标记', async t => {
  const { window, state, tools } = await setup(t)
  state.assets.clip = { id: 'clip', kind: 'video', name: '结果.mp4', extension: 'mp4', width: 480, height: 640, duration: 5.2 }
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'g', type: 'generator', prompt: '生成' } },
    { type: 'add', node: { id: 'result', type: 'video', assetId: 'clip', sourceNodeId: 'g' } },
    { type: 'add', node: { id: 'imported', type: 'video', assetId: 'clip' } },
  ] })
  await waitUntil(() => window.document.querySelector('[data-node="result"] video'))
  const card = window.document.querySelector('[data-node="result"]')
  const imported = window.document.querySelector('[data-node="imported"]')
  assert.equal(card.classList.contains('is-unplayed'), true)
  assert.equal(card.querySelector('.studio-video-unplayed').textContent, '未播放')
  assert.equal(imported.classList.contains('is-unplayed'), false)
  assert.equal(imported.querySelector('.studio-video-unplayed'), null)
  card.querySelector('video').dispatchEvent(new window.Event('play'))
  await waitUntil(() => state.boards[0].nodes.find(node => node.id === 'result').played === true)
  assert.equal(card.classList.contains('is-unplayed'), false)
  assert.equal(card.querySelector('.studio-video-unplayed'), null)
})

test('视频两点循环可在 A-B 之间循环，仅设置 A 时循环到结尾', async t => {
  const { window, state, tools, ctx } = await setup(t)
  state.assets.clip = ctx.canvasSession.rememberAsset({ id: 'clip', kind: 'video', name: '循环.mp4', extension: 'mp4', width: 640, height: 360, duration: 8 })
  await tools.get('studio_edit')({ revision: 0, operations: [{ type: 'add', node: { id: 'clip', type: 'video', assetId: 'clip' } }] })
  await waitUntil(() => window.document.querySelector('[data-node="clip"] .studio-video-controls'))
  const card = window.document.querySelector('[data-node="clip"]'), player = card.querySelector('video')
  Object.defineProperty(player, 'duration', { configurable: true, value: 8 })
  Object.defineProperty(player, 'paused', { configurable: true, value: true })
  player.currentTime = 2
  const pointsButton = card.querySelector('.studio-video-loop-points'), panel = card.querySelector('.studio-video-loop-panel')
  assert.equal(panel.hidden, true)
  assert.equal(card.querySelector('.studio-video-point-b').disabled, true, '设置 A 点前 B 点不可用')
  pointsButton.onclick()
  assert.equal(panel.hidden, false)
  await card.querySelector('.studio-video-point-a').onclick()
  await waitUntil(() => state.boards[0].nodes[0].loopA === 2)
  assert.equal(card.querySelector('.studio-video-point-b').disabled, false)
  assert.equal(card.querySelector('.studio-video-loop-marker.is-a').hidden, false)
  assert.equal(card.querySelector('.studio-video-loop-marker.is-a').style.left, '25%')
  assert.match(card.querySelector('.studio-video-loop-status').textContent, /A 0:02.*循环到结尾/)
  player.currentTime = 5
  await card.querySelector('.studio-video-point-b').onclick()
  await waitUntil(() => state.boards[0].nodes[0].loopB === 5)
  assert.equal(card.querySelector('.studio-video-loop-marker.is-b').style.left, '62.5%')
  assert.match(card.querySelector('.studio-video-loop-status').textContent, /A 0:02.*B 0:05/)
  await card.querySelector('.studio-video-loop').onclick()
  await waitUntil(() => state.boards[0].nodes[0].loop === true)
  assert.equal(player.loop, false, '设置 A 点后由两点循环接管，不能使用整段原生循环')
  Object.defineProperty(player, 'paused', { configurable: true, value: false })
  player.currentTime = 5.1
  player.ontimeupdate()
  assert.equal(player.currentTime, 2, '播放到 B 点后回到 A 点')
  player.currentTime = 1
  player.ontimeupdate()
  assert.equal(player.currentTime, 2, '循环开启时播放位置不能停在 A 点之前')
  await card.querySelector('.studio-video-point-clear').onclick()
  await waitUntil(() => state.boards[0].nodes[0].loopA === undefined)
  assert.equal(state.boards[0].nodes[0].loopB, undefined)
  assert.equal(player.loop, true, '清除两点后恢复整段视频循环')
  player.currentTime = 2
  await card.querySelector('.studio-video-point-a').onclick()
  await waitUntil(() => state.boards[0].nodes[0].loopA === 2)
  player.currentTime = 8
  player.ontimeupdate()
  assert.equal(player.currentTime, 2, '只设置 A 点时默认循环到视频结尾')
})

test('从输出圆点拖到目标卡片任意位置即可完成连线', async t => {
  const { window, state, tools } = await setup(t)
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'text', type: 'text', x: 0, y: 0, text: '输入文字' } },
    { type: 'add', node: { id: 'g', type: 'generator', x: 400, y: 0, prompt: '生成' } },
  ] })
  await waitUntil(() => window.document.querySelector('[data-node="text"] [data-output]') && window.document.querySelector('[data-node="g"] textarea'))
  const target = window.document.querySelector('[data-node="g"] textarea')
  window.document.elementFromPoint = () => target
  const output = window.document.querySelector('[data-node="text"] [data-output]')
  output.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 31, clientX: 280, clientY: 40 }))
  window.dispatchEvent(new window.PointerEvent('pointermove', { bubbles: true, button: 0, pointerId: 31, clientX: 460, clientY: 60 }))
  await new Promise(resolve => window.requestAnimationFrame(resolve))
  assert.equal(window.document.querySelector('[data-node="g"]').classList.contains('is-connect-target'), true)
  window.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 31, clientX: 460, clientY: 60 }))
  await waitUntil(() => state.boards[0].edges.some(edge => edge.from === 'text' && edge.to === 'g'))
})

test('参数卡输入圆点支持反向拖拽和点击连线', async t => {
  const { window, state, tools } = await setup(t)
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'text', type: 'text', x: 0, y: 0, text: '上游文字' } },
    { type: 'add', node: { id: 'g1', type: 'generator', x: 400, y: 0, prompt: '生成一' } },
    { type: 'add', node: { id: 'g2', type: 'generator', x: 800, y: 0, prompt: '生成二' } },
  ] })
  await waitUntil(() => window.document.querySelector('[data-node="g2"] [data-input]'))
  const textCard = window.document.querySelector('[data-node="text"]')
  window.document.elementFromPoint = () => textCard
  const first = window.document.querySelector('[data-node="g1"] [data-input]')
  first.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 41, clientX: 400, clientY: 40 }))
  window.dispatchEvent(new window.PointerEvent('pointermove', { bubbles: true, button: 0, pointerId: 41, clientX: 100, clientY: 40 }))
  await new Promise(resolve => window.requestAnimationFrame(resolve))
  assert.equal(textCard.classList.contains('is-connect-target'), true)
  window.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 41, clientX: 100, clientY: 40 }))
  await waitUntil(() => state.boards[0].edges.some(edge => edge.from === 'text' && edge.to === 'g1'))

  const second = window.document.querySelector('[data-node="g2"] [data-input]')
  second.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 42, clientX: 800, clientY: 40 }))
  window.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 42, clientX: 800, clientY: 40 }))
  window.document.querySelector('[data-node="text"]').dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 43, clientX: 100, clientY: 40 }))
  await waitUntil(() => state.boards[0].edges.some(edge => edge.from === 'text' && edge.to === 'g2'))
})

test('单参数卡 Ctrl+A 选择直接产物，并可整理为右侧近方形网格', async t => {
  const { window, state, tools, editBatches } = await setup(t)
  for (const id of ['a1', 'a2', 'a3', 'a4']) state.assets[id] = { id, name: id + '.png', kind: 'image', width: 288, height: 360 }
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'g', type: 'generator', x: 500, y: 100, prompt: '批量生成' } },
    { type: 'add', node: { id: 'r1', type: 'image', x: 1000, y: 100, assetId: 'a1', sourceNodeId: 'g' } },
    { type: 'add', node: { id: 'r2', type: 'image', x: 1200, y: 300, assetId: 'a2', sourceNodeId: 'g' } },
    { type: 'add', node: { id: 'r3', type: 'image', x: 1400, y: 500, assetId: 'a3', sourceNodeId: 'g' } },
    { type: 'add', node: { id: 'other', type: 'image', x: 0, y: 900, assetId: 'a4' } },
  ] })
  await waitUntil(() => window.document.querySelector('[data-node="g"] .studio-card-head'))
  const head = window.document.querySelector('[data-node="g"] .studio-card-head')
  head.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 51, clientX: 520, clientY: 120 }))
  window.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 51, clientX: 520, clientY: 120 }))
  const stage = window.document.querySelector('.studio-stage'), context = window.document.querySelector('.studio-context-tools')
  stage.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }))
  const selected = id => window.document.querySelector(`[data-node="${id}"]`).classList.contains('selected')
  for (const id of ['g', 'r1', 'r2', 'r3']) assert.equal(selected(id), true)
  assert.equal(selected('other'), false)
  assert.match(context.textContent, /已选 4 张卡片.*整理子集/)
  await [...window.document.querySelectorAll('button')].find(button => button.textContent === '整理子集').onclick()
  await waitUntil(() => state.boards[0].nodes.find(node => node.id === 'r3').y === 508)
  assert.deepEqual(editBatches.at(-1).map(operation => operation.type), ['layout'])
  const positions = Object.fromEntries(state.boards[0].nodes.map(node => [node.id, { x: node.x, y: node.y }]))
  assert.deepEqual(positions, {
    g: { x: 500, y: 100 }, r1: { x: 908, y: 100 }, r2: { x: 1244, y: 100 }, r3: { x: 908, y: 508 }, other: { x: 0, y: 900 },
  })
})

test('移动参数卡后整理子集使用最新位置', async t => {
  const { window, state, tools } = await setup(t)
  for (const id of ['a1', 'a2', 'a3']) state.assets[id] = { id, name: id + '.png', kind: 'image', width: 288, height: 360 }
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'g', type: 'generator', x: 500, y: 100, prompt: '移动后整理' } },
    { type: 'add', node: { id: 'r1', type: 'image', x: 900, y: 100, assetId: 'a1', sourceNodeId: 'g' } },
    { type: 'add', node: { id: 'r2', type: 'image', x: 1200, y: 100, assetId: 'a2', sourceNodeId: 'g' } },
    { type: 'add', node: { id: 'r3', type: 'image', x: 900, y: 500, assetId: 'a3', sourceNodeId: 'g' } },
  ] })
  await waitUntil(() => window.document.querySelector('[data-node="g"] .studio-card-head'))
  const stage = window.document.querySelector('.studio-stage'), head = window.document.querySelector('[data-node="g"] .studio-card-head')
  const pointer = (type, target, x, y) => target.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 61, clientX: x, clientY: y }))
  pointer('pointerdown', head, 500, 100)
  pointer('pointerup', window, 500, 100)
  assert.equal(window.document.querySelector('.studio-context-tools').hidden, false)
  pointer('pointerdown', head, 500, 100)
  pointer('pointermove', stage, 600, 150)
  pointer('pointerup', window, 600, 150)
  await waitUntil(() => state.boards[0].nodes.find(node => node.id === 'g').x === 600)
  const generator = state.boards[0].nodes.find(node => node.id === 'g')
  assert.deepEqual({ x: generator.x, y: generator.y }, { x: 600, y: 150 })
  stage.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }))
  await waitUntil(() => /整理子集/.test(window.document.querySelector('.studio-context-tools').textContent))
  await [...window.document.querySelectorAll('button')].find(button => button.textContent === '整理子集').onclick()
  await waitUntil(() => state.boards[0].nodes.find(node => node.id === 'r1').y === 150)
  const moved = state.boards[0].nodes.find(node => node.id === 'g'), first = state.boards[0].nodes.find(node => node.id === 'r1')
  assert.equal(first.x - moved.x, 408, '产物应基于参数卡移动后的 x 坐标展开')
  assert.equal(first.y, moved.y)
})

test('Ctrl+C 只记录整组副本，Ctrl+V 在鼠标位置粘贴并保留组内连线', async t => {
  const { window, state, tools } = await setup(t)
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'text', type: 'text', x: 0, y: 0, text: '组内文字' } },
    { type: 'add', node: { id: 'g', type: 'generator', x: 100, y: 100, prompt: '组内生成' } },
    { type: 'connect', id: 'edge', from: 'text', to: 'g' },
  ] })
  await waitUntil(() => window.document.querySelector('[data-node="g"]'))
  const stage = window.document.querySelector('.studio-stage')
  stage.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }))
  stage.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }))
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(state.boards[0].nodes.length, 2, '复制阶段不创建卡片')
  stage.dispatchEvent(new window.PointerEvent('pointermove', { bubbles: true, clientX: 500, clientY: 300 }))
  stage.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }))
  await waitUntil(() => state.boards[0].nodes.length === 4)
  const added = state.boards[0].nodes.filter(node => node.id !== 'text' && node.id !== 'g'), copiedText = added.find(node => node.type === 'text'), copiedGenerator = added.find(node => node.type === 'generator')
  assert.equal(copiedText.x, 440); assert.equal(copiedText.y, 240)
  assert.equal(copiedGenerator.x - copiedText.x, 100); assert.equal(copiedGenerator.y - copiedText.y, 100)
  assert.equal(state.boards[0].edges.some(edge => edge.from === copiedText.id && edge.to === copiedGenerator.id), true)
  stage.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true, cancelable: true }))
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(state.boards[0].nodes.length, 4, 'Ctrl+D 已移除')
  stage.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }))
  await waitUntil(() => state.boards[0].nodes.length === 6)
  assert.equal(new Set(state.boards[0].nodes.map(node => node.id)).size, 6)
})

test('参考槽位可选中并通过 Ctrl+V 填入或替换单张图片', async t => {
  const { window, state, tools, ctx } = await setup(t)
  for (const asset of [{ id: 'one', kind: 'image', name: '图一.png', width: 64, height: 48 }, { id: 'two', kind: 'image', name: '图二.png', width: 80, height: 60 }]) { state.assets[asset.id] = asset; ctx.canvasSession.rememberAsset(asset) }
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'img1', type: 'image', x: 0, y: 0, assetId: 'one' } },
    { type: 'add', node: { id: 'img2', type: 'image', x: 0, y: 420, assetId: 'two' } },
    { type: 'add', node: { id: 'g', type: 'generator', x: 400, y: 0, prompt: '测试', references: [{ id: 'slot', assetId: null }], referenceOrder: ['direct:slot'] } },
  ] })
  await waitUntil(() => window.document.querySelector('[data-node="g"] .studio-reference-row'))
  const stage = window.document.querySelector('.studio-stage')
  const selectCard = id => {
    const card = window.document.querySelector(`[data-node="${id}"]`)
    card.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 41, clientX: 20, clientY: 20 }))
    window.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 41, clientX: 20, clientY: 20 }))
  }
  selectCard('img1')
  stage.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }))
  await new Promise(resolve => setTimeout(resolve, 30))
  let row = window.document.querySelector('[data-node="g"] .studio-reference-row')
  row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  assert.equal(row.classList.contains('is-selected'), true)
  row.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }))
  await waitUntil(() => state.boards[0].nodes.find(node => node.id === 'g').references[0].assetId === 'one')
  selectCard('img2')
  stage.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }))
  await new Promise(resolve => setTimeout(resolve, 30))
  row = window.document.querySelector('[data-node="g"] .studio-reference-row')
  row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  row.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }))
  await waitUntil(() => state.boards[0].nodes.find(node => node.id === 'g').references[0].assetId === 'two')
})

test('缺少 kind 的旧图片收藏拖入画布时创建图片卡片', async t => {
  const library = { prompts: [], models: [], cards: [], suffixes: [], history: [], results: [{ id: 'legacy', title: '旧图片', assetId: 'legacy-image', node: { type: 'generator', prompt: '旧提示词' } }] }
  const { window, state, ctx, toasts } = await setup(t, { library })
  state.assets['legacy-image'] = ctx.canvasSession.rememberAsset({ id: 'legacy-image', width: 300, height: 200, name: '旧图片.png' })
  await window.document.querySelector('.studio-library-entry').onclick()
  await waitUntil(() => window.document.querySelector('.studio-saved-card'))
  const values = new Map(), dataTransfer = { setData(type, value) { values.set(type, value) }, getData(type) { return values.get(type) || '' }, files: [], get types() { return [...values.keys()] } }
  window.document.querySelector('.studio-saved-card').ondragstart({ dataTransfer })
  const event = new window.Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperties(event, { dataTransfer: { value: dataTransfer }, clientX: { value: 500 }, clientY: { value: 250 } })
  ctx.canvasUI.stage.dispatchEvent(event)
  await waitUntil(() => state.boards[0].nodes.length === 1)
  assert.equal(state.boards[0].nodes[0].type, 'image')
  assert.equal(state.boards[0].nodes[0].assetId, 'legacy-image')
  assert.deepEqual(toasts, [])
})

test('结果收藏展示真实视频、悬停显示生成参数，拖到画布添加结果', async t => {
  const library = {
    prompts: [], models: [], cards: [], suffixes: [], history: [],
    results: [{
      id: 'favorite-result', title: '生成结果 9', assetId: 'result-video', outputKind: 'video', sourceTitle: '视频来源',
      node: { type: 'generator', title: '视频来源', prompt: '真实结果的提示词', ratio: '1:1', resolution: '1k', provider: 'wavespeed', model: 'mock/video', modelParameters: { 'wavespeed:mock/video': { duration: 5 } }, references: [{ id: 'ref', assetId: 'reference-image' }], textReferences: [] },
    }],
  }
  const { window, ctx, state } = await setup(t, { library })
  ctx.canvasSession.rememberAsset({ id: 'result-video', kind: 'video', name: '结果.mp4', extension: 'mp4', width: 480, height: 704, duration: 5.2 })
  ctx.canvasSession.rememberAsset({ id: 'reference-image', kind: 'image', name: '参考图.png', width: 64, height: 48 })
  state.assets['result-video'] = ctx.canvasSession.state.assets['result-video']
  state.assets['reference-image'] = ctx.canvasSession.state.assets['reference-image']
  await window.document.querySelector('.studio-library-entry').onclick()
  await waitUntil(() => !window.document.querySelector('.studio-library-panel').hidden && window.document.querySelector('.studio-saved-card'))
  const card = window.document.querySelector('.studio-saved-card'), preview = card.querySelector('.studio-result-favorite-preview')
  assert.match(preview.querySelector('video').getAttribute('src'), /\/videos\/result-video/)
  assert.equal(preview.querySelector('video').controls, true)
  assert.equal(preview.querySelector('img'), null, '不能把生成卡片的参考图当作结果预览')
  assert.equal(preview.querySelector('.studio-result-favorite-kind').textContent, '▷ 视频')
  card.dispatchEvent(new window.Event('pointerenter'))
  const info = window.document.querySelector('.studio-favorite-info')
  assert.equal(info.hidden, false)
  assert.match(info.textContent, /真实结果的提示词/)
  assert.match(info.textContent, /duration/)
  assert.match(info.textContent, /480 × 704 · 5.2 秒/)
  const addParameters = [...card.querySelectorAll('button')].find(button => button.textContent === '添加参数卡')
  await addParameters.onclick()
  await waitUntil(() => state.boards[0].nodes.length === 1)
  assert.equal(state.boards[0].nodes[0].type, 'generator', '添加参数卡仍添加参数卡')
  assert.equal(state.boards[0].nodes[0].prompt, '真实结果的提示词')
  const values = new Map(), dataTransfer = { setData(type, value) { values.set(type, value) }, getData(type) { return values.get(type) || '' }, files: [], get types() { return [...values.keys()] } }
  card.ondragstart({ dataTransfer })
  assert.equal(state.boards[0].nodes.length, 1, '开始拖动时不能创建卡片')
  const event = new window.Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperties(event, { dataTransfer: { value: dataTransfer }, clientX: { value: 500 }, clientY: { value: 250 } })
  window.document.querySelector('.studio-stage').dispatchEvent(event)
  await waitUntil(() => state.boards[0].nodes.length === 2)
  const added = state.boards[0].nodes[1]
  assert.equal(added.type, 'video', '拖动结果收藏添加视频卡片而非参数卡')
  assert.equal(added.assetId, 'result-video')
  assert.equal(added.title, '生成结果 9')
  assert.equal(state.boards[0].nodes.filter(node => node.type === 'generator').length, 1, '拖动结果收藏不能额外添加参数卡')
})

test('参考素材选择器按模型槽位过滤类型，并支持点击背景关闭', async t => {
  const { window, state, tools, ctx } = await setup(t, { models: dynamicModels() })
  state.assets.image = ctx.canvasSession.rememberAsset({ id: 'image', kind: 'image', name: '参考图.png', width: 64, height: 48 })
  state.assets.video = ctx.canvasSession.rememberAsset({ id: 'video', kind: 'video', name: '参考视频.mp4', width: 64, height: 48, duration: 2 })
  await tools.get('studio_edit')({ revision: 0, operations: [{ type: 'add', node: { id: 'g', type: 'generator', provider: 'wavespeed', model: 'mock/edit', prompt: '测试', references: [{ id: 'slot', assetId: null }], referenceOrder: ['direct:slot'] } }] })
  await waitUntil(() => window.document.querySelector('[data-node="g"] .studio-reference-thumb.is-empty'))
  await waitUntil(() => /图片 ·/.test(window.document.querySelector('[data-node="g"] .studio-selected-model')?.textContent || ''))
  const empty = window.document.querySelector('[data-node="g"] .studio-reference-thumb.is-empty')
  await empty.onclick()
  const picker = window.document.querySelector('.studio-asset-picker')
  assert.equal(picker.open, true)
  const names = [...picker.querySelectorAll('.studio-picker-item:not(.is-upload)')].map(item => item.textContent)
  assert.deepEqual(names, ['参考图.png'], JSON.stringify({ assets: Object.keys(ctx.canvasSession.state.assets), text: picker.textContent }))
  picker.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  assert.equal(picker.open, false)
})

test('单张图片参考会默认选择模型的首帧输入', async t => {
  const env = await setup(t, { models: dynamicModels() }), { window, state, tools } = env
  state.assets.one = { id: 'one', kind: 'image', name: '首帧.png', width: 64, height: 48 }
  await tools.get('studio_edit')({ revision: 0, operations: [{ type: 'add', node: { id: 'g', type: 'generator', provider: 'wavespeed', model: 'mock/video', prompt: '测试', references: [{ id: 'image', assetId: 'one' }], referenceOrder: ['direct:image'] } }] })
  await waitUntil(() => window.document.querySelector('[aria-label="参考素材 1 输入位置"]'))
  const select = window.document.querySelector('[aria-label="参考素材 1 输入位置"]')
  assert.equal(select.value, '/start_image')
  assert.match(select.selectedOptions[0].textContent, /首帧/)
})

test('粘贴多张图片后逐张删除，不残留卡片或重叠位置', async t => {
  const { window, state, editBatches } = await setup(t)
  const stage = window.document.querySelector('.studio-stage')
  const files = [1, 2, 3].map(index => new window.File([new Uint8Array([137, 80, 78, 71, index])], `clip-${index}.png`, { type: 'image/png' }))
  const event = new window.Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { files, items: [], getData: () => '' } })
  stage.dispatchEvent(new window.PointerEvent('pointermove', { bubbles: true, clientX: 500, clientY: 300 }))
  stage.dispatchEvent(event)
  await waitUntil(() => state.boards[0].nodes.length === 3)
  assert.equal(editBatches.filter(batch => batch.some(operation => operation.type === 'add')).length, 1, '多张图片应一次原子添加')
  assert.deepEqual({ x: state.boards[0].nodes[0].x, y: state.boards[0].nodes[0].y }, { x: 440, y: 240 }, '第一张图片应落在鼠标位置')
  assert.equal(new Set(state.boards[0].nodes.map(node => `${node.x},${node.y}`)).size, 3, '多张图片不应重叠')
  for (const node of [...state.boards[0].nodes]) {
    const card = window.document.querySelector(`[data-node="${node.id}"]`)
    card.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: 20, clientY: 20 }))
    window.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1, clientX: 20, clientY: 20 }))
    stage.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
    await waitUntil(() => !state.boards[0].nodes.some(item => item.id === node.id))
    await waitUntil(() => !window.document.querySelector(`[data-node="${node.id}"]`))
  }
  assert.equal(state.boards[0].nodes.length, 0)
})

test('连续粘贴两批图片时排队添加，位置不重叠', async t => {
  const { window, state } = await setup(t)
  const stage = window.document.querySelector('.studio-stage')
  let release
  state.uploadGate = new Promise(resolve => { release = resolve })
  const paste = prefix => {
    const files = [1, 2].map(index => new window.File([new Uint8Array([137, 80, 78, 71, index])], `${prefix}-${index}.png`, { type: 'image/png' }))
    const event = new window.Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { files, items: [], getData: () => '' } })
    stage.dispatchEvent(event)
  }
  paste('a'); paste('b')
  await waitUntil(() => state.uploadRequested)
  release()
  await waitUntil(() => state.boards[0].nodes.length === 4)
  assert.equal(new Set(state.boards[0].nodes.map(node => `${node.x},${node.y}`)).size, 4)
})

test('上传期间切换画板，排队粘贴仍使用原画板和原位置', async t => {
  const { window, state, ctx, toasts } = await setup(t)
  const originalId = state.boards[0].id, other = newBoard('另一个画板')
  state.boards.push(other)
  await ctx.canvasSession.refresh()
  await ctx.canvasSession.edit([{ type: 'add', node: { id: 'occupied', type: 'text', x: 440, y: 240, text: '占位' } }])
  const stage = window.document.querySelector('.studio-stage')
  stage.dispatchEvent(new window.PointerEvent('pointermove', { bubbles: true, clientX: 500, clientY: 300 }))
  let release
  state.uploadGate = new Promise(resolve => { release = resolve })
  for (const name of ['first.png', 'second.png']) {
    const files = [new window.File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' })]
    const event = new window.Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { files, items: [], getData: () => '' } })
    stage.dispatchEvent(event)
  }
  await waitUntil(() => state.uploadRequested)
  await ctx.canvasSession.choose(other.id)
  stage.dispatchEvent(new window.PointerEvent('pointermove', { bubbles: true, clientX: 100, clientY: 100 }))
  release()
  await waitUntil(() => state.boards.flatMap(board => board.nodes).filter(node => node.type === 'image').length === 2)
  const original = state.boards.find(board => board.id === originalId)
  assert.deepEqual(original.nodes.filter(node => node.type === 'image').map(({ title, x, y }) => ({ title, x, y })), [
    { title: 'first.png', x: 780, y: 240 },
    { title: 'second.png', x: 1120, y: 240 },
  ])
  assert.deepEqual(state.boards.find(board => board.id === other.id).nodes, [])
  assert.equal(ctx.canvasSession.boardId, other.id)
  assert.deepEqual(toasts, [])
})

test('删除失败后立即同步其他页面改动，后续删除不被阻断', async t => {
  const { window, state, tools } = await setup(t)
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'a', type: 'text', x: 0, y: 0, text: 'A' } },
    { type: 'add', node: { id: 'b', type: 'text', x: 340, y: 0, text: 'B' } },
  ] })
  await waitUntil(() => window.document.querySelectorAll('.studio-card').length === 2)
  state.boards[0] = applyOperation(state.boards[0], { type: 'remove', ids: ['b'] }, state.assets).board
  const stage = window.document.querySelector('.studio-stage')
  const select = id => {
    const card = window.document.querySelector(`[data-node="${id}"]`)
    card.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: 20, clientY: 20 }))
    window.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1, clientX: 20, clientY: 20 }))
  }
  select('a')
  stage.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.equal(window.document.querySelectorAll('.studio-card').length, 1, '删除失败后应立即同步其他页面的改动')
  select('a')
  stage.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
  await waitUntil(() => state.boards[0].nodes.length === 0)
  assert.equal(window.document.querySelectorAll('.studio-card').length, 0)
})
