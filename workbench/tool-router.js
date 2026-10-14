import { resolve } from 'node:path'
import { developmentInfo, developmentRuntimeInfo, scaffoldPlugin } from './development-tools.js'
import { enablePlugin, operationStatus } from './plugin-activation.js'

const selectionTool = { name: 'replace_selection', description: '仅替换用户添加的选区并保留撤销。默认传 text；若附件 formats 包含 richtext，可传 format:"richtext" 和 content，结构见附件 richText/replacementHint。不要同时传 text 和 content。选区变化或跨页面时拒绝。', inputSchema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, format: { type: 'string', enum: ['text', 'richtext'] }, text: { type: 'string' }, content: { type: 'object', description: '由选区所属插件定义的结构化替换片段；仅对声明支持的选区使用。' } }, required: ['id'], oneOf: [{ required: ['text'], properties: { format: { const: 'text' } }, not: { required: ['content'] } }, { required: ['format', 'content'], properties: { format: { const: 'richtext' } }, not: { required: ['text'] } }] } }

// Dependencies are supplied by the host; routing owns no processes or HTTP state.
export function createToolExecutor({ root, dataDir, application, commands, ownerFor, browserFactory, changed, notify, bridge }) {
  const { bindingFor, pageCall, rebindPage } = bridge
  return async function execute(task, name, args) {
    if (task.cancelled) throw Error('任务已停止')
    if (name === 'workspace_operation_status') return operationStatus(task.appId, args, { status: () => application.status(), url: 'http://127.0.0.1:' + application.port, signal: task.controller?.signal })
    if (name.startsWith('browser_')) {
      if (!task.turn?.browserVerificationEnabled) throw Error('用户关闭了本轮浏览器验收，不能调用或绕过开关')
      if (!['browser_open', 'browser_plugin', 'browser_action', 'browser_batch', 'browser_scenario', 'browser_retest', 'browser_finish', 'browser_report'].includes(name)) throw Error('未知浏览器工具')
      if (!task.browser && name !== 'browser_open' && name !== 'browser_report') throw Error('请先 browser_open')
      task.browser ||= browserFactory({ root, appId: task.appId, dataDir, signal: task.controller?.signal,
        onChange(report) { task.turn.browserVerification = report; changed(task.thread) },
      })
      return task.browser.run(name, args)
    }
    if (name === 'workspace_development_info') {
      const info = await developmentInfo(root, task.appId, args)
      const status = await application.status()
      return { ...info, runtime: developmentRuntimeInfo({ appId: task.appId, status, url: 'http://127.0.0.1:' + application.port,
        dataDir: resolve(root, application.env.DATA_DIR || application.dataDir) }) }
    }
    if (name === 'workspace_scaffold_plugin') return scaffoldPlugin(root, task.appId, args, { signal: task.controller?.signal })
    if (name === 'workspace_enable_plugin') {
      await application.settle()
      const live = await rebindPage(task)
      if (live && (live.appId !== task.appId || live.pageId !== task.pageId || live.session !== task.session)) throw Error('应用或页面已经切换；请在当前应用重新发送任务')
      const result = await enablePlugin(task.appId, args, { status: () => application.status(), url: 'http://127.0.0.1:' + application.port, signal: task.controller?.signal,
        page: live ? input => {
          if (task.session !== input.session) throw Error('绑定页面不是最新应用会话；请等待页面重新连接')
          return pageCall(task, 'workspace_enable_plugin', input)
        } : null })
      return { ...result, ...(task.rebind ? { rebind: task.rebind } : {}) }
    }
    if (name === 'exec_command') return commands.start(ownerFor(task), args)
    if (name === 'write_stdin') return commands.read(ownerFor(task), args)
    if (name === 'terminate_command') return commands.terminate(ownerFor(task), args.session_id)
    if (name === 'list_commands') return { commands: commands.list(ownerFor(task)) }
    if (name === 'workspace_status') {
      // Give Vite time to notice the last file edit before reporting its result.
      await application.settle()
      const status = await application.status()
      if (status.development) status.development.events = status.development.events.filter(event => event.seq > (task.devSequence ?? 0))
      return { ...status, appId: task.appId, root, ...(task.rebind ? { rebind: task.rebind } : {}) }
    }
    if (name === 'workspace_build') return application.build(task.appId, ownerFor(task), args)
    if (name === 'workspace_test') return application.test(task.appId, ownerFor(task), args)
    if (name === 'workspace_restart') {
      const status = await application.status()
      if (status.online) {
        if (status.state.current?.id !== task.appId) throw Error('当前正在运行另一应用，不能替它重启')
        await pageCall(task, 'workspace_prepare_reload')
      }
      try { await application.restart() }
      catch (error) { await pageCall(task, 'workspace_release_reload').catch(() => {}); throw error }
      task.awaitingRebind = true
      task.expectedReloadToken = undefined; task.rebindStartedAt = undefined
      task.reloads = application.reloads
      notify({ type: 'reload-app' })
      return { restarted: true, mode: application.mode, message: '页面正在重新连接。请先 workspace_status 或 app_list_tools 确认后再操作数据。' }
    }
    await rebindPage(task)
    const live = bindingFor(task.clientId)
    const state = await application.status()
    if (!state.online || state.state.current?.id !== task.appId || state.state.session !== task.session || live.pageId !== task.pageId || live.appId !== task.appId) throw Error('绑定的应用页面已断开或切换；代码和日志工具仍可用')
    if (name === 'app_list_tools') return { appId: task.appId, pageId: task.pageId, tools: [...live.tools, selectionTool] }
    if (name === 'app_call') {
      if (args.name !== 'replace_selection' && !live.tools.some(tool => tool.name === args.name)) throw Error('工具不存在或已停用')
      return pageCall(task, args.name, args.arguments)
    }
    throw Error('未知工具')
  }
}
