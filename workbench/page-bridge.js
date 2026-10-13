import { randomUUID } from 'node:crypto'
import { operationError, restoreError } from '../shared/errors.js'

/** @typedef {{name:string, [key:string]:unknown}} Tool */
/** @typedef {{appId:string, pageId:string, session:string, reloadToken?:string, tools:Tool[], seen:number}} Binding */
/** @typedef {{appId:string, clientId?:string, pageId?:string, session?:string, cancelled?:boolean, reloads?:number, awaitingRebind?:boolean, expectedReloadToken?:string, rebindStartedAt?:number, rebind?:object}} Task */
/**
 * Owns page identity, request lifetimes and reload rebinding. No file or tool access.
 * @param {{application:{mode:string, reloads:number, reloadToken?:string, settle:(options?:{delay:number})=>Promise<unknown>}, notify:(message:object)=>void, apps:{id:string}[], timeoutMs?:number, rebindTimeoutMs?:number}} options
 */
export function createPageBridge({ application, notify, apps, timeoutMs = 20000, rebindTimeoutMs = application.mode === 'development' ? 15000 : 3000 }) {
  /** @type {Map<string, Binding>} */
  const clients = new Map()
  /** @type {Map<string, {clientId?:string, pageId?:string, session?:string, resolve:(value:unknown)=>void, reject:(error:Error)=>void, timer:ReturnType<typeof setTimeout>}>} */
  const pending = new Map()
  /** @param {string | undefined} clientId */
  const bindingFor = clientId => {
    const client = clients.get(clientId || '')
    if (!client || Date.now() - client.seen > 10000) throw Error('业务页面未连接；请打开工作台中的应用，代码修复工具仍可使用')
    return client
  }
  /** @param {Task} task @param {string} name @param {object} args */
  async function pageCall(task, name, args = {}) {
    if (task.cancelled) throw Error('任务已停止')
    const current = bindingFor(task.clientId)
    if (task.appId !== current.appId || task.pageId !== current.pageId || task.session !== current.session) throw Error('应用或页面已经切换；请在当前应用新建会话或重新发送任务')
    const operationId = name === 'workspace_enable_plugin' && 'operationId' in args && typeof args.operationId === 'string' ? args.operationId : undefined
    return new Promise((resolve, reject) => {
      const id = randomUUID(), timer = setTimeout(() => { pending.delete(id); reject(operationError('PAGE_RESULT_UNKNOWN', '页面工具响应超时；结果可能已执行，请先读取状态再决定是否重试', { operationId })) }, timeoutMs)
      pending.set(id, { clientId: task.clientId, pageId: task.pageId, session: task.session, resolve, reject, timer })
      notify({ type: 'page-call', clientId: task.clientId, pageId: task.pageId, session: task.session, id, name, args })
    })
  }
  /** @param {Task} task */
  async function rebindPage(task) {
    if (application.mode === 'development') {
      await application.settle({ delay: 0 })
      if ((task.reloads ?? application.reloads) !== application.reloads) {
        task.awaitingRebind = true; task.expectedReloadToken = application.reloadToken; task.rebindStartedAt = undefined
      }
      task.reloads = application.reloads
    }
    if (task.awaitingRebind && task.clientId) {
      task.rebindStartedAt ??= Date.now()
      const startedAt = Date.now(), deadline = task.rebindStartedAt + rebindTimeoutMs
      while (!task.cancelled) {
        const page = clients.get(task.clientId)
        const fresh = page && Date.now() - page.seen <= 10000
        const acknowledged = fresh && (task.expectedReloadToken ? page.reloadToken === task.expectedReloadToken : page.pageId !== task.pageId)
        task.rebind = { waitedMs: Date.now() - startedAt, elapsedMs: Date.now() - task.rebindStartedAt,
          expectedReloadToken: task.expectedReloadToken, actualReloadToken: page?.reloadToken, pageId: page?.pageId,
          status: acknowledged ? 'ready' : 'waiting' }
        if (fresh && page.appId !== task.appId) break // Caller rejects a switched application.
        if (acknowledged) {
          task.session = page.session; task.pageId = page.pageId; task.awaitingRebind = false; task.rebindStartedAt = undefined
          break
        }
        const remaining = deadline - Date.now()
        if (remaining <= 0) throw operationError('PAGE_REBIND_PENDING', '页面尚未确认本次刷新；请检查页面连接和开发日志。再次查询不会重置等待时限。' + JSON.stringify(task.rebind))
        await new Promise(resolve => setTimeout(resolve, Math.min(50, remaining)))
      }
    }
    if (task.cancelled) throw Error('任务已停止')
    const live = clients.get(task.clientId || '')
    return live && Date.now() - live.seen <= 10000 ? live : null
  }
  return { clients, bindingFor, pageCall, rebindPage,
    /** @param {{clientId?:unknown, type?:string, id?:string, appId?:string, pageId?:string, session?:string, reloadToken?:string, tools?:Tool[], error?:string, errorDetail?:unknown, result?:unknown}} input */
    receive(input) {
      if (!input || typeof input.clientId !== 'string') throw Object.assign(Error('页面标识无效'), { status: 400 })
      if (input.type === 'result') {
        const entry = pending.get(input.id || '')
        if (entry && entry.clientId === input.clientId && entry.pageId === input.pageId && entry.session === input.session) {
          pending.delete(input.id || ''); clearTimeout(entry.timer); input.error ? entry.reject(restoreError(input.errorDetail || input.error)) : entry.resolve(input.result)
        }
      } else if (input.type === 'disconnect') clients.delete(input.clientId)
      else if (input.type === 'ready' && typeof input.appId === 'string' && apps.some(app => app.id === input.appId) && typeof input.pageId === 'string' && typeof input.session === 'string' && Array.isArray(input.tools))
        clients.set(input.clientId, { appId: input.appId, pageId: input.pageId, session: input.session,
          ...(typeof input.reloadToken === 'string' && input.reloadToken.length <= 100 ? { reloadToken: input.reloadToken } : {}), tools: input.tools.slice(0, 100), seen: Date.now() })
    },
    close() { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(Error('工作台已关闭')) }; pending.clear(); clients.clear() },
  }
}
