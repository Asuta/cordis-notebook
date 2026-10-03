import { randomUUID } from 'node:crypto'

/** A timeout defers a reload; it never grants permission to discard a page's edits. */
export function createDevelopmentSaveGuard(ws, { timeout = 15000, emit = () => {} } = {}) {
  const pages = new Map()
  let active, blocked, closed = false
  const describe = clients => [...clients].flatMap(client => { const page = pages.get(client); return page ? [{ id: page.id, application: page.application }] : [] })
  const publishBlocked = () => {
    const event = { type: 'blocked', clients: describe(blocked.clients),
      message: '热更新等待页面保存；请唤醒提示的页面或在保存草稿后关闭它。恢复后会自动重试。' }
    emit(event); ws.send('cordis:blocked', event)
  }
  function clearBlocked() {
    if (!blocked) return
    blocked = null; emit({ type: 'unblocked' })
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
    recovered(client)
  }
  function reply(data, client) {
    if (active?.token === data?.token && active.clients.has(client)) {
      if (!data.success) { active.finish(Error('页面保存失败：' + (data.error || '未知错误'))); return }
      active.clients.delete(client)
      if (!active.clients.size) active.finish()
    } else if (blocked?.token === data?.token && data.success) recovered(client)
  }
  ws.on('cordis:ready', ready)
  ws.on('cordis:prepared', reply)
  return {
    async run(action, retry) {
      if (closed) throw Error('开发服务已关闭')
      if (active) throw Error('已有页面保存准备正在执行')
      clearBlocked()
      const token = randomUUID(), clients = new Set([...pages.keys()].filter(client => ws.clients.has(client)))
      try {
        if (clients.size) await new Promise((accept, reject) => {
          const finish = error => {
            clearTimeout(timer); active = null
            error ? reject(error) : accept()
          }
          const timer = setTimeout(() => {
            blocked = { token, clients: new Set(clients), retry }
            publishBlocked()
            finish(Object.assign(Error('页面尚未确认保存，热更新已暂缓'), { code: 'DEVELOPMENT_SAVE_PENDING' }))
          }, timeout)
          active = { token, clients, finish }
          ws.send('cordis:prepare', { token })
        })
        await action()
      } finally { ws.send('cordis:resume', { token }) }
    },
    close() {
      closed = true; clearBlocked()
      active?.finish(Error('开发服务已关闭'))
      ws.off('cordis:ready', ready); ws.off('cordis:prepared', reply)
      for (const [client, page] of pages) client.socket.off('close', page.close)
      pages.clear()
    },
  }
}
