/** Run inside the page's host synchronization queue, including recovery. */
export async function applyConfiguration({ plugin, config, host, request, synchronize, getSnapshot }) {
  let staged, problem
  const healthy = [...host.entries.keys()].filter(id => host.state(id) === 'enabled')
  if (plugin.enabled && plugin.client && host.state(plugin.id) !== 'enabled') throw new Error('插件前端尚未就绪，请恢复运行或停用后保存设置')
  try {
    staged = await request(`/api/plugins/${plugin.id}/config`, 'POST', { config, expectedRevision: plugin.configRevision })
    if (staged.preview) {
      await host.sync(staged.plugins.map(p => p.id === plugin.id ? staged.preview : p))
      const failed = healthy.filter(id => host.state(id) !== 'enabled')
      if (failed.length) throw new Error(failed.map(id => host.describe(staged.plugins.find(p => p.id === id)).error || `${id} 未恢复运行`).join('；'))
      await request('/api/plugins/config/confirm', 'POST', { token: staged.pendingConfig.token, success: true })
    }
  } catch (error) {
    problem = error
    if (staged?.pendingConfig) {
      // A lost confirmation response may mean it already committed. Read the
      // authoritative snapshot below instead of assuming rollback succeeded.
      try { await request('/api/plugins/config/confirm', 'POST', { token: staged.pendingConfig.token, success: false, error: error.message }) } catch {}
    }
  }
  try { await synchronize() } catch { throw new Error('无法确认配置结果，连接恢复后会自动同步，请稍后查看设置。') }
  const current = getSnapshot().plugins.find(p => p.id === plugin.id)
  const failed = healthy.filter(id => host.state(id) !== 'enabled')
  if (failed.length) throw new Error('配置处理后这些插件未恢复运行，请重载前端：' + failed.join('、'))
  if (current && JSON.stringify(current.config) === JSON.stringify(config) && !current.configError) return
  if (problem) throw new Error(`配置未保存：${problem.message}。已恢复原配置。`)
  throw new Error(current?.configError || '配置没有生效，请载入最新设置')
}
