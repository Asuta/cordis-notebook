import { mountEditor } from './editor.js'

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
  const status = () => settings?.baseUrl && settings?.model ? '已保存 AI 连接；试玩使用真实模型回复。' : '尚未配置模型；AI 会话需要连接设置，离线体验请将会话来源设为预写文本。'
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
  ctx.sceneRuntime?.provide(ctx, 'ai', {
    async reply(payload,signal) {
      if(!connection.settings) await connection.load()
      if(!connection.settings?.baseUrl || !connection.settings?.model) throw Error('请在 AI 对话面板配置模型，或把会话内容来源改为预写文本')
      return sdk.request('/api/narrative/ai/reply','POST',payload,signal)
    }
  })
  ui.registerPanel(ctx, { id: 'chat.editor', label: 'AI 对话', icon: 'MessagesSquare', order: 60, render: container => mountEditor(container, engine, connection) })
  void connection.load()
}
