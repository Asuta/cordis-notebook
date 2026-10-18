import { randomUUID } from 'node:crypto'
import { snapshotGenerator } from './snapshot.js'
import { definition } from './definition.js'

const fail = message => { throw Object.assign(Error(message), { status: 400 }) }
const text = (value, max, label) => { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(label + '格式无效'); return value }
export function createLibrary(documents, jobs) {
  const records = documents.records('generation-library')
  function read() {
    const all = records.read(), seen = new Set(), history = []
    for (const job of [...jobs.read()].sort((a, b) => b.createdAt - a.createdAt)) {
      const prompt = job.promptText ?? job.input?.prompt
      if (!prompt?.trim() || seen.has(prompt)) continue
      seen.add(prompt); history.push({ id: job.id, prompt, createdAt: job.createdAt })
      if (history.length >= 300) break
    }
    return {
      prompts: all.filter(item => item.kind === 'prompt'),
      models: all.filter(item => item.kind === 'model'),
      cards: all.filter(item => item.kind === 'card'),
      results: all.filter(item => item.kind === 'result'),
      suffixes: all.filter(item => item.kind === 'suffix'),
      history,
    }
  }
  function generatorFromJob(job, result, state) {
    if (job.cardSnapshot) {
      const node = Object.fromEntries(['type', 'title', ...definition.fields].filter(key => Object.hasOwn(job.cardSnapshot, key)).map(key => [key, structuredClone(job.cardSnapshot[key])]))
      node.type = 'generator'; node.title = job.cardSnapshot.title || result.title
      definition.validate(node, state.assets); return node
    }
    const entries = Array.isArray(job.input?.references) ? job.input.references.filter(ref => ref?.assetId && state.assets[ref.assetId]) : []
    const references = entries.map(ref => ({ id: randomUUID(), assetId: ref.assetId })), keys = new Map()
    entries.forEach((ref, index) => keys.set(ref.key || 'ref:' + index, 'direct:' + references[index].id))
    const provider = job.provider, model = job.model, modelKey = provider + ':' + model, bindingGroups = new Map()
    for (const [name, values] of Object.entries(job.input?.bindings || {})) {
      if (values && typeof values === 'object' && !Array.isArray(values)) bindingGroups.set(name, { ...values })
    }
    const legacyBindings = Object.fromEntries(Object.entries(job.input?.bindings || {}).filter(([, value]) => typeof value === 'string'))
    if (Object.keys(legacyBindings).length) bindingGroups.set(modelKey, { ...bindingGroups.get(modelKey), ...legacyBindings })
    const bindings = {}
    for (const [bindingModel, values] of bindingGroups) {
      const migrated = Object.fromEntries(Object.entries(values || {}).flatMap(([key, path]) => keys.has(key) ? [[keys.get(key), path]] : []))
      if (Object.keys(migrated).length) bindings[bindingModel] = migrated
    }
    const node = {
      type: 'generator', title: result.sourceTitle || result.title, provider, model,
      prompt: String(job.input?.prompt || ''), ratio: job.input?.ratio || '1:1', resolution: job.input?.resolution || '1k',
      references, referenceOrder: references.map(ref => 'direct:' + ref.id), referenceBindings: bindings,
      modelParameters: { [modelKey]: structuredClone(job.input?.parameters || {}) },
    }
    definition.validate(node, state.assets); return node
  }
  function resultJob(board, node) {
    return [...jobs.read()].sort((left, right) => right.createdAt - left.createdAt).find(job =>
      (!job.boardId || job.boardId === board.id) && job.nodeId === node.sourceNodeId &&
      (job.resultNodeId === node.id || job.resultAssetIds?.includes(node.assetId) || job.assetIds?.includes(node.assetId) || job.assetId === node.assetId))
  }
  function resultParameters(input) {
    if (!input || typeof input.boardId !== 'string' || typeof input.nodeId !== 'string') fail('参数卡请求无效')
    const state = documents.read(), board = state.boards.find(board => board.id === input.boardId)
    const result = board?.nodes.find(node => node.id === input.nodeId && ['image', 'video'].includes(node.type) && node.sourceNodeId && state.assets[node.assetId])
    if (!result) fail('生成结果不存在或素材不可用')
    const job = resultJob(board, result)
    const favorite = records.read().find(item => item.kind === 'result' && item.assetId === result.assetId)
    if (!job && !favorite) fail('找不到这张结果的生成参数')
    const sourceTitle = board.nodes.find(node => node.id === result.sourceNodeId)?.title || favorite?.sourceTitle || result.title
    const node = generatorFromJob(job || { cardSnapshot: favorite.node }, { title: result.title, sourceTitle }, state)
    return { node, sourceTitle }
  }
  return {
    read,
    resultParameters,
    async save(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) fail('收藏请求无效')
      if (input.action === 'rename') {
        const title = text(input.title, 120, '收藏名称')
        await records.change(tx => {
          const record = tx.records.find(item => item.id === input.id)
          if (!record) fail('收藏不存在')
          if (input.updatedAt !== record.updatedAt) throw Object.assign(Error('收藏已在其他页面修改，请重新打开'), { status: 409 })
          record.title = title
          record.updatedAt = Math.max(Date.now(), record.updatedAt + 1)
        })
        return read()
      }
      if (input.action === 'delete') {
        await records.change(tx => { const index = tx.records.findIndex(item => item.id === input.id); if (index < 0) fail('收藏不存在'); tx.records.splice(index, 1) })
        return read()
      }
      let item
      const title = () => text(input.title, 120, '收藏名称')
      if (input.kind === 'prompt') item = { kind: 'prompt', title: title(), prompt: text(input.prompt, 24000, '提示词') }
      else if (input.kind === 'suffix') item = { kind: 'suffix', title: title(), text: text(input.text, 24000, '固定尾缀') }
      else if (input.kind === 'model') {
        if (typeof input.provider !== 'string' || !/^[a-z][a-z0-9-]*$/.test(input.provider)) fail('模型服务无效')
        item = { kind: 'model', provider: input.provider, model: text(input.model, 200, '模型 ID'), title: title() }
      } else if (input.kind === 'card') {
        const state = documents.read(), board = state.boards.find(board => board.id === input.boardId), node = board?.nodes.find(node => node.id === input.nodeId && node.type === 'generator')
        if (!node || board.revision !== input.revision) throw Object.assign(Error('画布已变化，请重新收藏'), { status: 409 })
        const snapshot = snapshotGenerator(node, { board, types: documents.types, assets: state.assets })
        definition.validate(snapshot, state.assets)
        item = { kind: 'card', title: title(), node: Object.fromEntries(['type', 'title', ...definition.fields].filter(key => Object.hasOwn(snapshot, key)).map(key => [key, snapshot[key]])) }
      } else if (input.kind === 'result') {
        const state = documents.read(), board = state.boards.find(board => board.id === input.boardId), node = board?.nodes.find(node => node.id === input.nodeId && ['image', 'video'].includes(node.type) && node.sourceNodeId)
        if (!node || board.revision !== input.revision || !state.assets[node.assetId]) throw Object.assign(Error('生成结果已变化，请重新收藏'), { status: 409 })
        const job = resultJob(board, node)
        if (!job) fail('找不到这张结果的生成参数')
        const source = board.nodes.find(item => item.id === node.sourceNodeId)
        const resultTitle = input.title || node.title
        item = { kind: 'result', title: text(resultTitle, 120, '收藏名称'), assetId: node.assetId, outputKind: node.type, sourceTitle: source?.title || resultTitle, node: generatorFromJob(job, { title: resultTitle, sourceTitle: source?.title }, state), source: { boardId: board.id, nodeId: node.id, sourceNodeId: node.sourceNodeId, jobId: job.id } }
      } else fail('收藏类型无效')
      await records.change(tx => {
        const index = input.id ? tx.records.findIndex(record => record.id === input.id && record.kind === item.kind) : -1
        if (input.id && index < 0) fail('收藏不存在')
        if (index >= 0 && input.updatedAt !== tx.records[index].updatedAt) throw Object.assign(Error('收藏已在其他页面修改，请重新打开'), { status: 409 })
        if (index < 0 && tx.records.length >= 1000) fail('收藏库已满，请先移除一些收藏')
        const saved = { ...item, id: index >= 0 ? input.id : randomUUID(), createdAt: index >= 0 ? tx.records[index].createdAt : Date.now(), updatedAt: Math.max(Date.now(), (index >= 0 ? tx.records[index].updatedAt : 0) + 1) }
        if (index >= 0) tx.records[index] = saved
        else if (item.kind === 'model' && tx.records.some(record => record.kind === 'model' && record.provider === item.provider && record.model === item.model)) return
        else if (item.kind === 'result' && tx.records.some(record => record.kind === 'result' && record.assetId === item.assetId)) return
        else tx.records.unshift(saved)
        if (index >= 0 && item.kind === 'suffix') {
          // Update live cards in the same transaction; historical job/favorite snapshots stay frozen.
          for (const { id } of documents.read().boards) {
            const board = tx.board(id), operations = []
            for (const node of board.nodes) {
              if (node.type !== 'generator' || !node.promptSuffixes?.some(suffix => suffix.id === saved.id && (suffix.text !== saved.text || suffix.title !== saved.title))) continue
              const promptSuffixes = node.promptSuffixes.map(suffix => suffix.id === saved.id ? { ...suffix, title: saved.title, text: saved.text } : suffix)
              operations.push({ type: 'update', id: node.id, patch: { promptSuffixes } })
            }
            if (operations.length) tx.edit(id, operations)
          }
        }
      })
      return read()
    },
  }
}
