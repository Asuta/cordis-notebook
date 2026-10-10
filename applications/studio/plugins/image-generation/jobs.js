import { randomUUID } from 'node:crypto'
import { generationInput } from './definition.js'

const pending = job => ['queued', 'running'].includes(job?.status)
const fail = message => { throw Object.assign(Error(message), { status: 409 }) }

export async function createJobs(documents) {
  const records = documents.records('image-generation'), providers = new Map(), prepared = new Map(), active = new Map()
  let closed = false, pumping = false, closing
  await records.change(tx => { for (const job of tx.records) if (pending(job)) { job.status = 'interrupted'; job.error = '应用已退出，生成被中断；请手动重试'; job.endedAt = Date.now() } })
  const read = () => records.read()
  const listProviders = () => [...providers.values()].map(p => ({ id: p.id, label: p.label, ...p.public() }))

  async function execute(job, controller, request) {
    try {
      await records.change(tx => { const current = tx.records.find(j => j.id === job.id); if (current?.status === 'queued') current.status = 'running' })
      if (controller.signal.aborted || !pending(read().find(j => j.id === job.id))) return
      const images = await Promise.all(job.input.assetIds.map(id => documents.image(id)))
      const bytes = await request.generate(images, controller.signal)
      if (controller.signal.aborted) return
      const asset = await documents.addImage(bytes, '生成 · ' + job.input.prompt.slice(0, 32))
      await records.change(tx => {
        const current = tx.records.find(j => j.id === job.id), board = tx.board(job.boardId), source = board?.nodes.find(n => n.id === job.nodeId)
        if (!pending(current) || controller.signal.aborted) return
        if (!source) { current.status = 'interrupted'; current.error = '生成卡片已删除'; current.endedAt = Date.now(); return }
        current.status = 'succeeded'; current.assetId = asset.id; current.endedAt = Date.now()
        if (board.nodes.length >= 500) { current.error = '画板卡片已满，图片保留在素材库'; return }
        const count = board.nodes.filter(n => n.sourceNodeId === source.id).length
        // Task completion and board insertion share the document's atomic commit.
        tx.edit(board.id, [{ type: 'add', node: { id: randomUUID(), type: 'image', assetId: asset.id, title: `生成结果 ${count + 1}`, x: Math.min(99000, source.x + 360), y: Math.min(99000, source.y + count * 280), sourceNodeId: source.id, jobId: job.id } }])
      })
    } catch (error) {
      await records.change(tx => { const current = tx.records.find(j => j.id === job.id); if (pending(current)) { current.status = controller.signal.aborted ? 'interrupted' : 'failed'; current.error = error.message; current.endedAt = Date.now() } }).catch(() => {})
    } finally { prepared.delete(job.id) }
  }
  async function pump() {
    if (closed || pumping) return
    pumping = true
    try {
      while (!closed && active.size < 2) {
        const job = read().find(j => j.status === 'queued' && prepared.has(j.id) && !active.has(j.id))
        if (!job) break
        const controller = new AbortController(), entry = { controller, task: null }
        active.set(job.id, entry)
        entry.task = execute(job, controller, prepared.get(job.id)).finally(() => { active.delete(job.id); void pump().catch(() => {}) })
      }
    } finally { pumping = false }
  }
  async function cancel(id, message = '生成已中断，可手动重试') {
    active.get(id)?.controller.abort()
    await records.change(tx => {
      const job = tx.records.find(j => j.id === id)
      if (!job) fail('任务不存在')
      if (pending(job)) { job.status = 'interrupted'; job.error = message; job.endedAt = Date.now() }
    })
    prepared.delete(id)
  }
  const jobs = {
    read, listProviders,
    register(owner, provider) {
      if (closed || !/^[a-z][a-z0-9-]*$/.test(provider.id) || providers.has(provider.id) || typeof provider.prepare !== 'function' || typeof provider.public !== 'function') throw Error('图片服务无效或重复')
      return owner.effect(() => {
        providers.set(provider.id, provider)
        return async () => {
          if (providers.get(provider.id) === provider) providers.delete(provider.id)
          const targets = read().filter(j => j.provider === provider.id && pending(j))
          const tasks = targets.map(j => active.get(j.id)?.task)
          await Promise.all(targets.map(j => cancel(j.id, '图片服务已停用或更新，生成被中断')))
          await Promise.allSettled(tasks)
        }
      })
    },
    async start(input) {
      if (closed) fail('生成服务已停止')
      if (!/^[a-f0-9-]{36}$/.test(input.requestId)) fail('生成请求 ID 无效')
      let request, selectedProvider
      const job = await records.change(tx => {
        const existing = tx.records.find(j => j.id === input.requestId)
        if (existing) { if (existing.boardId !== input.boardId || existing.nodeId !== input.nodeId) fail('生成请求 ID 已被使用'); return existing }
        if (closed) fail('生成服务已停止')
        const board = tx.board(input.boardId), node = board?.nodes.find(n => n.id === input.nodeId)
        if (!board || board.revision !== input.revision) fail('画布已变化，请重新读取后生成')
        if (tx.records.some(j => j.boardId === input.boardId && j.nodeId === input.nodeId && pending(j))) fail('此卡片已有生成任务')
        if (tx.records.filter(pending).length >= 20) fail('已有 20 个待完成任务')
        const provider = node?.provider ? providers.get(node.provider) : providers.values().next().value
        if (!provider) fail('图片服务不可用，请启用对应插件')
        selectedProvider = provider
        const snapshot = generationInput(board, input.nodeId, documents.types)
        request = provider.prepare(structuredClone(snapshot))
        if (!request || typeof request.generate !== 'function' || typeof request.model !== 'string') fail('图片服务返回了无效请求')
        const job = { id: input.requestId, boardId: board.id, nodeId: input.nodeId, status: 'queued', createdAt: Date.now(), input: snapshot, model: request.model, provider: provider.id }
        tx.records.push(job); return job
      })
      if (request) {
        if (closed || providers.get(job.provider) !== selectedProvider || !pending(read().find(j => j.id === job.id))) { await cancel(job.id); return read().find(j => j.id === job.id) }
        prepared.set(job.id, request); void pump().catch(() => {})
      }
      return job
    },
    cancel,
    async boardChanged(board) { for (const job of read()) if (job.boardId === board.id && pending(job) && !board.nodes.some(n => n.id === job.nodeId)) await cancel(job.id, '生成卡片已删除') },
    close() {
      if (closing) return closing
      closed = true
      closing = (async () => {
        for (const entry of active.values()) entry.controller.abort()
        await records.change(tx => { for (const job of tx.records) if (pending(job)) { job.status = 'interrupted'; job.error = '应用或生成服务已退出，生成被中断'; job.endedAt = Date.now() } })
        await Promise.allSettled([...active.values()].map(e => e.task)); prepared.clear(); providers.clear()
      })()
      return closing
    },
  }
  return jobs
}
