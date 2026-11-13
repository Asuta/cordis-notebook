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
import { listenOnAvailablePort } from './ports.js'
import { acquireInstanceLock } from './instance-lock.js'

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
  // One workbench per data directory: two servers would write the same thread files.
  const lock = await acquireInstanceLock(join(dataDir, 'workbench.lock'))
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
  const tasks = new Map(), queued = [], workers = new Set()
  let closing = false
  const taskFor = item => tasks.get(item.id)
  const runningTasks = () => [...tasks.values()].filter(task => task.phase === 'running')
  const publicThread = item => {
    const task = taskFor(item)
    return { id: item.id, appId: item.appId, title: item.title, messages: item.messages, turns: item.turns, browserVerificationEnabled: item.browserVerificationEnabled === true, commands: item.commands || [], revision: item.revision, contextUsage: item.contextUsage, hasImages: !!item.hasImages, canCompact: !!item.sessionFile, running: !!item.running, queued: item.queued === true, partial: task?.phase === 'running' ? task.partial : '' }
  }
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
  const bridge = createPageBridge({ application, notify, apps })
  const { clients, bindingFor, pageCall } = bridge
  const execute = createToolExecutor({ root, dataDir, application, commands, ownerFor, browserFactory, changed, notify, bridge })
  function finish(task, error) {
    if (!task || task.finished) return
    if (task.browser && !task.browser.closed && !task.stopping) {
      task.stopping = task.browser.close(task.cancelled ? 'stopped' : 'incomplete').catch(error => {
        task.failed = true; task.updateTrace({ kind: 'notice', text: '浏览器验收清理失败：' + error.message, status: 'error' })
      })
    }
    if (task.stopping) {
      const stopping = task.stopping
      if (!task.finishing) { task.finishing = true; void stopping.catch(() => {}).then(() => { task.stopping = null; task.finishing = false; finish(task, error) }) }
      return
    }
    const item = task.thread
    if (task.partial) item.messages.push({ role: 'assistant', text: redact(task.partial), turnId: task.turn.id })
    if (error) task.updateTrace({ id: randomUUID(), kind: 'notice', text: error, status: task.cancelled ? 'stopped' : 'error' })
    task.turn.status = task.cancelled ? 'stopped' : error || task.failed || task.modelError ? 'error' : 'done'; task.turn.endedAt = Date.now()
    for (const event of task.turn.events.filter(event => event.status === 'running')) { event.status = task.turn.status === 'done' ? 'done' : 'stopped'; event.endedAt = Date.now() }
    task.clearTrace()
    task.finished = true; task.phase = 'finished'; item.running = false; item.queued = false
    tasks.delete(item.id)
    if (task.worker?.task === task) task.worker.task = null
    task.worker = null
    changed(item)
    launchQueued()
  }
  function startWorker() {
    const child = fork(workerFile, [], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    const record = { child, ready: false, task: null }
    workers.add(record)
    child.stdout.on('data', () => {})
    child.stderr.on('data', data => { if (record.task) record.task.updateTrace({ id: 'worker-log', kind: 'notice', name: 'Agent 日志', delta: String(data), status: 'done' }) })
    child.on('error', error => { if (record.task) finish(record.task, error.message) })
    child.on('exit', () => {
      const task = record.task; record.task = null; workers.delete(record)
      if (task && !task.finished) {
        task.cancelled = true; task.controller?.abort()
        task.stopping ||= Promise.all([commands.stopTurn(ownerFor(task)), task.browser?.close('stopped')]).catch(error => task.updateTrace({ kind: 'notice', text: error.message, status: 'error' }))
        finish(task, 'Agent 进程已退出；会话已保留，可以重试。')
      }
      launchQueued()
    })
    child.on('message', message => {
      if (message.type === 'ready') { record.ready = true; launchQueued(); return }
      const task = record.task
      if (!task || task.finished) return
      const item = task.thread
      if (message.type === 'tool') {
        execute(task, message.name, message.args).then(result => { if (child.connected) child.send({ type: 'result', id: message.id, result }) }, error => { if (child.connected) child.send({ type: 'result', id: message.id, error: redact(error.message), errorDetail: { ...errorDetail(error), message: redact(error.message) } }) })
      } else if (message.type === 'session') { item.sessionFile = message.file; store.mark(item) }
      else if (message.type === 'assistant-start') { task.turn.currentMessageId = message.messageId; delete task.turn.finalAnswer; changed(item) }
      else if (message.type === 'trace') task.updateTrace(message.event)
      else if (message.type === 'usage') { item.contextUsage = message.usage; changed(item) }
      else if (message.type === 'delta') { task.partial += message.text; task.updateTrace({ id: 'legacy-text', kind: 'text', delta: message.text }) }
      else if (message.type === 'assistant') {
        // An unsuccessful model attempt can recover. Worker/setup errors remain fatal.
        task.modelError = message.error || null
        if (message.error) task.updateTrace({ id: randomUUID(), kind: 'notice', text: message.error, status: 'error' })
        const eventIds = message.textEventIds || []
        if (message.text) {
          item.messages.push({ role: 'assistant', text: redact(message.text), turnId: task.turn.id, messageId: message.messageId })
          if (!eventIds.length) { const id = randomUUID(); eventIds.push(id); task.updateTrace({ id, messageId: message.messageId, kind: 'text', text: message.text, status: 'done' }) }
        }
        if (!message.error && message.final !== false && (message.text || message.stopReason === 'length')) task.turn.finalAnswer = {
          text: redact(message.text || ''), eventIds, messageId: message.messageId, truncated: message.stopReason === 'length',
        }
        task.partial = ''; changed(item)
      } else if (message.type === 'error') { task.failed = true; task.updateTrace({ id: randomUUID(), kind: 'notice', text: message.error, status: 'error' }); changed(item) }
      else if (message.type === 'activity') task.updateTrace({ id: message.name, kind: 'tool', name: message.name, status: message.phase === 'start' ? 'running' : message.phase })
      else if (message.type === 'done') finish(task, message.cancelled ? '任务已停止。已完成的操作不会自动撤销。' : '')
    })
    return record
  }
  function launchTask(task) {
    if (task.finished || task.cancelled || closing) return
    task.phase = 'running'; task.thread.queued = false; task.turn.status = 'running'; task.turn.startedAt = Date.now(); task.turn.queueWaitMs = task.turn.startedAt - task.turn.queuedAt
    changed(task.thread)
    let record
    try { record = [...workers].find(record => !record.task && record.child.connected) || startWorker() }
    catch (error) { finish(task, error.message); return }
    record.task = task; task.worker = record
    void (async () => {
      for (let i = 0; !record.ready && i < 900; i++) { if (!tasks.has(task.thread.id) || task.cancelled || closing) return; await new Promise(resolve => setTimeout(resolve, 100)) }
      if (!tasks.has(task.thread.id) || task.cancelled || closing) return
      if (!record.ready || !record.child.connected) { finish(task, '任务在启动阶段已停止'); return }
      const status = await application.status()
      if (!tasks.has(task.thread.id) || task.cancelled || closing) return
      task.dispatched = true
      record.child.send({ type: 'run', root, dataDir, agentDir: join(dataDir, 'pi', task.thread.id), config: task.config, task: { mode: task.mode, browserVerificationEnabled: task.browserVerificationEnabled, customSystemPrompt: task.config.customSystemPrompt, appMode: status.mode, appOnline: status.online, appManaged: status.managed, appError: status.error, appId: task.thread.appId, prompt: task.prompt || '请分析这些图片。', attachments: task.attachments, images: task.images, sessionFile: task.thread.sessionFile } })
    })().catch(error => { if (!task.finished) finish(task, error.message) })
  }
  function launchQueued() {
    while (!closing && runningTasks().length < config.maxConcurrentAgents && queued.length) {
      const task = queued.shift()
      if (!task || task.finished || task.cancelled) continue
      launchTask(task)
    }
  }
  async function run(input, mode = 'chat') {
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
    if (closing) throw fail(409, '工作台正在关闭')
    if (!item) { item = { id: randomUUID(), appId: input.appId, title: input.prompt.trim().slice(0, 35) || '图片对话', messages: [], turns: [], revision: 0 }; conversations.push(item) }
    if (item.running || tasks.has(item.id)) throw fail(409, '此对话已有任务执行中，请等待或先停止')
    if (mode === 'chat' && input.browserVerificationEnabled !== undefined) item.browserVerificationEnabled = input.browserVerificationEnabled
    const browserVerificationEnabled = mode === 'chat' && item.browserVerificationEnabled === true
    const turn = { id: randomUUID(), presentationVersion: 1, mode, queuedAt: Date.now(), startedAt: Date.now(), status: 'queued', model: taskConfig.model, effort: taskConfig.thinking ? taskConfig.reasoningEffort : 'off', events: [],
      browserVerificationEnabled, ...(mode === 'chat' ? { browserVerification: { status: browserVerificationEnabled ? 'not-run' : 'disabled' } } : {}) }
    item.turns.push(turn); item.hasImages ||= images.length > 0
    const task = { thread: item, turn, mode, prompt: input.prompt, attachments, images, config: taskConfig, browserVerificationEnabled, clientId: input.clientId, pageId: client?.pageId, session: client?.session, partial: '', controller: new AbortController(), phase: 'queued', browser: null, finished: false,
      devSequence: application.sequence, reloads: application.reloads }
    const trace = createTraceReporter({ redact, notify, persist: value => store.mark(value) })
    task.updateTrace = event => trace.updateTrace(task, event)
    task.clearTrace = trace.clearTrace
    tasks.set(item.id, task)
    item.running = true; item.queued = runningTasks().length >= config.maxConcurrentAgents
    if (mode === 'chat') item.messages.push({ id: randomUUID(), role: 'user', turnId: turn.id, text: input.prompt, attachments, images })
    changed(item)
    if (!item.queued) launchTask(task); else queued.push(task)
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
      if (req.method === 'GET' && path === '/api/state') {
        const scheduled = [...tasks.values()].filter(task => !task.finished)
        result = { applications: apps, application: await application.status(), appUrl: `http://127.0.0.1:${application.port}`, threads: conversations.map(url.searchParams.get('summary') === '1' ? threadSummary : publicThread),
          activeThreadId: scheduled[0]?.thread.id || null, activeThreadIds: runningTasks().map(task => task.thread.id), queuedThreadIds: scheduled.filter(task => task.phase === 'queued').map(task => task.thread.id), runningCount: runningTasks().length, maxConcurrentAgents: config.maxConcurrentAgents }
      }
      else if (req.method === 'GET' && path.startsWith('/api/threads/')) {
        const item = conversations.find(thread => thread.id === path.slice('/api/threads/'.length))
        if (!item) throw fail(404, '聊天不存在')
        result = threadPage(item, Object.fromEntries(url.searchParams))
      }
      else if (req.method === 'GET' && path === '/api/config') result = { baseUrl: config.baseUrl, model: config.model, thinking: config.thinking, reasoningEffort: config.reasoningEffort, customSystemPrompt: config.customSystemPrompt, maxConcurrentAgents: config.maxConcurrentAgents, compaction: config.compaction, models: MODELS, imageLimits: IMAGE_LIMITS, hasKey: !!config.apiKey }
      else if (req.method === 'POST' && path === '/api/config') {
        const input = await body(req), url = new URL(input.baseUrl || config.baseUrl)
        if (tasks.size && typeof input.apiKey === 'string' && input.apiKey.trim()) throw fail(409, '任务执行中不能更换 API 密钥；其他设置会从下一轮生效')
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw fail(400, '模型地址必须是 HTTPS 基础地址')
        if (input.model !== undefined && (typeof input.model !== 'string' || !/^[\w./:-]{1,100}$/.test(input.model))) throw fail(400, '模型名称无效')
        let next
        try { next = validateSettings({ ...input, baseUrl: url.href.replace(/\/chat\/completions\/?$/, '').replace(/\/$/, '') }, config) } catch (error) { throw fail(400, error.message) }
        next.apiKey = config.apiKey
        if (typeof input.apiKey === 'string' && input.apiKey.trim()) next.apiKey = input.apiKey.trim()
        await writeSnapshot(join(dataDir, 'config.json'), JSON.stringify(next, null, 2)); config = next; launchQueued(); result = { saved: true }
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
        const input = await body(req)
        const task = input.threadId ? tasks.get(input.threadId) : [...tasks.values()].find(task => !task.finished)
        if (task) {
          task.cancelled = true
          task.controller?.abort()
          // Before dispatch the worker cannot send done; release the slot here
          // without sending an interrupt that could reach its next task.
          if (!task.dispatched) finish(task, '任务已停止。已完成的操作不会自动撤销。')
          else {
            task.stopping ||= Promise.all([commands.stopTurn(ownerFor(task)), task.browser?.close('stopped')])
            if (task.worker?.child.connected) task.worker.child.send({ type: 'interrupt' })
            await task.stopping
          }
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
      } else if (req.method === 'POST' && path === '/api/application/start') result = { ...await application.start(), appUrl: `http://127.0.0.1:${application.port}` }
      else if (req.method === 'POST' && path === '/api/application/restart') {
        const input = await body(req)
        let task
        if ((await application.status()).online) { task = { ...bindingFor(input.clientId), clientId: input.clientId }; await pageCall(task, 'workspace_prepare_reload') }
        try { result = await application.restart(); notify({ type: 'reload-app', appUrl: `http://127.0.0.1:${application.port}` }) }
        catch (error) { if (task) await pageCall(task, 'workspace_release_reload').catch(() => {}); throw error }
      } else throw fail(404, '接口不存在')
      json(200, result)
    } catch (error) { json(error.status || 500, { error: redact(error.message) }) }
  })
  // Keep moving up from the configured port until one is free.
  const listeningPort = await listenOnAvailablePort(server, port, '127.0.0.1').catch(async error => { await lock.release(); throw error })
  await lock.update(listeningPort)
  // The actual listening port also isolates instances started with port: 0.
  application.env.CORDIS_VITE_CACHE_DIR = join(root, 'node_modules/.vite', `cordis-workbench-${listeningPort}-${appPort}`)
  if (autoStart) {
    void application.start().catch(error => application.log(error.message))
    // Pay the Agent worker's Node/Pi cold start while the workbench opens instead
    // of charging it to the user's first message.
    try { startWorker() } catch (error) { application.log('Agent 工作台预热失败：' + error.message) }
  }
  return { server, application, commands, execute, clients, async close() {
    closing = true
    const scheduled = [...tasks.values()]
    for (const task of scheduled) {
      task.cancelled = true; task.controller?.abort()
      task.stopping ||= Promise.all([commands.stopTurn(ownerFor(task)), task.browser?.close('stopped')]).catch(() => {})
      if (task.phase === 'queued') finish(task, '工作台已关闭')
    }
    const workerClosures = [...workers].map(record => new Promise(resolve => { record.child.once('close', resolve); record.child.kill() }))
    await Promise.all(workerClosures)
    await Promise.all(scheduled.map(task => task.stopping?.catch(() => {})))
    for (const task of [...tasks.values()]) { task.stopping = null; task.finishing = false; finish(task, '工作台已关闭') }
    await commands.close()
    bridge.close()
    for (const res of streams) res.end()
    if (application.child) await application.stop()
    try { await store.flush() } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
    await lock.release()
  } }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const appMode = process.argv.includes('--production') ? 'runtime' : process.env.WORKBENCH_APP_MODE || 'development'
  const requestedPort = Number(process.env.WORKBENCH_PORT || 3211)
  const requestedAppPort = Number(process.env.WORKBENCH_APP_PORT || 3210)
  let app
  try {
    app = await createWorkbench({ port: requestedPort, appPort: requestedAppPort, dataDir: process.env.WORKBENCH_DATA_DIR || join(project, '.workbench'), appDataDir: process.env.DATA_DIR || join(project, 'data'), appMode })
  } catch (error) {
    console.error('工作台启动失败：' + error.message)
    process.exit(1)
  }
  const listeningPort = app.server.address().port
  if (requestedPort > 0 && listeningPort !== requestedPort) console.log(`端口 ${requestedPort} 已被占用，工作台改用 ${listeningPort}`)
  console.log(`Agent 工作台（应用${appMode === 'development' ? 'Vite 开发模式' : '正式构建模式'}）：`)
  console.log(`http://127.0.0.1:${listeningPort}/`)
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0) })
}
