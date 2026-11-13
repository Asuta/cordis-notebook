import { emptyMemory, normalizeProject, normalizeSession, validateMemory, validatePlayer, validateProject } from './model.js'
import { renderEditor } from './editor.js'
import { renderChat } from './chat.js'
import { button, el } from './ui.js'
import { applyAtmosphere, narrative } from './experience.js'
import { memoryFields, openingFields, playerFields } from './story-editor.js'

const api = '/api/roleplay'
const sectionLabels = { chat: '对话', character: '人物卡', player: '玩家身份', opening: '开场情境', visual: '画面与氛围', attributes: '属性编辑', world: '世界观', context: '上下文设置', model: '模型连接', settings: '设置' }
const objectSchema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })

export default async function (ctx, sdk) {
  const root = el('main', 'rp-app'), notification = el('div', 'rp-toast')
  sdk.mount('app', root)
  let project = normalizeProject(await sdk.request(api + '/project'))
  let sessions = await sdk.request(api + '/sessions')
  let settings = await sdk.request(api + '/settings')
  let session = null
  let section = 'chat', localVersion = 0, saving = null, saveTimer = null, dirty = false, busy = false, pendingMessage = ''
  let editIndex = -1, draft = '', stopped = false, held = false, saveStatus = '已保存', activeTask = null
  let attachments = [], pendingImageCount = 0, streamText = '', streamController = null
  let suggestions = [], suggesting = false, lastEditor = 'character', previewMode = 'opening', previewVisible = false
  let trial = { messages: [], draft: '', busy: false, error: '', version: -1 }

  const sidebar = el('aside', 'rp-sidebar')
  const main = el('section', 'rp-main')
  const modalLayer = el('div', 'rp-modal-layer')
  const mobileNav = el('nav', 'rp-mobile-nav')
  mobileNav.setAttribute('aria-label', '移动导航')
  const drawerBackdrop = button('', () => root.classList.remove('is-menu-open'), 'rp-drawer-backdrop')
  drawerBackdrop.setAttribute('aria-label', '关闭导航')
  root.append(sidebar, drawerBackdrop, main, mobileNav, modalLayer, notification)

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
      if (!stopped) { renderSidebar(); if (section === 'chat') showSection(); else refreshPreview() }
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
    refreshPreview()
    if (rerender) showSection()
  }

  async function reloadSessions() { sessions = await request('/sessions') }
  async function openSession(id) {
    session = normalizeSession(await request('/sessions/' + encodeURIComponent(id)), project)
    section = 'chat'; editIndex = -1
    suggestions = []
    root.classList.remove('is-menu-open')
    if (!busy) { draft = ''; pendingMessage = ''; attachments = [] }
    renderSidebar(); showSection()
  }
  async function createSession(messages, customTitle, options = {}) {
    await saveProject()
    const title = (customTitle || '与 ' + project.character.name + ' 的对话').slice(0, 120)
    const created = await request('/sessions', 'POST', { title, ...(messages ? { messages, sourceSessionId: session?.id } : {}), ...options })
    await reloadSessions()
    await openSession(created.id)
  }

  async function saveSettings({ silent = false } = {}) {
    const page = main.querySelector('.rp-editor-page')
    const key = page?.querySelector('input[type="password"]')?.value || ''
    const labels = [...(page?.querySelectorAll('.rp-toggle') || [])]
    const clear = labels.find(label => label.textContent.includes('清除已保存的密钥'))?.querySelector('input')?.checked || false
    try {
      const saved = await request('/settings', 'PUT', { protocol: settings.protocol || 'chat', baseUrl: settings.baseUrl, model: settings.model, apiKey: key, clearApiKey: clear,
        reasoningEffort: settings.reasoningEffort || 'default', timeoutSeconds: Number(settings.timeoutSeconds) || 120, stream: settings.stream !== false })
      settings = { ...saved, testStatus: null }
      if (!silent) { toast('设置已保存'); showSection() }
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
      node.replaceChildren(narrative(streamText))
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
    suggestions = []
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
      session = settings.stream === false
        ? await request('/sessions/' + encodeURIComponent(sessionId) + '/reply', 'POST', { message: content, ...(files.length ? { images: files } : {}) })
        : await generate(sessionId, { mode: 'reply', message: content, ...(files.length ? { images: files } : {}) }, appendStreamText, controller)
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
      session = settings.stream === false
        ? await request('/sessions/' + encodeURIComponent(session.id) + '/regenerate', 'POST', {})
        : await generate(session.id, { mode: 'regenerate' }, appendStreamText, controller)
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

  function navigate(next) {
    if (activeTask || held) return
    if (!['chat', 'model', 'settings'].includes(next)) lastEditor = next
    section = next
    root.classList.remove('is-menu-open')
    showSection()
  }

  function dialog(title, content, actions = []) {
    root.classList.remove('is-menu-open')
    const focused = document.activeElement
    const close = () => { modalLayer.replaceChildren(); focused?.focus?.() }
    const dismiss = button('×', close, 'rp-close-button'); dismiss.setAttribute('aria-label', '关闭' + title)
    const panel = el('section', 'rp-preview-dialog rp-story-dialog', el('header', '', el('div', '', el('span', 'rp-eyebrow', 'STORY STUDIO'), el('h2', '', title)), dismiss),
      el('div', 'rp-dialog-content', content), el('footer', 'rp-dialog-footer', button('取消', close, 'rp-button rp-button-secondary'), ...actions))
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', title)
    const backdrop = el('div', 'rp-modal-backdrop', panel)
    backdrop.addEventListener('click', event => { if (event.target === backdrop) close() })
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.stopPropagation(); close() }
      if (event.key === 'Tab') {
        const controls = [...panel.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)')]
        const first = controls[0], last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    })
    modalLayer.replaceChildren(backdrop)
    dismiss.focus()
    return { close, panel }
  }

  function newStory() {
    if (activeTask) return
    const player = structuredClone(project.player), opening = structuredClone(project.opening)
    const content = el('div', '', el('p', 'rp-dialog-intro', '选择这一次的身份与第一幕。每段故事独立保存进展和记忆。'),
      el('h3', '', '你将扮演谁'), playerFields(player, () => {}), el('h3', '', '故事从这里开始'), openingFields(opening, () => {}))
    const errorText = el('p', 'rp-inline-error'); errorText.setAttribute('role', 'alert'); content.append(errorText)
    const start = button('进入故事 →', async () => {
      start.disabled = true
      try {
        await runTask(() => createSession(undefined, opening.title || project.title, { player, opening }))
        view.close()
      } catch (error) { errorText.textContent = error.message }
      finally { start.disabled = false }
    }, 'rp-button rp-button-primary')
    const view = dialog('开始新的故事', content, [start])
  }

  function editStory(kind) {
    if (!session || activeTask) return
    const sessionId = session.id, revision = session.revision
    let value = structuredClone(kind === 'player' ? session.player || project.player : session.memory || emptyMemory())
    const fields = el('div'), notice = el('p', 'rp-dialog-intro', kind === 'player' ? '只修改当前故事中的玩家身份，后续回复会使用新的身份。' : '这些内容属于当前故事，每轮都会提供给 AI。关闭的条目不进入上下文。')
    const errorText = el('p', 'rp-inline-error'); errorText.setAttribute('role', 'alert')
    const rebuild = () => fields.replaceChildren(kind === 'player' ? playerFields(value, () => {}) : memoryFields(value, () => {}))
    const content = el('div', '', notice, fields, errorText)
    const save = button('保存并生效', async () => {
      save.disabled = true
      try {
        if (kind === 'player') validatePlayer(value); else validateMemory(value)
        await runTask(async () => {
          session = await request('/sessions/' + encodeURIComponent(sessionId) + '/state', 'PUT', { revision, [kind]: value })
          suggestions = []; await reloadSessions()
        })
        view.close(); toast(kind === 'player' ? '当前故事的玩家身份已更新' : '剧情记忆已保存，将用于后续对话')
      } catch (error) { errorText.textContent = error.message }
      finally { save.disabled = false }
    }, 'rp-button rp-button-primary')
    if (kind === 'memory') {
      const organize = button('✧ 从对话整理候选记忆', async () => {
        organize.disabled = true; save.disabled = true; organize.textContent = '正在整理…'
        try {
          await saveProject()
          const result = await runTask(() => request('/sessions/' + encodeURIComponent(sessionId) + '/memory-draft', 'POST', {}), { inert: true })
          if (!view.panel.isConnected || !result) return
          value = result.memory; rebuild(); notice.textContent = 'AI 整理草稿 · 尚未保存。请核对事实、补充遗漏，点击“保存并生效”后才会用于对话。'
        } catch (error) { if (view.panel.isConnected) errorText.textContent = error.message }
        finally { organize.disabled = false; save.disabled = false; organize.textContent = '✧ 从对话整理候选记忆' }
      }, 'rp-button rp-button-secondary')
      content.prepend(organize)
    }
    rebuild()
    const view = dialog(kind === 'player' ? '当前玩家身份' : '剧情记忆', content, [save])
  }

  async function inspire() {
    if (suggesting || busy || !session) return
    suggesting = true; suggestions = []; showSection()
    try {
      await saveProject()
      const result = await request('/sessions/' + encodeURIComponent(session.id) + '/suggestions', 'POST', {})
      suggestions = result.suggestions
    } catch (error) { toast(error.message) }
    finally { suggesting = false; showSection() }
  }

  function trialSession() {
    const messages = trial.messages.length ? trial.messages : project.character.greeting.trim() ? [{ id: 'preview-opening', role: 'assistant', content: project.character.greeting, createdAt: new Date().toISOString() }] : []
    return { player: project.player, opening: project.opening, messages }
  }

  async function trialSend(value) {
    if (!value.trim() || trial.busy) return
    trial.busy = true; trial.error = ''; trial.draft = value; refreshPreview()
    try {
      const version = localVersion
      const result = await request('/playtest', 'POST', { project: structuredClone(project), messages: trialSession().messages, message: value })
      trial.messages = result.messages; trial.draft = ''; trial.version = version
    } catch (error) { trial.error = error.message }
    finally { trial.busy = false; refreshPreview() }
  }

  function refreshPreview() {
    const pane = main.querySelector('.rp-live-preview')
    if (!pane) return
    applyAtmosphere(pane, project)
    const tabs = el('div', 'rp-preview-tabs',
      button('开场预览', () => { previewMode = 'opening'; refreshPreview() }, previewMode === 'opening' ? 'is-active' : ''),
      button('试聊', () => { previewMode = 'trial'; refreshPreview() }, previewMode === 'trial' ? 'is-active' : ''))
    const note = el('div', 'rp-preview-note', previewMode === 'opening' ? '随编辑实时更新 · 不影响已有故事' : '使用当前设定 · 试聊不会写入正式故事',
      previewMode === 'trial' && button('重新试聊', () => { trial = { messages: [], draft: '', busy: false, error: '', version: -1 }; refreshPreview() }, 'rp-text-button'))
    if (trial.busy) for (const control of [...tabs.querySelectorAll('button'), ...note.querySelectorAll('button')]) control.disabled = true
    const current = previewMode === 'opening' ? { ...trialSession(), messages: project.character.greeting.trim() ? [{ id: 'opening', role: 'assistant', content: project.character.greeting }] : [] } : trialSession()
    const chat = renderChat({ compact: true, session: current, project, settings, busy: trial.busy, pending: trial.busy, canStop: false, draft: trial.draft, editIndex: -1,
      onDraft: value => { trial.draft = value }, onSend: value => { previewMode = 'trial'; return runTask(() => trialSend(value), { inert: false }) }, onError: toast })
    if (previewMode === 'opening') {
      chat.querySelector('.rp-composer-input').placeholder = '输入一句话，开始试聊当前设定…'
    }
    const status = trial.error || (trial.version >= 0 && trial.version !== localVersion ? '设定已更新，下一次回复会使用最新内容。' : '')
    pane.replaceChildren(el('div', 'rp-live-preview-title', el('span', 'rp-eyebrow', 'LIVE PREVIEW'), el('h2', '', '在故事里看看')), tabs, note, status && el('p', 'rp-preview-status', status), chat)
  }

  function renderSidebar() {
    const avatar = project.character.name?.slice(0, 1) || '人'
    const brand = el('div', 'rp-brand', el('span', 'rp-brand-mark', '剧'), el('div', 'rp-brand-copy', el('strong', '', '角色剧场'), el('span', '', 'ROLEPLAY STUDIO')))
    const character = el('div', 'rp-sidebar-character', el('div', 'rp-avatar rp-avatar-large', avatar), el('div', '', el('strong', '', project.character.name || '未命名角色'), el('span', '', '单人角色扮演')))
    const nav = el('nav', 'rp-nav')
    for (const [id, label, icon] of [['chat','对话','◉'],['character','人物卡','◈'],['player','玩家身份','◇'],['opening','开场情境','▤'],['visual','画面与氛围','◐'],['attributes','属性编辑','⊞'],['world','世界观','◎'],['context','上下文设置','≋'],['model','模型连接','⇄'],['settings','设置','⚙']]) {
      nav.append(button(el('span','rp-nav-icon',icon), () => navigate(id), 'rp-nav-button' + (section === id ? ' is-active' : '')),)
      const item = nav.lastElementChild
      item.append(el('span','rp-nav-label',label))
      item.setAttribute('aria-label', label)
      item.title = label
    }
    const historyTitle = el('div', 'rp-history-title', el('span', '', '我的故事'), button('＋', newStory, 'rp-icon-button'))
    historyTitle.querySelector('button').setAttribute('aria-label', '新建对话')
    const history = el('div', 'rp-session-list')
    for (const item of sessions) history.append(button(el('span','rp-session-row',el('span','rp-session-dot','•'),el('span','rp-session-name',item.title || '新对话')),
      () => runTask(() => openSession(item.id)).catch(error => toast(error.message)), 'rp-session-button' + (session?.id === item.id ? ' is-active' : '')))
    sidebar.replaceChildren(brand, character, nav, historyTitle, history, el('div','rp-sidebar-footer',el('span','rp-online-dot'),el('span','','本地创作空间'),el('span','rp-save-state',saveStatus)))
    for (const control of sidebar.querySelectorAll('button')) control.disabled = !!activeTask || held
    mobileNav.replaceChildren(
      button('◉ 故事', () => navigate('chat'), section === 'chat' ? 'is-active' : ''),
      button('◈ 创作', () => navigate(lastEditor), section !== 'chat' && !['model','settings'].includes(section) ? 'is-active' : ''),
      button('≋ 记忆', () => editStory('memory'), ''),
      button('⚙ 设置', () => navigate('settings'), section === 'settings' ? 'is-active' : ''))
    for (const control of mobileNav.querySelectorAll('button')) control.disabled = !!activeTask || held
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
    root.dataset.view = section === 'chat' ? 'play' : 'edit'
    main.replaceChildren()
    const topbar = el('header','rp-topbar',el('div','rp-topbar-title',el('span','rp-eyebrow',section === 'chat' ? 'ROLEPLAY' : 'EDITOR'),el('h1','',section === 'chat' ? session?.title || '新的对话' : sectionLabels[section])),
      el('p','rp-topbar-detail',section === 'chat' ? '与 ' + project.character.name + ' 自由交谈' : project.title),
      el('span','rp-header-save',saveStatus))
    const menu = button('☰', () => root.classList.toggle('is-menu-open'), 'rp-menu-button'); menu.setAttribute('aria-label', '打开导航')
    topbar.prepend(menu)
    const topActions = el('div', 'rp-topbar-actions', section === 'chat'
      ? button('◈ 编辑故事', () => navigate(lastEditor), 'rp-button rp-button-secondary')
      : button('◉ 回到故事', () => navigate('chat'), 'rp-button rp-button-secondary'),
      section === 'chat' ? button('＋ 新故事', newStory, 'rp-button rp-button-primary')
        : button(previewVisible ? '收起预览' : '预览 / 试聊', () => {
          previewVisible = !previewVisible
          main.querySelector('.rp-editor-layout')?.classList.toggle('show-preview', previewVisible)
          main.querySelector('.rp-preview-toggle').textContent = previewVisible ? '收起预览' : '预览 / 试聊'
        }, 'rp-button rp-preview-toggle'))
    topbar.append(topActions)
    main.append(topbar)
    if (section === 'chat') {
      const chat = renderChat({ session, project, settings, busy: busy || !!activeTask, pending: busy, canStop: settings.stream !== false, pendingMessage, pendingImages: pendingImageCount, streamText, editIndex, draft, attachments, suggestions,
      onInspire: () => runTask(inspire, { inert: false }), onSuggestion: value => { draft = value; showSection(); main.querySelector('.rp-composer-input')?.focus() }, onMemory: () => editStory('memory'), onPlayer: () => editStory('player'),
      onDraft: value => { draft = value }, onSend: (value, images) => runTask(() => sendMessage(value, images), { inert: false }), onStop: stopGeneration, onAttach: addAttachments, onRemoveAttachment: removeAttachment, onError: toast, onEdit: beginEdit, onBranch: (index, options) => runTask(() => options?.regenerate ? regenerate() : branchAt(index), { inert: false }), onCancelEdit: () => { editIndex = -1; draft = ''; showSection() } })
      if (suggesting) { const control = chat.querySelector('.rp-inspire-button'); if (control) control.textContent = '正在寻找灵感…' }
      main.append(chat)
    } else {
      const workspace = el('div', 'rp-editor-layout' + (previewVisible ? ' show-preview' : '')),
        preview = el('aside', 'rp-live-preview')
      preview.setAttribute('aria-label', '实时预览与试聊')
      workspace.append(renderEditor({ project, section, onChange: projectChanged, onPreview: () => runTask(previewContext), settings, onSaveSettings: () => runTask(saveSettings), onTestSettings: () => runTask(testSettings), onError: toast }), preview)
      main.append(workspace); refreshPreview()
    }
  }

  function registerAgentTools() {
    if (!sdk.agent?.register) return
    const str = { type: 'string' }, integer = { type: 'integer' }
    sdk.agent.register({ name: 'roleplay_read', description: '读取角色剧场当前人物卡、属性、世界信息、上下文设置、当前对话与模型调用参数（不含密钥）。编辑前先读取 localVersion。', inputSchema: objectSchema({}) }, () => ({ project: structuredClone(project), localVersion, session: session && structuredClone(session), settings: { protocol: settings.protocol, baseUrl: settings.baseUrl, model: settings.model, hasApiKey: settings.hasApiKey, reasoningEffort: settings.reasoningEffort, timeoutSeconds: settings.timeoutSeconds, stream: settings.stream }, section }))
    sdk.agent.register({ name: 'roleplay_edit', description: '修改角色剧场作品并自动保存。先 roleplay_read，使用 projectId/localVersion。operations: set_project{patch:{title?,description?}}、set_character{patch:{name,description,personality,background,scenario,greeting,exampleDialogue}}、set_player{patch:{name,description,relationship}}、set_opening{patch:{title,location,time,situation}}、set_presentation{patch:{portrait,background,theme}}、set_context{patch:{systemPrompt,authorNote,maxHistoryMessages,temperature,maxTokens}}、upsert_attribute{value:完整属性}、remove_attribute{id}、upsert_world_info{value:完整世界条目}、remove_world_info{id}。图片只接受PNG/JPEG/WebP data URL；不要修改模型密钥。', inputSchema: objectSchema({ projectId: str, localVersion: integer, operations: { type: 'array', minItems: 1, maxItems: 40, items: { type: 'object' } } }) }, async args => {
      if (activeTask || held || stopped || !project || args.projectId !== project.id || args.localVersion !== localVersion) throw Error('角色剧场内容已变化或正在处理对话，请稍后重新调用 roleplay_read')
      if (!Array.isArray(args.operations) || !args.operations.length || args.operations.length > 40) throw Error('请提供 1–40 个有效编辑操作')
      const next = structuredClone(project)
      const characterFields = ['name','description','personality','background','scenario','greeting','exampleDialogue']
      const contextFields = ['systemPrompt','authorNote','maxHistoryMessages','temperature','maxTokens']
      for (const op of args.operations) {
        if (op.type === 'set_project' && op.patch && Object.keys(op.patch).every(key => ['title','description'].includes(key))) Object.assign(next, op.patch)
        else if (op.type === 'set_character' && op.patch && Object.keys(op.patch).every(key => characterFields.includes(key))) Object.assign(next.character, op.patch)
        else if (op.type === 'set_context' && op.patch && Object.keys(op.patch).every(key => contextFields.includes(key))) Object.assign(next.context, op.patch)
        else if (op.type === 'set_player' && op.patch && Object.keys(op.patch).every(key => ['name','description','relationship'].includes(key))) Object.assign(next.player, op.patch)
        else if (op.type === 'set_opening' && op.patch && Object.keys(op.patch).every(key => ['title','location','time','situation'].includes(key))) Object.assign(next.opening, op.patch)
        else if (op.type === 'set_presentation' && op.patch && Object.keys(op.patch).every(key => ['portrait','background','theme'].includes(key))) Object.assign(next.presentation, op.patch)
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
    sdk.agent.register({ name: 'roleplay_edit_session', description: '修改当前故事的玩家身份或剧情记忆。先roleplay_read；必须使用当前sessionId和revision。patch可包含完整player{name,description,relationship}或完整memory{summary,scene,relationship,facts:[{id,content,enabled}]}。不修改对话消息或模型密钥。', inputSchema: objectSchema({ sessionId: str, revision: integer, patch: { type: 'object' } }) }, async args => {
      if (activeTask || held || stopped || !session || args.sessionId !== session.id || args.revision !== session.revision || modalLayer.childElementCount) throw Error('会话已变化或正在编辑，请重新调用 roleplay_read')
      if (!args.patch || !Object.keys(args.patch).length || Object.keys(args.patch).some(key => !['player','memory'].includes(key))) throw Error('会话编辑字段无效')
      if (args.patch.player !== undefined) validatePlayer(args.patch.player)
      if (args.patch.memory !== undefined) validateMemory(args.patch.memory)
      return runTask(async () => {
        session = await request('/sessions/' + encodeURIComponent(session.id) + '/state', 'PUT', { revision: args.revision, ...args.patch })
        suggestions = []; await reloadSessions()
        return { session: structuredClone(session) }
      })
    })
  }

  registerAgentTools()
  if (sessions.length) session = normalizeSession(await request('/sessions/' + encodeURIComponent(sessions[0].id)), project)
  else { const created = await request('/sessions', 'POST', {}); await reloadSessions(); session = normalizeSession(created, project) }

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
