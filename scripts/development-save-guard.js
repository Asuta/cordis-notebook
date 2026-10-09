import { randomUUID } from 'node:crypto'

/** A timeout defers a reload; it never grants permission to discard a page's edits. */
export function createDevelopmentSaveGuard(ws, { timeout = 15000, emit = () => {} } = {}) {
  const pages = new Map()
  let active, blocked, closed = false
  const describe = (clients, round = active || blocked) => [...clients].flatMap(client => {
    const page = pages.get(client), detail = round?.details.get(client)
    return page ? [{ id: page.id, application: page.application, visibility: page.visibility,
      phase: detail?.phase || 'unresponsive', since: detail?.since || round?.startedAt,
      elapsedMs: round ? Date.now() - round.startedAt : 0, ...(detail?.error ? { error: detail.error } : {}) }] : []
  })
  const publishProgress = () => { if (active) emit({ type: 'save-progress', token: active.token, startedAt: active.startedAt, clients: describe(active.details.keys(), active) }) }
  const publishBlocked = () => {
    const event = { type: 'blocked', token: blocked.token, startedAt: blocked.startedAt, clients: describe(blocked.clients, blocked),
      message: '热更新等待页面保存；请唤醒提示的页面或在保存草稿后关闭它。恢复后会自动重试。' }
    emit(event); ws.send('cordis:blocked', event)
  }
  function clearBlocked() {
    if (!blocked) return
    blocked = null; emit({ type: 'unblocked', message: '页面等待已解除，准备重新校验与尝试更新；尚不代表更新完成。' })
  }
  function recovered(client) {
    if (!blocked?.clients.delete(client)) return
    if (blocked.clients.size) { publishBlocked(); return }
    const retry = blocked.retry
    clearBlocked()
    if (!closed) retry()
  }
  function disconnected(client) {
    pages.delete(client)
    if (active?.clients.delete(client) && !active.clients.size) active.finish()
    recovered(client)
  }
  function ready(data, client) {
    if (!pages.has(client)) {
      const close = () => disconnected(client)
      pages.set(client, { id: randomUUID(), application: String(data?.application || '开发页面').slice(0, 100), close })
      client.socket.once('close', close)
    }
    const page = pages.get(client)
    if (['visible', 'hidden'].includes(data?.visibility)) page.visibility = data.visibility
    recovered(client)
  }
  function progress(data, client) {
    const round = active?.token === data?.token ? active : blocked?.token === data?.token ? blocked : null
    if (!round?.clients.has(client) || !['queued', 'saving'].includes(data.phase)) return
    const detail = round.details.get(client)
    if (detail.phase === 'saving' && data.phase === 'queued' || detail.phase === 'failed') return
    if (detail.phase !== data.phase) Object.assign(detail, { phase: data.phase, since: Date.now() })
    if (round === active) publishProgress(); else publishBlocked()
  }
  function reply(data, client) {
    if (active?.token === data?.token && active.clients.has(client)) {
      Object.assign(active.details.get(client), { phase: data.success ? 'confirmed' : 'failed', since: Date.now(), error: data.success ? undefined : String(data.error || '未知错误').slice(0, 500) })
      publishProgress()
      if (!data.success) { active.finish(Error('页面保存失败：' + (data.error || '未知错误'))); return }
      active.clients.delete(client)
      if (!active.clients.size) active.finish()
    } else if (blocked?.token === data?.token && blocked.clients.has(client)) {
      if (data.success) recovered(client)
      else { Object.assign(blocked.details.get(client), { phase: 'failed', since: Date.now(), error: String(data.error || '未知错误').slice(0, 500) }); publishBlocked() }
    }
  }
  ws.on('cordis:ready', ready)
  ws.on('cordis:prepared', reply)
  ws.on('cordis:save-progress', progress)
  return {
    unchanged() { if (active) throw Error('已有页面保存准备正在执行'); clearBlocked() },
    async run(action, retry) {
      if (closed) throw Error('开发服务已关闭')
      if (active) throw Error('已有页面保存准备正在执行')
      clearBlocked()
      const token = randomUUID(), clients = new Set([...pages.keys()].filter(client => ws.clients.has(client))), startedAt = Date.now()
      const details = new Map([...clients].map(client => [client, { phase: 'unresponsive', since: startedAt }]))
      try {
        if (clients.size) await new Promise((accept, reject) => {
          const finish = error => {
            clearTimeout(timer); active = null
            error ? reject(error) : accept()
          }
          const timer = setTimeout(() => {
            blocked = { token, clients: new Set(clients), retry, startedAt, details }
            publishBlocked()
            finish(Object.assign(Error('页面尚未确认保存，热更新已暂缓'), { code: 'DEVELOPMENT_SAVE_PENDING' }))
          }, timeout)
          active = { token, clients, finish, startedAt, details }
          publishProgress()
          ws.send('cordis:prepare', { token })
        })
        await action()
        emit({ type: 'save-result', token, status: 'completed', startedAt, elapsedMs: Date.now() - startedAt })
      } catch (error) {
        if (error.code !== 'DEVELOPMENT_SAVE_PENDING') emit({ type: 'save-result', token, status: 'failed', message: error.message, startedAt, clients: describe(details.keys(), { details, startedAt }) })
        throw error
      } finally { ws.send('cordis:resume', { token }) }
    },
    close() {
      closed = true; clearBlocked()
      active?.finish(Error('开发服务已关闭'))
      ws.off('cordis:ready', ready); ws.off('cordis:prepared', reply)
      ws.off('cordis:save-progress', progress)
      for (const [client, page] of pages) client.socket.off('close', page.close)
      pages.clear()
    },
  }
}
