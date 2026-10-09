import { randomUUID } from 'node:crypto'
import { generationInput, invalid } from './model.js'

export function createJobs(store, config, pixel) {
  const active = new Map(), credentials = new Map(); let closed = false, pumping = false, closing
  const pending = status => ['queued', 'running'].includes(status)
  async function pump() {
    if (pumping || closed) return
    pumping = true
    try {
      while (!closed && active.size < 2) {
        const job = store.read().jobs.find(j => j.status === 'queued' && credentials.has(j.id) && !active.has(j.id))
        if (!job) break
        const controller = new AbortController(), entry = { controller, task: null }; active.set(job.id, entry)
        entry.task = execute(job, controller).finally(() => { active.delete(job.id); void pump().catch(() => {}) })
      }
    } finally { pumping = false }
  }
  async function execute(job, controller) {
    try {
      await store.change(state => { const j = state.jobs.find(j => j.id === job.id); if (j.status === 'queued') j.status = 'running' })
      if (controller.signal.aborted || !pending(store.read().jobs.find(j => j.id === job.id).status)) return
      const images = await Promise.all(job.input.assetIds.map(id => store.image(id)))
      const bytes = await pixel.generate(job.input, credentials.get(job.id), images, controller.signal)
      if (controller.signal.aborted) return
      const asset = await store.addImage(bytes, '生成 · ' + job.input.prompt.slice(0, 32))
      await store.change(state => {
        const j = state.jobs.find(j => j.id === job.id), board = state.boards.find(b => b.id === job.boardId), source = board?.nodes.find(n => n.id === job.nodeId)
        if (!pending(j.status) || controller.signal.aborted) return
        if (!source) { j.status = 'interrupted'; j.error = '生成卡片已删除'; return }
        j.status = 'succeeded'; j.assetId = asset.id; j.endedAt = Date.now()
        const count = board.nodes.filter(n => n.sourceNodeId === source.id).length
        if (board.nodes.length >= 500) { j.error = '画板卡片已满，图片保留在素材库'; return }
        board.nodes.push({ id: randomUUID(), type: 'image', assetId: asset.id, title: `生成结果 ${count + 1}`, x: Math.min(99000, source.x + 360), y: Math.min(99000, source.y + count * 280), sourceNodeId: source.id, jobId: j.id })
        board.revision++
      })
    } catch (error) {
      await store.change(state => {
        const j = state.jobs.find(j => j.id === job.id)
        if (pending(j.status)) { j.status = controller.signal.aborted ? 'interrupted' : 'failed'; j.error = error.message; j.endedAt = Date.now() }
      }).catch(() => {})
    } finally { credentials.delete(job.id) }
  }
  async function start(input) {
    if (closed) throw Error('应用已停止')
    if (!/^[a-f0-9-]{36}$/.test(input.requestId)) invalid('生成请求 ID 无效')
    const existing = store.read().jobs.find(j => j.id === input.requestId)
    if (existing) {
      if (existing.boardId !== input.boardId || existing.nodeId !== input.nodeId) invalid('生成请求 ID 已被使用')
      return existing
    }
    const key = config.private()
    if (!key.apiKey) invalid('请先配置图片服务 API Key')
    const job = await store.change(state => {
      const existing = state.jobs.find(j => j.id === input.requestId)
      if (existing) {
        if (existing.boardId !== input.boardId || existing.nodeId !== input.nodeId) invalid('生成请求 ID 已被使用')
        return existing
      }
      const board = state.boards.find(b => b.id === input.boardId)
      if (!board || board.revision !== input.revision) throw Object.assign(Error('画布已变化，请重新读取后生成'), { status: 409 })
      if (state.jobs.some(j => j.nodeId === input.nodeId && j.boardId === input.boardId && pending(j.status))) invalid('此卡片已有生成任务')
      if (state.jobs.filter(j => pending(j.status)).length >= 20) invalid('已有 20 个待完成任务')
      const job = { id: input.requestId, boardId: board.id, nodeId: input.nodeId, status: 'queued', createdAt: Date.now(), input: generationInput(board, input.nodeId), model: key.model }
      state.jobs.push(job); return structuredClone(job)
    })
    credentials.set(job.id, key); void pump().catch(() => {})
    return job
  }
  async function cancel(id) {
    active.get(id)?.controller.abort()
    await store.change(state => {
      const job = state.jobs.find(j => j.id === id)
      if (!job) invalid('任务不存在')
      if (pending(job.status)) { job.status = 'interrupted'; job.error = '生成已中断，可手动重试'; job.endedAt = Date.now() }
    })
    credentials.delete(id)
  }
  return { start, cancel, close() {
    if (closing) return closing
    closing = (async () => {
      closed = true
      for (const entry of active.values()) entry.controller.abort()
      await store.change(state => { for (const job of state.jobs) if (pending(job.status)) { job.status = 'interrupted'; job.error = '应用已退出，生成被中断'; job.endedAt = Date.now() } })
      await Promise.allSettled([...active.values()].map(entry => entry.task)); credentials.clear(); await store.flush(); await pixel.close()
    })()
    return closing
  } }
}
