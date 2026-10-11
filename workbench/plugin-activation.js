import { Value } from '@sinclair/typebox/value'
import { developmentSchemas } from './development-tools.js'
import { pluginActivationResult } from '../shared/plugin-activation.js'

export async function enablePlugin(appId, args, { status, url, signal, page } = {}) {
  if (!Value.Check(developmentSchemas.workspace_enable_plugin, args)) throw Error('插件启用参数无效；请提供插件 id')
  signal?.throwIfAborted()
  const runtime = await status()
  if (!runtime.online || !runtime.managed || runtime.mode === 'external') throw Error('本应用的受管理实例未在线，不能启用插件')
  if (runtime.development?.pending || runtime.development?.blocked) throw Error('开发更新尚未完成；先用 workspace_status 检查保存或更新阻塞')
  const checkApplication = (state, session) => {
    if (state?.current?.id !== appId || state.phase !== 'idle' || !state.session || session && state.session !== session) throw Error('应用已切换或正在切换，未继续启用；请在当前应用重新发送任务')
  }
  checkApplication(runtime.state)
  async function read(session) {
    const response = await fetch(url + '/api/plugins', { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) })
    if (!response.ok) throw Error('读取插件状态失败：' + response.status)
    const snapshot = await response.json()
    checkApplication(snapshot.application, session)
    return snapshot
  }
  const snapshot = await read(runtime.state.session), session = snapshot.application.session
  const plugin = snapshot.plugins.find(plugin => plugin.id === args.id)
  if (!plugin) throw Error('插件尚未发现：' + args.id + '；请先检查 workspace_status 的热更新或正式构建')
  if (snapshot.pendingSwitch || snapshot.pendingConfig) throw Error('正在确认插件切换或配置，请完成后再启用')
  signal?.throwIfAborted()
  let operationError = null
  if (page) {
    try {
      const observed = await page({ id: args.id, session })
      signal?.throwIfAborted()
      if (observed.session !== session || observed.result.appId !== appId || observed.result.id !== args.id) throw Error('页面返回了过期的应用状态')
      // A switch can complete while the initiating page is sending its result.
      const latest = await read(session)
      if (latest.revision !== observed.revision) return pluginActivationResult(latest, args.id, {
        operationError: '插件状态在页面核对后发生变化；已读取最新后端状态，前端需重新核对。',
      })
      return observed.result
    } catch (error) { signal?.throwIfAborted(); operationError = error.message }
  } else {
    if (plugin.exclusiveGroup && (!plugin.enabled || plugin.state !== 'enabled')) throw Error('单选组插件需要连接本应用页面，才能保存编辑内容并确认前端切换')
    if (!plugin.enabled || plugin.state === 'failed') {
      try {
        const response = await fetch(url + '/api/plugins/' + args.id + '/toggle', { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-application-session': session }, body: JSON.stringify({ enabled: true }),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) })
        if (!response.ok) { const result = await response.json(); operationError = result.error || '启用请求失败：' + response.status }
      } catch (error) { signal?.throwIfAborted(); operationError = '启用请求结果待核对：' + error.message }
    }
  }
  // Backend failure can persist enabled=true even when POST returns 500. Never replay the write.
  return pluginActivationResult(await read(session), args.id, { operationError })
}
