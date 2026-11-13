import { createChatController, demoReply, maxTurns, nextNode } from './chat.js'
import { mountEditor } from './editor.js'
import { button, el, field } from './ui.js'

function createConnection(ctx, sdk) {
  let settings = null, busy = false, stopped = false, notice = '正在载入连接设置…'
  const draft = { model: '', baseUrl: '', protocol: 'chat', apiKey: '', clearApiKey: false }
  const listeners = new Set()
  const notify = () => { for (const fn of listeners) fn() }
  const accept = value => {
    if (!value || typeof value.model !== 'string' || typeof value.baseUrl !== 'string' || !['chat', 'responses'].includes(value.protocol) || typeof value.hasApiKey !== 'boolean') throw Error('invalid settings')
    // Whitelist public fields even if a future backend accidentally adds others.
    settings = { model: value.model, baseUrl: value.baseUrl, protocol: value.protocol, hasApiKey: value.hasApiKey, ...(Number.isSafeInteger(value.revision) ? { revision: value.revision } : {}) }
    Object.assign(draft, { model: settings.model, baseUrl: settings.baseUrl, protocol: settings.protocol, apiKey: '', clearApiKey: false })
  }
  const status = () => settings?.baseUrl && settings?.model ? '已保存 AI 连接；试玩使用真实模型回复。' : '示例对话：接口或模型未填写，试玩使用作者编写的示例回复。'
  async function operate(task, failure) {
    if (busy || stopped) return
    busy = true; notice = '正在处理连接设置…'; notify()
    try { await task(); return true }
    catch { if (!stopped) notice = failure; return false }
    finally { if (!stopped) { busy = false; notify() } }
  }
  const saveSettings = async () => {
    const result = await sdk.request('/api/narrative/ai/settings', 'PUT', { model: draft.model.trim(), baseUrl: draft.baseUrl.trim(), protocol: draft.protocol,
      ...(draft.apiKey ? { apiKey: draft.apiKey } : {}), clearApiKey: draft.clearApiKey, ...(settings?.revision === undefined ? {} : { revision: settings.revision }) })
    if (!stopped) { accept(result); notice = status() }
  }
  ctx.effect(() => () => { stopped = true; draft.apiKey = ''; listeners.clear() })
  return {
    draft, get settings() { return settings }, get busy() { return busy }, get notice() { return notice },
    watch(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    load: () => operate(async () => { const result = await sdk.request('/api/narrative/ai/settings'); if (!stopped) { accept(result); notice = status() } }, '连接设置载入失败；请重新载入后再试玩，当前不会自动使用示例回复。'),
    save: () => operate(saveSettings, '连接设置保存失败；请检查地址、协议、密钥或重新载入后重试。'),
    test: () => operate(async () => {
      await saveSettings()
      if (stopped) return
      notice = '正在测试已保存的连接…'; notify()
      const result = await sdk.request('/api/narrative/ai/test', 'POST', {})
      if (!stopped) notice = result?.ok ? '连接测试成功。' : '连接测试未成功，请检查设置。'
    }, '连接测试失败；请检查已保存的接口地址、模型、协议、密钥和网络。'),
  }
}

export default function (ctx, sdk) {
  const engine = sdk.service('narrative'), ui = sdk.service('narrativeUI')
  const connection = createConnection(ctx, sdk)
  const updates = new Set()
  const changed = () => { for (const fn of updates) fn() }
  const controller = createChatController(ctx, engine, (...args) => sdk.request(...args), () => connection.settings, changed)
  const stopWatch = connection.watch(changed)
  ctx.effect(() => () => { stopWatch(); updates.clear() })
  ctx.on('plugins/before-stop', () => { controller.cancel() })
  ctx.on('plugins/remote-stop', () => { controller.cancel() })
  const abort = () => controller.cancel()
  sdk.signal?.addEventListener('abort', abort, { once: true })
  ctx.effect(() => () => sdk.signal?.removeEventListener('abort', abort))
  ui.registerPanel(ctx, { id: 'chat.editor', label: 'AI 对话', icon: 'MessagesSquare', order: 60, render: container => mountEditor(container, engine, connection) })
  ui.registerSurface(ctx, { id: 'chat.composer', order: 80, mount(container) {
    const root = el('section', 'ne-ai-composer ne-stack')
    const badge = el('span', 'ne-badge')
    const count = el('span', 'ne-muted')
    const header = el('div', 'ne-row')
    header.append(badge, count)
    const history = el('div', 'ne-ai-transcript')
    history.setAttribute('role', 'log'); history.setAttribute('aria-label', '聊天记录'); history.setAttribute('aria-live', 'polite')
    const textarea = el('textarea', 'ne-textarea')
    textarea.rows = 2; textarea.maxLength = 4000; textarea.placeholder = '说点什么…（Enter 发送，Shift+Enter 换行）'
    const send = button('发送', () => { void submit() }, 'ne-button ne-primary')
    const proceed = button('继续剧情', () => { const node = engine.scene(); if (node?.type === 'chat') void controller.continueStory(node) })
    const cancel = button('取消本轮', () => { controller.cancel(); refresh() })
    const controls = el('div', 'ne-row')
    controls.append(send, cancel, proceed)
    const notice = el('p', 'ne-muted')
    notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite')
    root.append(header, history, field('给角色发送消息', textarea), controls, notice)
    container.append(root)
    let disposed = false, identity = null, nodeId = '', transcriptSignature = ''
    async function submit() {
      if (textarea.disabled || send.disabled) return
      const runtime = engine.runtime, sceneId = runtime?.nodeId, content = textarea.value
      const success = await controller.send(content)
      if (!disposed && success && engine.runtime === runtime && runtime?.nodeId === sceneId && textarea.value === content) textarea.value = ''
      if (!disposed) refresh()
    }
    textarea.addEventListener('input', () => { send.disabled = textarea.disabled || !textarea.value.trim() })
    textarea.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void submit() }
    })
    function refresh() {
      if (disposed) return
      const runtime = engine.runtime, node = engine.scene()
      const visible = engine.mode === 'play' && runtime && node?.type === 'chat'
      root.hidden = !visible; container.hidden = !visible
      if (runtime !== identity || runtime?.nodeId !== nodeId) { identity = runtime; nodeId = runtime?.nodeId || ''; textarea.value = ''; transcriptSignature = '' }
      if (!visible) return
      const settings = connection.settings, live = !!(settings?.baseUrl && settings?.model)
      const limit = maxTurns(node), turns = runtime.chatTurns || 0
      const available = live || !!demoReply(node, turns)
      badge.textContent = settings ? live ? '真实 AI 对话' : '示例对话' : '连接设置未载入'
      count.textContent = turns + ' / ' + limit + ' 轮'
      textarea.disabled = !settings || connection.busy || runtime.busy || runtime.ended || engine.held || turns >= limit || !available
      send.disabled = textarea.disabled || !textarea.value.trim()
      cancel.hidden = !runtime.busy
      proceed.textContent = node.chat?.label || '继续剧情'
      proceed.hidden = !nextNode(node) || !!node.choices?.length
      proceed.disabled = !!runtime.busy || !!runtime.ended || engine.held
      notice.textContent = runtime.error || (!settings ? '请在 AI 对话面板重新载入连接设置。' : runtime.busy ? live ? '角色正在回复…' : '正在显示作者编写的示例回复…' : turns >= limit ? '本节点对话已完成，请继续剧情或选择剧情分支。' : !available ? '本轮没有作者编写的示例回复，请继续剧情或在编辑器补充。' : live ? '回复由已配置的模型生成。属性与剧情由作品规则决定。' : '示例对话：按轮次显示作者编写的固定回复，不会调用模型。')
      const transcript = runtime.transcript || []
      const signature = JSON.stringify(transcript)
      if (signature !== transcriptSignature) {
        transcriptSignature = signature
        history.replaceChildren()
        for (const item of transcript.slice(-80)) {
          const row = el('article', 'ne-ai-message')
          row.dataset.role = item.role
          row.append(el('strong', '', item.name || (item.role === 'user' ? '你' : item.role === 'narrator' ? '旁白' : '角色')), el('p', '', item.text || ''))
          history.append(row)
        }
        history.scrollTop = history.scrollHeight
      }
    }
    const owner = { cleanups: [], effect(fn) { const cleanup = fn(); if (cleanup) this.cleanups.push(cleanup) } }
    engine.observe(owner, refresh)
    updates.add(refresh)
    refresh()
    return () => { disposed = true; updates.delete(refresh); for (const cleanup of owner.cleanups.reverse()) cleanup(); root.remove(); container.hidden = false }
  } })
  void connection.load()
}
