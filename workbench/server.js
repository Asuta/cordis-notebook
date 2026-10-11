import { createServer } from 'node:http'
import { fork } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { ApplicationProcess } from './processes.js'
import { CommandSessions } from './command-sessions.js'
import { MODELS, modelInfo, normalizeConfig, validateSettings } from './config.js'
import { AttachmentStore, IMAGE_LIMITS } from './attachments.js'
import { discoverApplications } from '../server/application-discovery.js'
import { writeSnapshot } from './persistence.js'
import { BrowserVerification } from './browser-verification.js'
import { developmentInfo, developmentRuntimeInfo, scaffoldPlugin } from './development-tools.js'
import { enablePlugin } from './plugin-activation.js'

const here = dirname(fileURLToPath(import.meta.url)), project = resolve(here, '..')
const fail = (status, text) => Object.assign(Error(text), { status })
async function readJSON(file, fallback) { try { return JSON.parse(await readFile(file, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return fallback; throw error } }
async function body(req) {
  const chunks = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > 2 * 1024 * 1024) throw fail(413, '请求过大'); chunks.push(chunk) }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}') } catch { throw fail(400, 'JSON 无效') }
}
export async function createWorkbench({ root = project, port = 3211, appPort = 3210, dataDir = join(root, '.workbench'), appDataDir = join(root, 'data'), autoStart = true, workerFile = join(here, 'agent-worker.js'), appMode = 'runtime', browserFactory = options => new BrowserVerification(options) } = {}) {
  await mkdir(dataDir, { recursive: true })
  let config = normalizeConfig({ apiKey: process.env.DEEPSEEK_API_KEY || '', ...await readJSON(join(dataDir, 'config.json'), {}) })
  const imageStore = new AttachmentStore(dataDir)
  const conversations = await readJSON(join(dataDir, 'conversations.json'), [])
  for (const item of conversations) {
    item.turns ||= []; item.revision ||= 0
    item.commands ||= []
    for (const command of item.commands) if (command.status === 'running') {
      command.status = 'interrupted'; command.endedAt = Date.now(); command.error = '工作台已重启，旧命令会话不可恢复。'
    }
    if (item.running) {
      item.running = false; item.messages.push({ role: 'system', text: '工作台曾中断；可以继续此会话。' })
      for (const turn of item.turns.filter(turn => turn.status === 'running')) {
        turn.status = 'stopped'; turn.endedAt = Date.now()
        if (turn.browserVerification && !turn.browserVerification.endedAt && !['disabled', 'not-run'].includes(turn.browserVerification.status)) {
          const report = turn.browserVerification
          report.status = 'stopped'; report.endedAt = turn.endedAt
          report.errors ||= []; report.errors.push('工作台中断，浏览器验收未完成。')
          if (/^[a-f0-9-]{36}$/.test(report.id || '')) await writeSnapshot(join(dataDir, 'browser', report.id, 'report.json'), JSON.stringify(report, null, 2)).catch(error => { if (error.code !== 'ENOENT') throw error })
        }
        for (const event of turn.events.filter(event => event.status === 'running')) { event.status = 'stopped'; event.endedAt = turn.endedAt }
      }
    }
  }
  const clients = new Map(), streams = new Set(), pending = new Map()
  // Keep broken applications selectable for code repair; discovery never loads their plugins.
  const apps = (await discoverApplications(join(root, 'applications')))
    .filter(app => /^[a-z][a-z0-9-]{1,49}$/.test(app.id))
    .map(({ id, name, error }) => ({ id, name, ...(error ? { error } : {}) }))
  let active, worker, closing = false, persistence = Promise.resolve(), traceTimer
  const redact = text => config.apiKey ? String(text).split(config.apiKey).join('[密钥已隐藏]') : String(text)
  const publicThread = item => ({ id: item.id, appId: item.appId, title: item.title, messages: item.messages, turns: item.turns, browserVerificationEnabled: item.browserVerificationEnabled === true, commands: item.commands || [], revision: item.revision, contextUsage: item.contextUsage, hasImages: !!item.hasImages, canCompact: !!item.sessionFile, running: !!item.running, partial: active?.thread === item ? active.partial : '' })
  const notify = message => { const value = JSON.stringify(message); for (const res of streams) res.write(`data: ${value}\n\n`) }
  const persist = () => {
    const snapshot = JSON.stringify(conversations, null, 2)
    const task = persistence.then(() => writeSnapshot(join(dataDir, 'conversations.json'), snapshot))
    persistence = task.catch(error => notify({ type: 'error', error: '会话保存失败：' + redact(error.message) }))
    return task
  }
  const changed = item => { item.revision++; notify({ type: 'thread', thread: publicThread(item) }); void persist().catch(() => {}) }
  const commands = new CommandSessions({ root, onChange(command) {
    const item = conversations.find(item => item.id === command.threadId)
    if (!item) return
    const safe = { ...command, command: redact(command.command), output: redact(command.output), error: command.error && redact(command.error) }
    item.commands ||= []
    const index = item.commands.findIndex(entry => entry.session_id === command.session_id)
    if (index < 0) item.commands.push(safe); else item.commands[index] = safe
    const finished = item.commands.filter(entry => entry.status !== 'running')
    const removed = new Set(finished.slice(0, Math.max(0, finished.length - 40)).map(entry => entry.session_id))
    item.commands = item.commands.filter(entry => !removed.has(entry.session_id))
    changed(item)
  } })
  const application = new ApplicationProcess({ root, port: appPort, dataDir: appDataDir, commands, mode: appMode })
  const ownerFor = task => ({ threadId: task.thread.id, turnId: task.turn.id, signal: task.controller?.signal, cancelled: () => !!task.cancelled || closing })
  const updateTrace = (task, event) => {
    const turn = task.turn
    let record = turn.events.find(record => record.id === event.id)
    if (!record) { record = { id: event.id || randomUUID(), kind: event.kind || 'notice', startedAt: Date.now(), status: 'running' }; turn.events.push(record) }
    for (const key of ['kind', 'name', 'input', 'output', 'text', 'status', 'messageId']) if (event[key] !== undefined) record[key] = redact(event[key]).slice(0, key === 'output' || key === 'input' ? 64000 : 256000)
    for (const key of ['startedAt', 'endedAt']) if (Number.isFinite(event[key]) && event[key] >= 0) record[key] = event[key]
    if (record.kind === 'model' && event.timing) {
      record.timing ||= {}
      for (const key of ['invokedAt', 'requestStartedAt', 'responseAt', 'firstOutputAt', 'endedAt', 'preparationMs', 'responseWaitMs', 'waitMs', 'streamingMs', 'totalMs']) {
        if (Number.isFinite(event.timing[key]) && event.timing[key] >= 0) record.timing[key] = event.timing[key]
      }
    }
    if (event.delta) { const full = (record.text || '') + redact(event.delta); record.text = full.slice(0, 256000); record.truncated = full.length > 256000 || record.truncated }
    if (['done', 'error', 'stopped'].includes(record.status)) record.endedAt ||= Date.now()
    // Coalesce token events; one bounded write/broadcast per 200 ms, with a final
    // full snapshot at task completion. Revisions protect against poll/SSE races.
    if (!traceTimer) traceTimer = setTimeout(() => {
      traceTimer = null; task.thread.revision++
      notify({ type: 'turn', threadId: task.thread.id, revision: task.thread.revision, turn, contextUsage: task.thread.contextUsage })
      void persist().catch(() => {})
    }, 200)
  }
  const bindingFor = clientId => {
    const client = clients.get(clientId)
    if (!client || Date.now() - client.seen > 10000) throw Error('业务页面未连接；请打开工作台中的应用，代码修复工具仍可使用')
    return client
  }
  async function pageCall(task, name, args = {}) {
    if (task.cancelled) throw Error('任务已停止')
    const current = bindingFor(task.clientId)
    if (task.appId !== current.appId || task.pageId !== current.pageId || task.session !== current.session) throw Error('应用或页面已经切换；请在当前应用新建会话或重新发送任务')
    return new Promise((resolve, reject) => {
      const id = randomUUID(), timer = setTimeout(() => { pending.delete(id); reject(Error('页面工具响应超时；结果可能已执行，请先读取状态再决定是否重试')) }, 20000)
      pending.set(id, { clientId: task.clientId, pageId: task.pageId, resolve, reject, timer })
      notify({ type: 'page-call', clientId: task.clientId, pageId: task.pageId, session: task.session, id, name, args })
    })
  }
  const selectionTool = { name: 'replace_selection', description: '仅替换用户添加的选区并保留撤销。默认传 text；若附件 formats 包含 richtext，可传 format:"richtext" 和 content，结构见附件 richText/replacementHint。不要同时传 text 和 content。选区变化或跨页面时拒绝。', inputSchema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, format: { type: 'string', enum: ['text', 'richtext'] }, text: { type: 'string' }, content: { type: 'object', description: '由选区所属插件定义的结构化替换片段；仅对声明支持的选区使用。' } }, required: ['id'], oneOf: [{ required: ['text'], properties: { format: { const: 'text' } }, not: { required: ['content'] } }, { required: ['format', 'content'], properties: { format: { const: 'richtext' } }, not: { required: ['text'] } }] } }
  async function rebindPage(task) {
    // Vite reloads the page after backend, manifest or host edits; follow the new page.
    if (application.mode === 'development') {
      await application.settle({ delay: 0 })
      if ((task.reloads ?? application.reloads) !== application.reloads) task.awaitingRebind = true
      task.reloads = application.reloads
    }
    if (task.awaitingRebind && task.clientId) {
      // A Vite page load transforms source modules, so allow it longer than a built page.
      for (let i = 0; i < (application.mode === 'development' ? 150 : 30) && !task.cancelled; i++) {
        const page = clients.get(task.clientId)
        if (page && (page.appId !== task.appId || page.pageId !== task.pageId)) break
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
    const live = clients.get(task.clientId)
    if (task.awaitingRebind && live?.appId === task.appId && live.pageId !== task.pageId) { task.session = live.session; task.pageId = live.pageId; task.awaitingRebind = false }
    return live && Date.now() - live.seen <= 10000 ? live : null
  }
  async function execute(task, name, args) {
    if (task.cancelled) throw Error('任务已停止')
    if (name.startsWith('browser_')) {
      if (!task.turn?.browserVerificationEnabled) throw Error('用户关闭了本轮浏览器验收，不能调用或绕过开关')
      if (!['browser_open', 'browser_action', 'browser_batch', 'browser_retest', 'browser_finish', 'browser_report'].includes(name)) throw Error('未知浏览器工具')
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
      return enablePlugin(task.appId, args, { status: () => application.status(), url: 'http://127.0.0.1:' + application.port, signal: task.controller?.signal,
        page: live ? input => {
          if (task.session !== input.session) throw Error('绑定页面不是最新应用会话；请等待页面重新连接')
          return pageCall(task, 'workspace_enable_plugin', input)
        } : null })
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
      return { ...status, appId: task.appId, root }
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
  function finish(error) {
    if (!active) return
    if (active.browser && !active.browser.closed && !active.stopping) {
      const task = active
      task.stopping = task.browser.close(task.cancelled ? 'stopped' : 'incomplete').catch(error => {
        task.failed = true; updateTrace(task, { kind: 'notice', text: '浏览器验收清理失败：' + error.message, status: 'error' })
      })
    }
    if (active.stopping) {
      const task = active, stopping = task.stopping
      if (!task.finishing) { task.finishing = true; void stopping.catch(() => {}).then(() => { if (active === task) { task.stopping = null; finish(error) } }) }
      return
    }
    const item = active.thread
    if (active.partial) item.messages.push({ role: 'assistant', text: redact(active.partial), turnId: active.turn.id })
    if (error) updateTrace(active, { id: randomUUID(), kind: 'notice', text: error, status: active.cancelled ? 'stopped' : 'error' })
    active.turn.status = active.cancelled ? 'stopped' : error || active.failed || active.modelError ? 'error' : 'done'; active.turn.endedAt = Date.now()
    for (const event of active.turn.events.filter(event => event.status === 'running')) { event.status = active.turn.status === 'done' ? 'done' : 'stopped'; event.endedAt = Date.now() }
    clearTimeout(traceTimer); traceTimer = null
    item.running = false; active = null; changed(item)
  }
  function startWorker() {
    const child = fork(workerFile, [], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    worker = child
    child.stdout.on('data', () => {})
    child.stderr.on('data', data => { if (active) updateTrace(active, { id: 'worker-log', kind: 'notice', name: 'Agent 日志', delta: String(data), status: 'done' }) })
    child.on('error', error => finish(error.message))
    child.on('exit', () => { if (worker === child) {
      worker = null
      if (active && !closing) {
        const task = active; task.cancelled = true; task.controller?.abort()
        task.stopping ||= Promise.all([commands.stopTurn(ownerFor(task)), task.browser?.close('stopped')]).catch(error => updateTrace(task, { kind: 'notice', text: error.message, status: 'error' }))
      }
      finish('Agent 进程已退出；会话已保留，可以重试。')
    } })
    child.on('message', message => {
      if (message.type === 'ready') { child.ready = true; return }
      if (!active) return
      const task = active, item = task.thread
      if (message.type === 'tool') {
        execute(task, message.name, message.args).then(result => { if (child.connected) child.send({ type: 'result', id: message.id, result }) }, error => { if (child.connected) child.send({ type: 'result', id: message.id, error: redact(error.message) }) })
      } else if (message.type === 'session') { item.sessionFile = message.file; void persist().catch(() => {}) }
      else if (message.type === 'assistant-start') { task.turn.currentMessageId = message.messageId; delete task.turn.finalAnswer; changed(item) }
      else if (message.type === 'trace') updateTrace(task, message.event)
      else if (message.type === 'usage') { item.contextUsage = message.usage; changed(item) }
      else if (message.type === 'delta') { task.partial += message.text; updateTrace(task, { id: 'legacy-text', kind: 'text', delta: message.text }) }
      else if (message.type === 'assistant') {
        // An unsuccessful model attempt can recover. Worker/setup errors remain fatal.
        task.modelError = message.error || null
        if (message.error) updateTrace(task, { id: randomUUID(), kind: 'notice', text: message.error, status: 'error' })
        const eventIds = message.textEventIds || []
        if (message.text) {
          item.messages.push({ role: 'assistant', text: redact(message.text), turnId: task.turn.id, messageId: message.messageId })
          if (!eventIds.length) { const id = randomUUID(); eventIds.push(id); updateTrace(task, { id, messageId: message.messageId, kind: 'text', text: message.text, status: 'done' }) }
        }
        if (!message.error && message.final !== false && (message.text || message.stopReason === 'length')) task.turn.finalAnswer = {
          text: redact(message.text || ''), eventIds, messageId: message.messageId, truncated: message.stopReason === 'length',
        }
        task.partial = ''; changed(item)
      } else if (message.type === 'error') { task.failed = true; updateTrace(task, { id: randomUUID(), kind: 'notice', text: message.error, status: 'error' }); changed(item) }
      else if (message.type === 'activity') updateTrace(task, { id: message.name, kind: 'tool', name: message.name, status: message.phase === 'start' ? 'running' : message.phase })
      else if (message.type === 'done') finish(message.cancelled ? '任务已停止。已完成的操作不会自动撤销。' : '')
    })
    return child
  }
  async function run(input, mode = 'chat') {
    if (active) throw fail(409, '已有任务执行中，请等待或先停止')
    if (!config.apiKey) throw fail(400, '请先在设置中填写 DeepSeek API 密钥')
    if (mode === 'chat' && (typeof input.prompt !== 'string' || !input.prompt.trim() && !input.images?.length || input.prompt.length > 100000)) throw fail(400, '消息内容无效')
    if (!apps.some(app => app.id === input.appId)) throw fail(400, '应用不存在')
    let item = input.threadId && conversations.find(t => t.id === input.threadId)
    if (input.threadId && !item || item && item.appId !== input.appId) throw fail(400, '会话不属于当前应用')
    if (input.browserVerificationEnabled !== undefined && typeof input.browserVerificationEnabled !== 'boolean') throw fail(400, '浏览器验收开关必须为布尔值')
    if (mode === 'compact' && !item?.sessionFile) throw fail(400, '此会话尚无可压缩的上下文')
    const client = clients.get(input.clientId)
    if (client && client.appId !== input.appId) throw fail(409, '页面应用已切换')
    const attachments = Array.isArray(input.attachments) ? input.attachments.slice(0, 10) : []
    if (attachments.some(a => a.appId !== input.appId || a.pageId !== client?.pageId || a.session !== client?.session || typeof a.text !== 'string' || a.text.length > 100000)) throw fail(409, '附件已过期或不属于当前应用')
    if (input.model && !MODELS.some(model => model.id === input.model)) throw fail(400, '不支持的模型选项')
    let taskConfig
    try { taskConfig = validateSettings({ model: input.model || config.model, reasoningEffort: input.reasoningEffort || config.reasoningEffort, thinking: input.thinking ?? config.thinking }, config) } catch (error) { throw fail(400, error.message) }
    const images = await imageStore.select(input.images)
    if (!modelInfo(taskConfig.model).images && (images.length || item?.hasImages)) throw fail(409, '当前模型不支持此对话的图片，请明确切换到 Flash，或新建纯文字对话')
    if (active || closing) throw fail(409, '已有任务执行中，请等待或先停止')
    if (!item) { item = { id: randomUUID(), appId: input.appId, title: input.prompt.trim().slice(0, 35) || '图片对话', messages: [], turns: [], revision: 0 }; conversations.push(item) }
    if (mode === 'chat' && input.browserVerificationEnabled !== undefined) item.browserVerificationEnabled = input.browserVerificationEnabled
    const browserVerificationEnabled = mode === 'chat' && item.browserVerificationEnabled === true
    const turn = { id: randomUUID(), presentationVersion: 1, mode, startedAt: Date.now(), status: 'running', model: taskConfig.model, effort: taskConfig.thinking ? taskConfig.reasoningEffort : 'off', events: [],
      browserVerificationEnabled, ...(mode === 'chat' ? { browserVerification: { status: browserVerificationEnabled ? 'not-run' : 'disabled' } } : {}) }
    item.turns.push(turn); item.hasImages ||= images.length > 0
    active = { thread: item, turn, appId: item.appId, clientId: input.clientId, pageId: client?.pageId, session: client?.session, partial: '', controller: new AbortController(),
      devSequence: application.sequence, reloads: application.reloads }
    item.running = true
    if (mode === 'chat') item.messages.push({ id: randomUUID(), role: 'user', turnId: turn.id, text: input.prompt, attachments, images })
    changed(item)
    const task = active
    void (async () => {
      const child = worker || startWorker()
      for (let i = 0; !child.ready && i < 900; i++) { if (!worker || task.cancelled || closing) break; await new Promise(resolve => setTimeout(resolve, 100)) }
      if (active !== task) return
      if (!child.ready || !child.connected || task.cancelled || closing) { finish('任务在启动阶段已停止'); return }
      const status = await application.status()
      if (active !== task || task.cancelled || closing) return
      child.send({ type: 'run', root, dataDir, agentDir: join(dataDir, 'pi'), config: taskConfig, task: { mode, browserVerificationEnabled, appMode: status.mode, appOnline: status.online, appManaged: status.managed, appError: status.error, appId: item.appId, prompt: input.prompt || '请分析这些图片。', attachments, images, sessionFile: item.sessionFile } })
    })().catch(error => { if (active === task) finish(error.message) })
    return publicThread(item)
  }
  const server = createServer(async (req, res) => {
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)) }
    try {
      const host = req.headers.host || ''
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) || req.headers.origin && req.headers.origin !== `http://${host}`) throw fail(403, '只允许本机工作台访问')
      const path = new URL(req.url, `http://${host}`).pathname
      const artifact = path.match(/^\/api\/browser-artifacts\/([a-f0-9-]{36})\/(report\.json|[1-9][0-9]*\.jpg)$/)
      if (req.method === 'GET' && artifact) {
        const report = conversations.flatMap(thread => thread.turns).flatMap(turn => turn.browserVerification
          ? [turn.browserVerification, ...(turn.browserVerification.previousAttempts || [])] : []).find(report => report.id === artifact[1])
        if (!report) throw fail(404, '验收报告不存在')
        const data = await readFile(join(dataDir, 'browser', artifact[1], artifact[2])).catch(error => { if (error.code === 'ENOENT') throw fail(404, '验收文件不存在'); throw error })
        res.writeHead(200, { 'Content-Type': artifact[2].endsWith('.jpg') ? 'image/jpeg' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(data); return
      }
      if (!['GET', 'HEAD'].includes(req.method) && path !== '/api/images' && req.headers['content-type'] !== 'application/json') throw fail(415, '需要 JSON 请求')
      if (req.method === 'GET' && ['/', '/chat', '/app.js', '/style.css', '/markdown.js', '/timeline.js'].includes(path)) {
        const file = path === '/' || path === '/chat' ? 'index.html' : path.slice(1)
        res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(await readFile(join(here, 'public', file))); return
      }
      if (req.method === 'GET' && path === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' }); res.write(': connected\n\n'); streams.add(res)
        const timer = setInterval(() => res.write(': keepalive\n\n'), 15000)
        req.on('close', () => { clearInterval(timer); streams.delete(res) }); return
      }
      let result
      if (req.method === 'GET' && path.startsWith('/api/images/')) {
        const id = path.slice('/api/images/'.length), image = await imageStore.get(id)
        res.writeHead(200, { 'Content-Type': image.mimeType, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=86400' }); res.end(await imageStore.bytes(id)); return
      }
      if (req.method === 'GET' && path === '/api/state') result = { applications: apps, application: await application.status(), appUrl: `http://127.0.0.1:${appPort}`, threads: conversations.map(publicThread), activeThreadId: active?.thread.id || null }
      else if (req.method === 'GET' && path === '/api/config') result = { baseUrl: config.baseUrl, model: config.model, thinking: config.thinking, reasoningEffort: config.reasoningEffort, compaction: config.compaction, models: MODELS, imageLimits: IMAGE_LIMITS, hasKey: !!config.apiKey }
      else if (req.method === 'POST' && path === '/api/config') {
        if (active) throw fail(409, '请等待当前任务结束后修改设置')
        const input = await body(req), url = new URL(input.baseUrl || config.baseUrl)
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw fail(400, '模型地址必须是 HTTPS 基础地址')
        if (input.model !== undefined && (typeof input.model !== 'string' || !/^[\w./:-]{1,100}$/.test(input.model))) throw fail(400, '模型名称无效')
        let next
        try { next = validateSettings({ ...input, baseUrl: url.href.replace(/\/chat\/completions\/?$/, '').replace(/\/$/, '') }, config) } catch (error) { throw fail(400, error.message) }
        next.apiKey = config.apiKey
        if (typeof input.apiKey === 'string' && input.apiKey.trim()) next.apiKey = input.apiKey.trim()
        await writeFile(join(dataDir, 'config.json'), JSON.stringify(next, null, 2), { mode: 0o600 }); config = next; result = { saved: true }
      } else if (req.method === 'POST' && path === '/api/images') result = await imageStore.upload(req)
      else if (req.method === 'POST' && path === '/api/images/remove') {
        const { id } = await body(req)
        if (conversations.some(thread => thread.messages.some(message => message.images?.some(image => image.id === id)))) throw fail(409, '历史会话正在使用此图片')
        await imageStore.remove(id); result = { removed: true }
      } else if (req.method === 'POST' && path === '/api/thread-preferences') {
        const input = await body(req), item = conversations.find(item => item.id === input.threadId)
        if (!item) throw fail(404, '聊天不存在')
        if (typeof input.browserVerificationEnabled !== 'boolean') throw fail(400, '浏览器验收开关必须为布尔值')
        item.browserVerificationEnabled = input.browserVerificationEnabled; changed(item); result = publicThread(item)
      } else if (req.method === 'POST' && path === '/api/run') result = await run(await body(req))
      else if (req.method === 'POST' && path === '/api/compact') result = await run(await body(req), 'compact')
      else if (req.method === 'POST' && path === '/api/interrupt') {
        const task = active
        if (task) {
          task.cancelled = true
          task.controller?.abort()
          task.stopping ||= Promise.all([commands.stopTurn(ownerFor(task)), task.browser?.close('stopped')])
          if (worker?.connected) worker.send({ type: 'interrupt' })
          await task.stopping
        }
        result = { requested: true }
      } else if (req.method === 'POST' && path === '/api/commands/terminate') {
        const { threadId, session_id } = await body(req)
        if (!conversations.some(item => item.id === threadId)) throw fail(404, '聊天不存在')
        await commands.terminate({ threadId }, session_id); result = { stopped: true }
      }
      else if (req.method === 'POST' && path === '/api/bridge') {
        const input = await body(req)
        if (typeof input.clientId !== 'string') throw fail(400, '页面标识无效')
        if (input.type === 'result') {
          const entry = pending.get(input.id)
          if (entry && entry.clientId === input.clientId && entry.pageId === input.pageId) { pending.delete(input.id); clearTimeout(entry.timer); input.error ? entry.reject(Error(input.error)) : entry.resolve(input.result) }
        } else if (input.type === 'disconnect') clients.delete(input.clientId)
        else if (input.type === 'ready' && apps.some(app => app.id === input.appId) && typeof input.pageId === 'string' && typeof input.session === 'string' && Array.isArray(input.tools)) clients.set(input.clientId, { appId: input.appId, pageId: input.pageId, session: input.session, tools: input.tools.slice(0, 100), seen: Date.now() })
        result = { ok: true }
      } else if (req.method === 'POST' && path === '/api/application/start') result = await application.start()
      else if (req.method === 'POST' && path === '/api/application/restart') {
        const input = await body(req)
        let task
        if ((await application.status()).online) { task = { ...bindingFor(input.clientId), clientId: input.clientId }; await pageCall(task, 'workspace_prepare_reload') }
        try { result = await application.restart(); notify({ type: 'reload-app' }) }
        catch (error) { if (task) await pageCall(task, 'workspace_release_reload').catch(() => {}); throw error }
      } else throw fail(404, '接口不存在')
      json(200, result)
    } catch (error) { json(error.status || 500, { error: redact(error.message) }) }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  // The actual listening port also isolates instances started with port: 0.
  application.env.CORDIS_VITE_CACHE_DIR = join(root, 'node_modules/.vite', `cordis-workbench-${server.address().port}-${appPort}`)
  if (autoStart) void application.start().catch(error => application.log(error.message))
  return { server, application, commands, execute, clients, async close() {
    closing = true
    if (active) { active.cancelled = true; active.controller?.abort(); await active.browser?.close('stopped') }
    const child = worker
    const workerClosed = child ? new Promise(resolve => child.once('close', resolve)) : Promise.resolve()
    child?.kill()
    await workerClosed
    await commands.close()
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(Error('工作台已关闭')) }; pending.clear()
    for (const res of streams) res.end()
    if (application.child) await application.stop()
    finish('工作台已关闭'); await persistence
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  } }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const appMode = process.argv.includes('--production') ? 'runtime' : process.env.WORKBENCH_APP_MODE || 'development'
  const app = await createWorkbench({ port: Number(process.env.WORKBENCH_PORT || 3211), appPort: Number(process.env.WORKBENCH_APP_PORT || 3210), dataDir: process.env.WORKBENCH_DATA_DIR || join(project, '.workbench'), appDataDir: process.env.DATA_DIR || join(project, 'data'), appMode })
  console.log(`Agent 工作台：http://127.0.0.1:${app.server.address().port}（应用${appMode === 'development' ? 'Vite 开发模式' : '正式构建模式'}）`)
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0) })
}
