import { randomUUID } from 'node:crypto'

/** @typedef {{name:string, [key:string]:unknown}} Tool */
/** @typedef {{appId:string, pageId:string, session:string, tools:Tool[], seen:number}} Binding */
/** @typedef {{appId:string, clientId?:string, pageId?:string, session?:string, cancelled?:boolean, reloads?:number, awaitingRebind?:boolean}} Task */
/**
 * Owns page identity, request lifetimes and reload rebinding. No file or tool access.
 * @param {{application:{mode:string, reloads:number, settle:(options?:{delay:number})=>Promise<unknown>}, notify:(message:object)=>void, apps:{id:string}[], timeoutMs?:number}} options
 */
export function createPageBridge({ application, notify, apps, timeoutMs = 20000 }) {
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
    return new Promise((resolve, reject) => {
      const id = randomUUID(), timer = setTimeout(() => { pending.delete(id); reject(Error('页面工具响应超时；结果可能已执行，请先读取状态再决定是否重试')) }, timeoutMs)
      pending.set(id, { clientId: task.clientId, pageId: task.pageId, session: task.session, resolve, reject, timer })
      notify({ type: 'page-call', clientId: task.clientId, pageId: task.pageId, session: task.session, id, name, args })
    })
  }
  /** @param {Task} task */
  async function rebindPage(task) {
    if (application.mode === 'development') {
      await application.settle({ delay: 0 })
      if ((task.reloads ?? application.reloads) !== application.reloads) task.awaitingRebind = true
      task.reloads = application.reloads
    }
    if (task.awaitingRebind && task.clientId) {
      for (let i = 0; i < (application.mode === 'development' ? 150 : 30) && !task.cancelled; i++) {
        const page = clients.get(task.clientId)
        if (page && (page.appId !== task.appId || page.pageId !== task.pageId)) break
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
    const live = clients.get(task.clientId || '')
    if (task.awaitingRebind && live?.appId === task.appId && live.pageId !== task.pageId) { task.session = live.session; task.pageId = live.pageId; task.awaitingRebind = false }
    return live && Date.now() - live.seen <= 10000 ? live : null
  }
  return { clients, bindingFor, pageCall, rebindPage,
    /** @param {{clientId?:unknown, type?:string, id?:string, appId?:string, pageId?:string, session?:string, tools?:Tool[], error?:string, result?:unknown}} input */
    receive(input) {
      if (!input || typeof input.clientId !== 'string') throw Object.assign(Error('页面标识无效'), { status: 400 })
      if (input.type === 'result') {
        const entry = pending.get(input.id || '')
        if (entry && entry.clientId === input.clientId && entry.pageId === input.pageId && entry.session === input.session) {
          pending.delete(input.id || ''); clearTimeout(entry.timer); input.error ? entry.reject(Error(input.error)) : entry.resolve(input.result)
        }
      } else if (input.type === 'disconnect') clients.delete(input.clientId)
      else if (input.type === 'ready' && typeof input.appId === 'string' && apps.some(app => app.id === input.appId) && typeof input.pageId === 'string' && typeof input.session === 'string' && Array.isArray(input.tools))
        clients.set(input.clientId, { appId: input.appId, pageId: input.pageId, session: input.session, tools: input.tools.slice(0, 100), seen: Date.now() })
    },
    close() { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(Error('工作台已关闭')) }; pending.clear(); clients.clear() },
  }
}
