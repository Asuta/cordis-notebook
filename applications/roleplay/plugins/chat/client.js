import { validateProject } from './model.js'
import { renderEditor } from './editor.js'
import { renderChat } from './chat.js'
import { button, el } from './ui.js'

const api = '/api/roleplay'
const sectionLabels = { chat: '对话', character: '人物卡', attributes: '属性编辑', world: '世界观', context: '上下文设置', model: '模型连接' }
const objectSchema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })

export default async function (ctx, sdk) {
  const root = el('main', 'rp-app'), notification = el('div', 'rp-toast')
  sdk.mount('app', root)
  let project = await sdk.request(api + '/project')
  let sessions = await sdk.request(api + '/sessions')
  let settings = await sdk.request(api + '/settings')
  let session = null
  let section = 'chat', localVersion = 0, saving = null, saveTimer = null, dirty = false, busy = false, pendingMessage = ''
  let editIndex = -1, draft = '', stopped = false, held = false, saveStatus = '已保存', activeTask = null
  let attachments = [], pendingImageCount = 0, streamText = '', streamController = null

  const sidebar = el('aside', 'rp-sidebar')
  const main = el('section', 'rp-main')
  const modalLayer = el('div', 'rp-modal-layer')
  root.append(sidebar, main, modalLayer, notification)

  function toast(message) {
    notification.textContent = message
    notification.classList.add('is-visible')
    clearTimeout(notification.timer)
    notification.timer = setTimeout(() => notification.classList.remove('is-visible'), 4500)
  }
  const request = (path, method, body) => sdk.request(api + path, method, body)

  async function runTask(action, { inert = true } = {}) {
    if (activeTask || held || stopped) return
    const task = Promise.resolve().then(action)
    activeTask = task
    main.inert = inert
    renderSidebar()
    try { return await task }
    finally {
      activeTask = null
      main.inert = held
      if (!stopped) { renderSidebar(); if (section === 'chat') showSection() }
    }
  }

  async function saveProject() {
    clearTimeout(saveTimer)
    if (saving) return saving
    if (!dirty || stopped) return
    saving = (async () => {
      while (dirty && !stopped) {
        const version = localVersion, snapshot = structuredClone(project)
        validateProject(snapshot)
        const saved = await request('/project', 'PUT', snapshot)
        if (stopped || project.id !== saved.id) return
        project.revision = saved.revision
        dirty = version !== localVersion
        saveStatus = dirty ? '正在保存…' : '已保存'
        renderSidebar()
        renderHeader()
      }
    })().catch(error => { saveStatus = '保存失败'; renderSidebar(); renderHeader(); throw error }).finally(() => { saving = null })
    return saving
  }

  function projectChanged(rerender = false) {
    if (held || stopped) return
    localVersion++
    dirty = true
    saveStatus = '正在保存…'
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveProject().catch(error => { saveStatus = '保存失败'; toast(error.message); renderHeader() }), 650)
    renderHeader()
    if (rerender) showSection()
  }

  async function reloadSessions() { sessions = await request('/sessions') }
  async function openSession(id) {
    session = await request('/sessions/' + encodeURIComponent(id))
    section = 'chat'; editIndex = -1
    if (!busy) { draft = ''; pendingMessage = ''; attachments = [] }
    renderSidebar(); showSection()
  }
  async function createSession(messages, customTitle) {
    await saveProject()
    const title = (customTitle || '与 ' + project.character.name + ' 的对话').slice(0, 120)
    const created = await request('/sessions', 'POST', { title, ...(messages ? { messages } : {}) })
    await reloadSessions()
    await openSession(created.id)
  }

  async function saveSettings({ silent = false } = {}) {
    const page = main.querySelector('.rp-editor-page')
    const key = page?.querySelector('input[type="password"]')?.value || ''
    const labels = [...(page?.querySelectorAll('.rp-toggle') || [])]
    const clear = labels.find(label => label.textContent.includes('清除已保存的密钥'))?.querySelector('input')?.checked || false
    try {
      const saved = await request('/settings', 'PUT', { protocol: settings.protocol || 'chat', baseUrl: settings.baseUrl, model: settings.model, apiKey: key, clearApiKey: clear })
      settings = { ...saved, testStatus: null }
      if (!silent) { toast('模型连接设置已保存'); showSection() }
      return true
    } catch (error) { toast(error.message); return false }
  }

  async function testSettings() {
    if (!(await saveSettings({ silent: true }))) return
    settings.testStatus = { ok: true, text: '正在测试连接…' }
    showSection()
    try {
      const result = await request('/settings/test', 'POST', {})
      settings.testStatus = { ok: true, text: '连接成功 · ' + result.model + ' · 模型回复：' + String(result.reply || '').slice(0, 60) }
    } catch (error) {
      settings.testStatus = { ok: false, text: '连接失败：' + error.message }
    }
    showSection()
  }

  function addAttachments(items) {
    if (!items?.length || held || stopped) return
    const room = 2 - attachments.length
    if (room <= 0) { toast('每条消息最多附带 2 张图片'); return }
    if (items.length > room) toast('每条消息最多附带 2 张图片，多余的已忽略')
    attachments = [...attachments, ...items.slice(0, room)]
    showSection()
  }

  function removeAttachment(id) {
    attachments = attachments.filter(item => item.id !== id)
    showSection()
  }

  function appendStreamText(text) {
    if (!text) return
    streamText += text
    const node = main.querySelector('.rp-stream-text')
    if (node) {
      node.textContent = streamText
      const box = main.querySelector('.rp-messages')
      if (box) box.scrollTop = box.scrollHeight
    } else showSection()
  }

  function stopGeneration() {
    streamController?.abort()
  }

  const stoppedError = () => Object.assign(Error('已停止生成'), { stopped: true })

  function beginStream() {
    const controller = new AbortController()
    streamController = controller
    return controller
  }

  async function generate(sessionId, body, onStream, controller) {
    if (controller.signal.aborted) throw stoppedError()
    try {
      return await sdk.stream('/api/roleplay/sessions/' + encodeURIComponent(sessionId) + '/stream', 'POST', body, event => {
        if (event?.type === 'delta') onStream(event.text)
      }, controller.signal)
    } catch (error) {
      if (controller.signal.aborted) throw stoppedError()
      throw error
    } finally { if (streamController === controller) streamController = null }
  }

  async function sendMessage(value, images) {
    const files = Array.isArray(images) ? images : []
    const content = String(value || '').trim() || (files.length ? '（发送了一张图片）' : '')
    if (!content || busy || !session) return
    if (!settings.hasApiKey) { toast('请先在“模型连接”中配置 API Key'); section = 'model'; showSection(); return }
    const replaceAt = editIndex, oldTitle = session.title
    pendingMessage = content; pendingImageCount = files.length; draft = ''; attachments = []; editIndex = -1; busy = true; streamText = ''
    const controller = beginStream()
    showSection()
    try {
      await saveProject()
      if (controller.signal.aborted) throw stoppedError()
      if (replaceAt >= 0) {
        const prefix = session.messages.slice(0, replaceAt).map(message => ({ ...message }))
        await createSession(prefix, '重写 · ' + oldTitle)
      }
      const sessionId = session.id
      if (controller.signal.aborted) throw stoppedError()
      session = await generate(sessionId, { mode: 'reply', message: content, ...(files.length ? { images: files } : {}) }, appendStreamText, controller)
      await reloadSessions()
      saveStatus = '已保存'
    } catch (error) {
      draft = content; attachments = files
      toast(error.stopped ? '已停止生成' : error.message)
    }
    finally { if (streamController === controller) streamController = null; pendingMessage = ''; pendingImageCount = 0; streamText = ''; busy = false; renderSidebar(); showSection() }
  }

  async function regenerate() {
    if (busy || !session) return
    busy = true; pendingMessage = ''; streamText = ''; showSection()
    const controller = beginStream()
    try {
      await saveProject()
      if (controller.signal.aborted) throw stoppedError()
      session = await generate(session.id, { mode: 'regenerate' }, appendStreamText, controller)
      await reloadSessions()
    } catch (error) { toast(error.stopped ? '已停止生成' : error.message) }
    finally { if (streamController === controller) streamController = null; streamText = ''; busy = false; showSection(); renderSidebar() }
  }

  async function branchAt(index) {
    if (!session || busy) return
    const messages = session.messages.slice(0, index + 1).map(message => ({ ...message }))
    try { await createSession(messages, '分支 · ' + session.title); toast('已从这条消息创建分支') } catch (error) { toast(error.message) }
  }

  function beginEdit(index) {
    editIndex = index; draft = session.messages[index]?.content || ''; attachments = []; showSection()
    main.querySelector('.rp-composer-input')?.focus()
  }

  async function previewContext() {
    try {
      await saveProject()
      const preview = await request('/context-preview', 'POST', { sessionId: session?.id })
      const close = () => modalLayer.replaceChildren()
      const dialog = el('section', 'rp-preview-dialog', el('header', '', el('div', '', el('span', 'rp-eyebrow', 'MODEL INPUT'), el('h2', '', '实际发送给 AI 的上下文')), button('×', close, 'rp-close-button')))
      dialog.setAttribute('role', 'dialog')
      dialog.setAttribute('aria-modal', 'true')
      dialog.setAttribute('aria-label', '实际发送给 AI 的上下文')
      dialog.querySelector('.rp-close-button').setAttribute('aria-label', '关闭上下文预览')
      const activeIds = new Set(preview.activeWorldInfoIds || [])
      const info = el('p', 'rp-preview-info', '消息数：' + (preview.messages || []).length + ' · 已激活世界信息：' + activeIds.size + ' 条')
      const list = el('div', 'rp-preview-messages')
      for (const message of preview.messages || []) list.append(el('article', 'rp-preview-message',
        el('strong', '', message.role + (message.imageCount ? ' · 附带 ' + message.imageCount + ' 张图片' : '')), el('pre', '', message.content || '')))
      dialog.append(info, list)
      modalLayer.replaceChildren(el('div', 'rp-modal-backdrop', dialog))
      modalLayer.firstElementChild.addEventListener('click', event => { if (event.target === modalLayer.firstElementChild) close() })
      dialog.addEventListener('keydown', event => { if (event.key === 'Escape') close() })
      dialog.querySelector('.rp-close-button').focus()
    } catch (error) { toast(error.message) }
  }

  function renderSidebar() {
    const avatar = project.character.name?.slice(0, 1) || '人'
    const brand = el('div', 'rp-brand', el('span', 'rp-brand-mark', '剧'), el('div', 'rp-brand-copy', el('strong', '', '角色剧场'), el('span', '', 'ROLEPLAY STUDIO')))
    const character = el('div', 'rp-sidebar-character', el('div', 'rp-avatar rp-avatar-large', avatar), el('div', '', el('strong', '', project.character.name || '未命名角色'), el('span', '', '单人角色扮演')))
    const nav = el('nav', 'rp-nav')
    for (const [id, label, icon] of [['chat','对话','◉'],['character','人物卡','◈'],['attributes','属性编辑','⊞'],['world','世界观','◎'],['context','上下文设置','≋'],['model','模型连接','⚙']]) {
      nav.append(button(el('span','rp-nav-icon',icon), () => { section = id; showSection() }, 'rp-nav-button' + (section === id ? ' is-active' : '')),)
      const item = nav.lastElementChild
      item.append(el('span','rp-nav-label',label))
      item.setAttribute('aria-label', label)
      item.title = label
    }
    const historyTitle = el('div', 'rp-history-title', el('span', '', '最近对话'), button('＋', () => runTask(() => createSession()).catch(error => toast(error.message)), 'rp-icon-button'))
    historyTitle.querySelector('button').setAttribute('aria-label', '新建对话')
    const history = el('div', 'rp-session-list')
    for (const item of sessions) history.append(button(el('span','rp-session-row',el('span','rp-session-dot','•'),el('span','rp-session-name',item.title || '新对话')),
      () => runTask(() => openSession(item.id)).catch(error => toast(error.message)), 'rp-session-button' + (session?.id === item.id ? ' is-active' : '')))
    sidebar.replaceChildren(brand, character, nav, historyTitle, history, el('div','rp-sidebar-footer',el('span','rp-online-dot'),el('span','','本地创作空间'),el('span','rp-save-state',saveStatus)))
    for (const control of sidebar.querySelectorAll('button')) control.disabled = !!activeTask || held
  }

  function renderHeader() {
    const title = section === 'chat' ? session?.title || '新的对话' : sectionLabels[section]
    const description = section === 'chat' ? '与 ' + project.character.name + ' 自由交谈' : project.title
    main.querySelector('.rp-topbar-title')?.replaceChildren(el('span','rp-eyebrow',section === 'chat' ? 'ROLEPLAY' : 'EDITOR'), el('h1','',''+title))
    const detail = main.querySelector('.rp-topbar-detail')
    if (detail) detail.textContent = description
    const status = main.querySelector('.rp-header-save')
    if (status) status.textContent = saveStatus
  }

  function showSection() {
    renderSidebar()
    main.replaceChildren()
    const topbar = el('header','rp-topbar',el('div','rp-topbar-title',el('span','rp-eyebrow',section === 'chat' ? 'ROLEPLAY' : 'EDITOR'),el('h1','',section === 'chat' ? session?.title || '新的对话' : sectionLabels[section])),
      el('p','rp-topbar-detail',section === 'chat' ? '与 ' + project.character.name + ' 自由交谈' : project.title),
      el('span','rp-header-save',saveStatus))
    main.append(topbar)
    if (section === 'chat') main.append(renderChat({ session, project, settings, busy: busy || !!activeTask, pending: busy, pendingMessage, pendingImages: pendingImageCount, streamText, editIndex, draft, attachments,
      onDraft: value => { draft = value }, onSend: (value, images) => runTask(() => sendMessage(value, images), { inert: false }), onStop: stopGeneration, onAttach: addAttachments, onRemoveAttachment: removeAttachment, onError: toast, onEdit: beginEdit, onBranch: (index, options) => runTask(() => options?.regenerate ? regenerate() : branchAt(index), { inert: false }), onCancelEdit: () => { editIndex = -1; draft = ''; showSection() } }))
    else main.append(renderEditor({ project, section, onChange: projectChanged, onPreview: () => runTask(previewContext), settings, onSaveSettings: () => runTask(saveSettings), onTestSettings: () => runTask(testSettings) }))
  }

  function registerAgentTools() {
    if (!sdk.agent?.register) return
    const str = { type: 'string' }, integer = { type: 'integer' }
    sdk.agent.register({ name: 'roleplay_read', description: '读取角色剧场当前人物卡、属性、世界信息、上下文设置、当前对话与模型连接状态（不含密钥）。编辑前先读取 localVersion。', inputSchema: objectSchema({}) }, () => ({ project: structuredClone(project), localVersion, session: session && structuredClone(session), settings: { protocol: settings.protocol, baseUrl: settings.baseUrl, model: settings.model, hasApiKey: settings.hasApiKey }, section }))
    sdk.agent.register({ name: 'roleplay_edit', description: '修改当前角色剧场项目内容并自动保存。先调用 roleplay_read；必须使用返回的 projectId/localVersion。operations: set_project{patch:{title?,description?}}、set_character{patch:{name,description,personality,background,scenario,greeting,exampleDialogue}}、set_context{patch:{systemPrompt,authorNote,maxHistoryMessages,temperature,maxTokens}}、upsert_attribute{value:完整属性}、remove_attribute{id}、upsert_world_info{value:完整世界条目}、remove_world_info{id}。不要修改模型密钥。', inputSchema: objectSchema({ projectId: str, localVersion: integer, operations: { type: 'array', minItems: 1, maxItems: 40, items: { type: 'object' } } }) }, async args => {
      if (activeTask || held || stopped || !project || args.projectId !== project.id || args.localVersion !== localVersion) throw Error('角色剧场内容已变化或正在处理对话，请稍后重新调用 roleplay_read')
      if (!Array.isArray(args.operations) || !args.operations.length || args.operations.length > 40) throw Error('请提供 1–40 个有效编辑操作')
      const next = structuredClone(project)
      const characterFields = ['name','description','personality','background','scenario','greeting','exampleDialogue']
      const contextFields = ['systemPrompt','authorNote','maxHistoryMessages','temperature','maxTokens']
      for (const op of args.operations) {
        if (op.type === 'set_project' && op.patch && Object.keys(op.patch).every(key => ['title','description'].includes(key))) Object.assign(next, op.patch)
        else if (op.type === 'set_character' && op.patch && Object.keys(op.patch).every(key => characterFields.includes(key))) Object.assign(next.character, op.patch)
        else if (op.type === 'set_context' && op.patch && Object.keys(op.patch).every(key => contextFields.includes(key))) Object.assign(next.context, op.patch)
        else if (op.type === 'upsert_attribute' && op.value) { const index = next.attributes.findIndex(item => item.id === op.value.id); if (index < 0) next.attributes.push(op.value); else next.attributes[index] = op.value }
        else if (op.type === 'remove_attribute' && typeof op.id === 'string') next.attributes = next.attributes.filter(item => item.id !== op.id)
        else if (op.type === 'upsert_world_info' && op.value) { const index = next.worldInfo.findIndex(item => item.id === op.value.id); if (index < 0) next.worldInfo.push(op.value); else next.worldInfo[index] = op.value }
        else if (op.type === 'remove_world_info' && typeof op.id === 'string') next.worldInfo = next.worldInfo.filter(item => item.id !== op.id)
        else throw Error('未知操作或字段：' + op.type)
      }
      validateProject(next)
      project = next; projectChanged(true)
      await saveProject()
      return { project: structuredClone(project), localVersion, saveStatus }
    })
  }

  registerAgentTools()
  if (sessions.length) session = await request('/sessions/' + encodeURIComponent(sessions[0].id))
  else { const created = await request('/sessions', 'POST', {}); await reloadSessions(); session = created }

  ctx.effect(() => () => { stopped = true; clearTimeout(saveTimer); clearTimeout(notification.timer) })
  ctx.on('plugins/before-stop', async requestStop => {
    held = true
    root.inert = true
    requestStop.hold(() => { held = false; root.inert = false; main.inert = false; renderSidebar() })
    clearTimeout(saveTimer)
    if (activeTask) await activeTask.catch(() => {})
    await saveProject()
  })
  ctx.on('plugins/remote-stop', () => { if (dirty) toast('编辑器已暂停；尚未保存的内容仍在页面中') })

  renderSidebar(); showSection()
}
