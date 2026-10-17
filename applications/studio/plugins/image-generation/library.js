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
    return { prompts: all.filter(item => item.kind === 'prompt'), models: all.filter(item => item.kind === 'model'), cards: all.filter(item => item.kind === 'card'), history }
  }
  return {
    read,
    async save(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) fail('收藏请求无效')
      if (input.action === 'delete') {
        await records.change(tx => { const index = tx.records.findIndex(item => item.id === input.id); if (index < 0) fail('收藏不存在'); tx.records.splice(index, 1) })
        return read()
      }
      let item
      const title = () => text(input.title, 120, '收藏名称')
      if (input.kind === 'prompt') item = { kind: 'prompt', title: title(), prompt: text(input.prompt, 24000, '提示词') }
      else if (input.kind === 'model') {
        if (typeof input.provider !== 'string' || !/^[a-z][a-z0-9-]*$/.test(input.provider)) fail('模型服务无效')
        item = { kind: 'model', provider: input.provider, model: text(input.model, 200, '模型 ID'), title: title() }
      } else if (input.kind === 'card') {
        const state = documents.read(), board = state.boards.find(board => board.id === input.boardId), node = board?.nodes.find(node => node.id === input.nodeId && node.type === 'generator')
        if (!node || board.revision !== input.revision) throw Object.assign(Error('画布已变化，请重新收藏'), { status: 409 })
        const snapshot = snapshotGenerator(node, { board, types: documents.types, assets: state.assets })
        definition.validate(snapshot, state.assets)
        item = { kind: 'card', title: title(), node: Object.fromEntries(['type', 'title', ...definition.fields].filter(key => Object.hasOwn(snapshot, key)).map(key => [key, snapshot[key]])) }
      } else fail('收藏类型无效')
      await records.change(tx => {
        const index = input.id ? tx.records.findIndex(record => record.id === input.id && record.kind === item.kind) : -1
        if (input.id && index < 0) fail('收藏不存在')
        if (index >= 0 && input.updatedAt !== tx.records[index].updatedAt) throw Object.assign(Error('收藏已在其他页面修改，请重新打开'), { status: 409 })
        if (index < 0 && tx.records.length >= 1000) fail('收藏库已满，请先移除一些收藏')
        const saved = { ...item, id: index >= 0 ? input.id : randomUUID(), createdAt: index >= 0 ? tx.records[index].createdAt : Date.now(), updatedAt: Math.max(Date.now(), (index >= 0 ? tx.records[index].updatedAt : 0) + 1) }
        if (index >= 0) tx.records[index] = saved
        else if (item.kind === 'model' && tx.records.some(record => record.kind === 'model' && record.provider === item.provider && record.model === item.model)) return
        else tx.records.unshift(saved)
      })
      return read()
    },
  }
}
