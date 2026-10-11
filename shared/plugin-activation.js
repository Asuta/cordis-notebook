import { serviceRelations } from './plugin-relations.js'

/** A runtime observation, not a functional/browser acceptance result. */
export function pluginActivationResult(snapshot, id, { clientVerified = false, operationError = null } = {}) {
  const plugin = snapshot.plugins.find(plugin => plugin.id === id)
  if (!plugin) throw Error('插件不存在：' + id)
  const running = plugin.state !== 'enabled' || !plugin.enabled ? false : plugin.client && !clientVerified ? null : true
  return {
    appId: snapshot.application.current.id, id, enabled: plugin.enabled, running, state: plugin.state,
    serverState: plugin.serverState, clientState: plugin.client ? clientVerified ? plugin.clientState : null : 'not-applicable',
    error: plugin.error || null, operationError, waitingFor: plugin.waitingFor || [],
    dependencies: serviceRelations(plugin, snapshot.plugins),
    verification: { server: true, client: !!plugin.client && clientVerified,
      note: plugin.client && !clientVerified ? '前端状态未验证；连接本应用页面后再调用此工具。' : '已读取运行状态；功能验收仍需测试和本轮浏览器验收。' },
  }
}
