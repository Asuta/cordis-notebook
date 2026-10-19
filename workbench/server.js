import { createServer } from 'node:http'
import { fork } from 'node:child_process'
import { readFile, mkdir } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { ApplicationProcess } from './processes.js'
import { CommandSessions } from './command-sessions.js'
import { MODELS, normalizeConfig, validateSettings } from './config.js'
import { AttachmentStore, IMAGE_LIMITS } from './attachments.js'
import { discoverApplications } from '../server/application-discovery.js'
import { writeSnapshot } from './persistence.js'
import { openConversationStore } from './conversation-store.js'
import { threadSummary, threadPage } from './conversation-view.js'
import { BrowserVerification } from './browser-verification.js'
import { recoverConversations, createTraceReporter } from './task-state.js'
import { createPageBridge } from './page-bridge.js'
import { createToolExecutor } from './tool-router.js'
import { errorDetail } from '../shared/errors.js'

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
  const streams = new Set()
  const redact = text => config.apiKey ? String(text).split(config.apiKey).join('[密钥已隐藏]') : String(text)
  const notify = message => { const value = JSON.stringify(message); for (const res of streams) res.write(`data: ${value}\n\n`) }
  const imageStore = new AttachmentStore(dataDir)
  const store = await openConversationStore(dataDir, { onError: error => notify({ type: 'error', error: '会话保存失败：' + redact(error.message) }) })
  const conversations = store.conversations
  await recoverConversations(conversations, { dataDir, mark: item => store.mark(item) })
  await store.flush()
  // Keep broken applications selectable for code repair; discovery never loads their plugins.
  const apps = (await discoverApplications(join(root, 'applications')))
    .filter(app => /^[a-z][a-z0-9-]{1,49}$/.test(app.id))
    .map(({ id, name, error }) => ({ id, name, ...(error ? { error } : {}) }))
  let active, worker, closing = false
  const publicThread = item => ({ id: item.id, appId: item.appId, title: item.title, messages: item.messages, turns: item.turns, browserVerificationEnabled: item.browserVerificationEnabled === true, commands: item.commands || [], revision: item.revision, contextUsage: item.contextUsage, hasImages: !!item.hasImages, canCompact: !!item.sessionFile, running: !!item.running, partial: active?.thread === item ? active.partial : '' })
  const changed = item => { item.revision++; notify({ type: 'thread', thread: threadPage(item, { limit: 1 }) }); store.mark(item) }
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
    notify({ type: 'command', threadId: item.id, revision: item.revision, command: safe })
  } })
  const application = new ApplicationProcess({ root, port: appPort, dataDir: appDataDir, diagnosticDir: join(dataDir, 'diagnostics'), commands, mode: appMode })
  const ownerFor = task => ({ threadId: task.thread.id, turnId: task.turn.id, signal: task.controller?.signal, cancelled: () => !!task.cancelled || closing })
  const { updateTrace, clearTrace } = createTraceReporter({ redact, notify, persist: item => store.mark(item) })
  const bridge = createPageBridge({ application, notify, apps })
  const { clients, bindingFor, pageCall } = bridge
  const execute = createToolExecutor({ root, dataDir, application, commands, ownerFor, browserFactory, changed, notify, bridge })
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
    clearTrace()
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
        execute(task, message.name, message.args).then(result => { if (child.connected) child.send({ type: 'result', id: message.id, result }) }, error => { if (child.connected) child.send({ type: 'result', id: message.id, error: redact(error.message), errorDetail: { ...errorDetail(error), message: redact(error.message) } }) })
      } else if (message.type === 'session') { item.sessionFile = message.file; store.mark(item) }
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
    return threadPage(item)
  }
  const server = createServer(async (req, res) => {
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)) }
    try {
      const host = req.headers.host || ''
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) || req.headers.origin && req.headers.origin !== `http://${host}`) throw fail(403, '只允许本机工作台访问')
      const url = new URL(req.url, `http://${host}`), path = url.pathname
      const artifact = path.match(/^\/api\/browser-artifacts\/([a-f0-9-]{36})\/(report\.json|[1-9][0-9]*\.jpg)$/)
      if (req.method === 'GET' && artifact) {
        const report = conversations.flatMap(thread => thread.turns).flatMap(turn => turn.browserVerification
          ? [turn.browserVerification, ...(turn.browserVerification.previousAttempts || [])] : []).find(report => report.id === artifact[1])
        if (!report) throw fail(404, '验收报告不存在')
        const data = await readFile(join(dataDir, 'browser', artifact[1], artifact[2])).catch(error => { if (error.code === 'ENOENT') throw fail(404, '验收文件不存在'); throw error })
        res.writeHead(200, { 'Content-Type': artifact[2].endsWith('.jpg') ? 'image/jpeg' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(data); return
      }
      if (!['GET', 'HEAD'].includes(req.method) && path !== '/api/images' && req.headers['content-type'] !== 'application/json') throw fail(415, '需要 JSON 请求')
      if (req.method === 'GET' && ['/', '/chat', '/app.js', '/style.css', '/markdown.js', '/timeline.js', '/thread-cache.js'].includes(path)) {
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
      if (req.method === 'GET' && path === '/api/state') result = { applications: apps, application: await application.status(), appUrl: `http://127.0.0.1:${appPort}`, threads: conversations.map(url.searchParams.get('summary') === '1' ? threadSummary : publicThread), activeThreadId: active?.thread.id || null }
      else if (req.method === 'GET' && path.startsWith('/api/threads/')) {
        const item = conversations.find(thread => thread.id === path.slice('/api/threads/'.length))
        if (!item) throw fail(404, '聊天不存在')
        result = threadPage(item, Object.fromEntries(url.searchParams))
      }
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
        await writeSnapshot(join(dataDir, 'config.json'), JSON.stringify(next, null, 2)); config = next; result = { saved: true }
      } else if (req.method === 'POST' && path === '/api/images') result = await imageStore.upload(req)
      else if (req.method === 'POST' && path === '/api/images/remove') {
        const { id } = await body(req)
        if (conversations.some(thread => thread.messages.some(message => message.images?.some(image => image.id === id)))) throw fail(409, '历史会话正在使用此图片')
        await imageStore.remove(id); result = { removed: true }
      } else if (req.method === 'POST' && path === '/api/thread-preferences') {
        const input = await body(req), item = conversations.find(item => item.id === input.threadId)
        if (!item) throw fail(404, '聊天不存在')
        if (typeof input.browserVerificationEnabled !== 'boolean') throw fail(400, '浏览器验收开关必须为布尔值')
        item.browserVerificationEnabled = input.browserVerificationEnabled; changed(item); result = threadPage(item)
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
        bridge.receive(await body(req))
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
  if (autoStart) {
    void application.start().catch(error => application.log(error.message))
    // Pay the Agent worker's Node/Pi cold start while the workbench opens instead
    // of charging it to the user's first message.
    try { startWorker() } catch (error) { application.log('Agent 工作台预热失败：' + error.message) }
  }
  return { server, application, commands, execute, clients, async close() {
    closing = true
    if (active) { active.cancelled = true; active.controller?.abort(); await active.browser?.close('stopped') }
    const child = worker
    const workerClosed = child ? new Promise(resolve => child.once('close', resolve)) : Promise.resolve()
    child?.kill()
    await workerClosed
    await commands.close()
    bridge.close()
    for (const res of streams) res.end()
    if (application.child) await application.stop()
    finish('工作台已关闭')
    try { await store.flush() } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  } }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const appMode = process.argv.includes('--production') ? 'runtime' : process.env.WORKBENCH_APP_MODE || 'development'
  const app = await createWorkbench({ port: Number(process.env.WORKBENCH_PORT || 3211), appPort: Number(process.env.WORKBENCH_APP_PORT || 3210), dataDir: process.env.WORKBENCH_DATA_DIR || join(project, '.workbench'), appDataDir: process.env.DATA_DIR || join(project, 'data'), appMode })
  console.log(`Agent 工作台：http://127.0.0.1:${app.server.address().port}（应用${appMode === 'development' ? 'Vite 开发模式' : '正式构建模式'}）`)
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0) })
}
