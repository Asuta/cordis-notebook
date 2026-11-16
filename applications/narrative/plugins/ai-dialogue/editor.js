import { el, button, field, input, select } from './ui.js'

export function mountEditor(container, engine, connection) {
  let disposed = false
  const root = el('div', 'ne-ai-editor ne-stack')
  container.append(root)
  const projectFieldset = el('fieldset', 'ne-ai-fields ne-stack')
  const update = mutator => {
    if (disposed) return
    try { engine.update(mutator, { render: false }) } catch { engine.error('无法保存对话设置，请返回编辑器后重试') }
  }
  const world = input(engine.project.settings.worldInfo, value => update(project => { project.settings.worldInfo = value }), { multiline: true, maxLength: 16000 })
  projectFieldset.append(el('h3', 'ne-section-title', '作品世界设定'), field('世界信息', world, '随作品保存和导出；仅在真实 AI 对话时发送给模型。'))
  projectFieldset.append(el('p', 'ne-muted', '在场景搭建中选择角色会话对象，编辑角色、提示和预写回复。'))
  root.append(projectFieldset)

  const card = el('section', 'ne-card ne-stack')
  const connectionFields = el('fieldset', 'ne-ai-fields ne-stack')
  const draft = connection.draft
  const endpoint = input(draft.baseUrl, value => { draft.baseUrl = value }, { maxLength: 1500 })
  endpoint.placeholder = '填写服务商 API 根地址（通常以 /v1 结尾）'
  const model = input(draft.model, value => { draft.model = value }, { maxLength: 200 })
  model.placeholder = '填写服务商提供的模型名称'
  const protocol = select(draft.protocol, [['chat', 'Chat Completions'], ['responses', 'Responses']], value => { draft.protocol = value })
  const key = input(draft.apiKey, value => { draft.apiKey = value }, { type: 'password', maxLength: 4096 })
  key.autocomplete = 'new-password'
  key.spellcheck = false
  const clear = input('', () => {}, { type: 'checkbox' })
  clear.checked = !!draft.clearApiKey
  clear.addEventListener('change', () => { draft.clearApiKey = clear.checked; if (clear.checked) { draft.apiKey = ''; key.value = '' } })
  const keyStatus = el('p', 'ne-muted')
  const notice = el('p', 'ne-muted')
  notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite')
  const actions = el('div', 'ne-row')
  const save = button('保存连接', () => { void connection.save() }, 'ne-button ne-primary')
  const test = button('保存并测试连接', () => { void connection.test() })
  const reload = button('重新载入连接', () => { void connection.load() })
  actions.append(save, test, reload)
  connectionFields.append(field('接口地址', endpoint), field('模型名称', model), field('请求协议', protocol), field('API Key', key, '留空保留已保存的密钥。本机无鉴权模型可以不填。'), field('清除已保存的密钥', clear), keyStatus, actions)
  card.append(el('h3', 'ne-section-title', 'AI 连接'), el('p', 'ne-muted', '配置模型后可使用 AI 对话；离线体验请将角色会话的内容来源设为预写文本。密钥只保存在服务器私有设置中，不随作品导出。'), connectionFields, notice)
  root.prepend(card)
  const refresh = () => {
    if (disposed) return
    connectionFields.disabled = connection.busy || engine.mode !== 'edit' || engine.held
    projectFieldset.disabled = engine.mode !== 'edit' || engine.held
    keyStatus.textContent = connection.settings?.hasApiKey ? '服务器已保存密钥；浏览器不能读取。' : '服务器未保存密钥。'
    notice.textContent = connection.notice
    if (!connection.busy) {
      endpoint.value = draft.baseUrl; model.value = draft.model; protocol.value = draft.protocol
      clear.checked = draft.clearApiKey
      if (draft.apiKey === '') key.value = ''
    }
  }
  const unwatch = connection.watch(refresh)
  const owner = { cleanups: [], effect(fn) { const cleanup = fn(); if (cleanup) this.cleanups.push(cleanup) } }
  engine.observe(owner, refresh)
  refresh()
  return () => { disposed = true; unwatch(); for (const cleanup of owner.cleanups.reverse()) cleanup(); key.value = ''; root.remove() }
}
