import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { accountId } from './config.js'
import { normalizeModels, modelSummary } from './schema.js'

export async function createCatalog(directory, config, transport, writeSnapshot) {
  const file = join(directory, 'models-cache.json')
  let account, updatedAt = 0, models = new Map(), loading
  try { const cache = JSON.parse(await readFile(file, 'utf8')); account = cache.account; updatedAt = cache.updatedAt; models = normalizeModels(cache.rows) } catch { /* A directory cache is replaceable, unlike user documents. */ }
  const current = () => account === accountId(config.private())
  async function load(force = false) {
    const snapshot = config.private(), fingerprint = accountId(snapshot)
    if (!snapshot.apiKey) throw Error('请先在 WaveSpeed 设置中填写 API Key，再加载模型目录')
    if (!force && current() && models.size && Date.now() - updatedAt < 15 * 60000) return
    if (loading?.account === fingerprint) return loading.task
    const task = (async () => {
      const rows = await transport.api(snapshot, 'GET', '/api/v3/models')
      const next = normalizeModels(rows)
      if (fingerprint !== accountId(config.private())) throw Error('WaveSpeed 配置已变化，请重新加载模型目录')
      account = fingerprint; models = next; updatedAt = Date.now()
      await writeSnapshot(file, JSON.stringify({ account, updatedAt, rows }))
    })()
    loading = { account: fingerprint, task }
    try { await task } finally { if (loading?.task === task) loading = undefined }
  }
  return {
    load,
    get(id) {
      if (!current()) throw Error('请先打开 WaveSpeed 模型目录并选择模型')
      const model = models.get(id)
      if (!model) throw Object.assign(Error('模型不在当前图片、视频目录中，请刷新后重新选择'), { status: 404 })
      return structuredClone(model)
    },
    async detail(id) { await load(); return this.get(id) },
    async list({ query = '', kind = '', type = '', offset = 0, limit = 50, refresh = false, ids } = {}) {
      await load(refresh)
      const normalize = value => String(value).normalize('NFKC').toLowerCase().replace(/v(?=\d)/g, '').replace(/[^\p{L}\p{N}]/gu, '')
      const needle = String(query).trim().slice(0, 200), terms = needle.split(/\s+/u).filter(Boolean).map(normalize).filter(Boolean), compact = normalize(needle)
      const all = [...models.values()], filtered = all.filter(model => (!kind || model.outputKind === kind) && (!type || model.type === type) && (!ids || ids.includes(model.id)) && terms.every(term => normalize(`${model.id} ${model.label} ${model.description}`).includes(term)))
      if (compact) filtered.sort((a, b) => Number(normalize(`${b.id} ${b.label}`).includes(compact)) - Number(normalize(`${a.id} ${a.label}`).includes(compact)))
      const skip = Math.max(0, Number(offset) || 0), take = Math.min(100, Math.max(1, Number(limit) || 50))
      return { items: filtered.slice(skip, skip + take).map(modelSummary), total: filtered.length, catalogTotal: all.length, types: [...new Set(all.filter(model => !kind || model.outputKind === kind).map(model => model.type))].sort(), updatedAt, offset: skip, limit: take }
    },
  }
}
