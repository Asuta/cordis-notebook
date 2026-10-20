import { generationInput } from './definition.js'
import { snapshotGenerator } from './snapshot.js'
import { reserveResult, completeResults } from './results.js'
import { orderedProviders } from './providers.js'

const pending = job => ['queued', 'running'].includes(job?.status)
const unresolved = job => pending(job) || ['paused', 'uncertain'].includes(job?.status)
const fail = message => { throw Object.assign(Error(message), { status: 409 }) }
function interrupt(job, message, autoResume = false) {
  job.status = job.remote?.taskId ? 'paused' : job.remote?.phase === 'submitting' ? 'uncertain' : 'interrupted'
  job.error = job.status === 'paused' ? '已暂停查询，远端任务仍可能运行；恢复查询不会重新提交' : job.status === 'uncertain' ? '提交结果尚未确认，请在 WaveSpeed 任务记录中核对，勿直接重试' : message
  job.autoResume = autoResume && ['paused', 'uncertain'].includes(job.status); job.endedAt = Date.now()
}

export async function createJobs(documents) {
  const records = documents.records('image-generation'), providers = new Map(), prepared = new Map(), active = new Map()
  let closed = false, pumping = false, closing
  await records.change(tx => { for (const job of tx.records) { if (pending(job)) interrupt(job, '应用已退出，生成被中断；请手动重试', true); if (unresolved(job)) reserveResult(tx, job) } })
  const read = () => records.read()
  const sortedProviders = () => orderedProviders(providers.values())
  const listProviders = () => sortedProviders().map(p => ({ id: p.id, label: p.label, ...p.public(), defaultProvider: p.defaultProvider === true }))

  async function execute(job, controller, request) {
    const checkpoint = async value => {
      // Accept only public recovery metadata, even if a provider returns extra fields.
      if (!value || !['preparing', 'submitting', 'submitted'].includes(value.phase) || (value.taskId !== undefined && (typeof value.taskId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(value.taskId))) || (value.account !== undefined && !/^[a-f0-9]{64}$/.test(value.account))) throw Error('远端任务恢复信息无效')
      await records.change(tx => {
        const current = tx.records.find(j => j.id === job.id)
        if (!current || current.status === 'succeeded') return
        current.remote = { ...current.remote, phase: value.phase, ...(value.taskId ? { taskId: value.taskId } : {}), ...(value.account ? { account: value.account } : {}) }
        // A submission may finish after the user stopped polling. Keep its ID.
        if (!pending(current) && current.remote.taskId && current.status !== 'detached') interrupt(current, '查询已暂停', current.autoResume)
      })
    }
    try {
      await records.change(tx => { const current = tx.records.find(j => j.id === job.id); if (current?.status === 'queued') { current.status = 'running'; delete current.error; delete current.endedAt } })
      if (controller.signal.aborted || !pending(read().find(j => j.id === job.id))) return
      const buffers = request.resuming ? [] : await Promise.all(job.input.assetIds.map(id => documents.media ? documents.media(id) : documents.image(id)))
      const result = await request.generate(buffers, controller.signal, { checkpoint, remote: job.remote })
      if (controller.signal.aborted) return
      const outputs = Buffer.isBuffer(result) ? [{ bytes: result, kind: 'image' }] : result
      if (!Array.isArray(outputs) || !outputs.length || outputs.length > 100 || outputs.some(o => !Buffer.isBuffer(o.bytes) || !['image', 'video'].includes(o.kind))) throw Error('生成服务没有返回有效的图片或视频')
      const assetIds = []
      for (const [index, output] of outputs.entries()) {
        if (controller.signal.aborted) return
        const saved = read().find(j => j.id === job.id)?.resultAssetIds?.[index]
        const asset = saved && documents.read().assets[saved] || await (output.kind === 'video' ? documents.addVideo : documents.addImage)(output.bytes, output.name || '生成 · ' + (job.input.prompt.slice(0, 32) || job.model))
        assetIds.push(asset.id)
        await records.change(tx => { const current = tx.records.find(j => j.id === job.id); if (current) current.resultAssetIds = [...assetIds] })
      }
      await records.change(tx => {
        const current = tx.records.find(j => j.id === job.id), board = tx.board(job.boardId), source = board?.nodes.find(n => n.id === job.nodeId)
        if (!pending(current) || controller.signal.aborted) return
        if (!source) { current.status = 'interrupted'; current.error = '生成卡片已删除，结果保留在素材库'; current.endedAt = Date.now(); return }
        current.status = 'succeeded'; current.assetId = assetIds[0]; current.assetIds = assetIds; current.endedAt = Date.now(); current.autoResume = false
        completeResults(tx, current, outputs, assetIds)
      })
    } catch (error) {
      await records.change(tx => {
        const current = tx.records.find(j => j.id === job.id)
        if (!pending(current)) return
        if (controller.signal.aborted) interrupt(current, '生成已中断')
        else if (current.remote?.taskId && !error.terminal) { interrupt(current, '查询已暂停'); current.error += ' · ' + error.message }
        else if (current.remote?.phase === 'submitting' && !error.terminal) interrupt(current, '提交结果未确认')
        else { current.status = 'failed'; current.error = String(error.message).slice(0, 1200); current.endedAt = Date.now() }
      }).catch(() => {})
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
  async function cancel(id, message = '生成已中断，可手动重试', autoResume = false) {
    // Commit the paused state before aborting a provider; a late task ID can then be saved.
    await records.change(tx => { const job = tx.records.find(j => j.id === id); if (!job) fail('任务不存在'); if (pending(job)) interrupt(job, message, autoResume) })
    active.get(id)?.controller.abort(); prepared.delete(id)
  }
  async function resume(id) {
    if (closed) fail('生成服务已停止')
    const job = read().find(j => j.id === id)
    if (!job) fail('任务不存在')
    if (pending(job)) return job
    if (job.status !== 'paused' || !job.remote?.taskId) fail('此任务没有可恢复的远端 ID')
    if (active.has(id)) fail('正在结束上一次查询，请稍后恢复')
    const provider = providers.get(job.provider)
    if (!provider?.resume) fail('请启用并配置原生成服务后再恢复查询')
    const request = provider.resume(structuredClone(job))
    if (!request || typeof request.generate !== 'function') fail('服务没有提供任务恢复功能')
    await records.change(tx => { const current = tx.records.find(j => j.id === id); if (current.status !== 'paused') fail('任务状态已变化'); current.status = 'queued'; current.autoResume = false; delete current.error })
    prepared.set(id, { ...request, resuming: true }); void pump().catch(() => {}); return read().find(j => j.id === id)
  }
  async function recover(providerId) {
    for (const job of read()) if (job.provider === providerId && job.status === 'paused' && job.autoResume) {
      try { await resume(job.id) } catch (error) { await records.change(tx => { const current = tx.records.find(j => j.id === job.id); if (current?.status === 'paused') current.error = '等待恢复查询 · ' + error.message }) }
    }
  }
  const jobs = {
    read, listProviders, resume, recover,
    provider(id) { const provider = providers.get(id); if (!provider) fail('生成服务不可用'); return provider },
    register(owner, provider) {
      if (closed || !/^[a-z][a-z0-9-]*$/.test(provider.id) || providers.has(provider.id) || typeof provider.prepare !== 'function' || typeof provider.public !== 'function' || (provider.defaultProvider !== undefined && typeof provider.defaultProvider !== 'boolean')) throw Error('图片服务无效或重复')
      return owner.effect(() => {
        providers.set(provider.id, provider); void recover(provider.id).catch(() => {})
        return async () => {
          if (providers.get(provider.id) === provider) providers.delete(provider.id)
          const targets = read().filter(j => j.provider === provider.id && pending(j)), tasks = targets.map(j => active.get(j.id)?.task)
          await Promise.all(targets.map(j => cancel(j.id, '图片服务已停用或更新，生成被中断', true)))
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
        if (tx.records.some(j => j.boardId === input.boardId && j.nodeId === input.nodeId && j.status === 'uncertain')) fail('此卡片有提交结果未确认的任务，请先核对远端记录或结束跟踪')
        if (tx.records.filter(unresolved).length >= 20) fail('已有 20 个待完成任务')
        if (board.nodes.length >= 500) fail('画板卡片已满，请先腾出结果框的位置')
        const provider = node?.provider ? providers.get(node.provider) : sortedProviders()[0]
        if (!provider) fail('图片服务不可用，请启用对应插件')
        selectedProvider = provider
        const assets = documents.read().assets
        const snapshot = generationInput(board, input.nodeId, documents.types, assets, { allowEmptyPrompt: !!provider.public().modelCatalog, providerId: provider.id })
        const cardSnapshot = snapshotGenerator(node, { board, types: documents.types, assets })
        request = provider.prepare(structuredClone(snapshot))
        if (!request || typeof request.generate !== 'function' || typeof request.model !== 'string') fail('图片服务返回了无效请求')
        if (request.parameters) snapshot.parameters = structuredClone(request.parameters)
        if (request.bindings) snapshot.bindings = structuredClone(request.bindings)
        const job = { id: input.requestId, boardId: board.id, nodeId: input.nodeId, status: 'queued', createdAt: Date.now(), promptText: node.prompt, input: snapshot, cardSnapshot, model: request.model, provider: provider.id, outputKind: request.outputKind || 'image' }
        reserveResult(tx, job)
        tx.records.push(job); return job
      })
      if (request) {
        if (closed || providers.get(job.provider) !== selectedProvider || !pending(read().find(j => j.id === job.id))) { await cancel(job.id); return read().find(j => j.id === job.id) }
        prepared.set(job.id, request); void pump().catch(() => {})
      }
      return job
    },
    cancel,
    async detach(id) {
      await cancel(id)
      await records.change(tx => { const job = tx.records.find(j => j.id === id); if (['paused', 'uncertain'].includes(job.status)) { job.status = 'detached'; job.autoResume = false; job.error = '已结束本地跟踪，远端任务可能仍在运行' } })
    },
    async boardChanged(board) { for (const job of read()) if (job.boardId === board.id && unresolved(job) && (!board.nodes.some(n => n.id === job.nodeId) || job.resultNodeId && !board.nodes.some(n => n.id === job.resultNodeId))) { await cancel(job.id, '生成卡片或结果框已删除'); await records.change(tx => { const current = tx.records.find(j => j.id === job.id); if (current) current.autoResume = false }) } },
    close() {
      if (closing) return closing
      closed = true
      closing = (async () => {
        await records.change(tx => { for (const job of tx.records) if (pending(job)) interrupt(job, '应用或生成服务已退出，生成被中断', true) })
        for (const entry of active.values()) entry.controller.abort()
        await Promise.allSettled([...active.values()].map(e => e.task)); prepared.clear(); providers.clear()
      })()
      return closing
    },
  }
  return jobs
}
