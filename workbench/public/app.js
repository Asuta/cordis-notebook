import { createMessage, createTurn, updateTurn, developmentStatus } from './timeline.js'
const $ = id => document.getElementById(id)
const frame = $('application'), standalone = location.pathname === '/chat', clientId = crypto.randomUUID()
let state, config, binding, lastPageAppId, threadId = sessionStorage.getItem('agent-thread') || '', appId = sessionStorage.getItem('agent-app') || ''
let attachments = [], images = [], appOrigin, toastTimer, polling = false, uploading = 0, submitting = false, renderedThread, renderTimer
let promptRevision = 0, pendingImages = new Set()
const rows = new Map()
const browserDrafts = new Map()
let preferenceQueue = Promise.resolve()
let preferenceWrites = 0
const browserChoiceKey = () => threadId || 'new:' + appId
const browserChoice = () => browserDrafts.get(browserChoiceKey())?.enabled ?? current()?.browserVerificationEnabled ?? false
document.body.classList.toggle('standalone', standalone)
let closingAnimation, chatShown = false
const motion = () => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const showChat = () => {
  const opening = $('chat').hidden
  closingAnimation?.cancel(); $('chat').hidden = false; $('launcher').hidden = true; $('badge').hidden = true
  if (opening && motion() && !standalone) $('chat').animate?.([{ opacity: 0, translate: '0 14px', scale: '.985' }, { opacity: 1, translate: '0 0', scale: '1' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' })
  if (!chatShown) { $('messages').scrollTop = $('messages').scrollHeight; followButton(); chatShown = true }
  resizePrompt()
}
const hideChat = () => {
  const finish = () => { $('chat').hidden = true; $('launcher').hidden = false; $('launcher').focus() }
  if (!motion() || !$('chat').animate) return finish()
  closingAnimation = $('chat').animate([{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: '0 10px' }], { duration: 160, easing: 'ease-in' })
  closingAnimation.onfinish = finish
}
function resizePrompt() { const input = $('prompt'); input.style.height = 'auto'; input.style.height = Math.max(64, Math.min(180, input.scrollHeight)) + 'px' }
function followButton() { const box = $('messages'); $('latest').hidden = box.scrollHeight - box.scrollTop - box.clientHeight < 100 }
if (standalone) showChat()
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 8000) }
async function api(path, data) {
  const response = await fetch('/api/' + path, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
  const result = await response.json(); if (!response.ok) throw Error(result.error || '请求失败'); return result
}
const safe = action => async event => { try { await action(event) } catch (error) { toast(error.message) } }
const removeDraftImage = id => pendingImages.has(id) ? Promise.resolve() : api('images/remove', { id })
function current() { return state?.threads.find(t => t.id === threadId) }
function upsert(thread) {
  const index = state.threads.findIndex(t => t.id === thread.id), previous = state.threads[index]
  if (previous && (previous.revision || 0) > (thread.revision || 0)) return
  if (index < 0) state.threads.push(thread); else state.threads[index] = thread
  if (thread.running) state.activeThreadId = thread.id; else if (state.activeThreadId === thread.id) state.activeThreadId = null
}
function renderThreads() {
  const select = $('threads'), entries = [...state.threads].reverse().filter(t => t.appId === appId), signature = JSON.stringify(entries.map(t => [t.id, t.title, t.running]))
  if (select.dataset.signature !== signature) { select.dataset.signature = signature; select.replaceChildren(new Option('新对话', ''), ...entries.map(t => new Option((t.running ? '● ' : '') + t.title, t.id))) }
  select.value = threadId
}
function scheduleRender() { if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = null; render(); }, 80) }
function render() {
  if (!state) return
  const thread = current(), messages = $('messages'), scrollTop = messages.scrollTop, nearBottom = renderedThread !== threadId || messages.scrollHeight - scrollTop - messages.clientHeight < 100
  if (renderedThread !== threadId) { renderedThread = threadId; rows.clear(); messages.replaceChildren() }
  const wanted = []
  for (const [index, message] of (thread?.messages || []).entries()) {
    if (message.turnId && message.role !== 'user') continue
    wanted.push({ key: 'm-' + (message.id || index), message })
    if (message.role === 'user' && message.turnId) {
      const turn = thread.turns?.find(t => t.id === message.turnId)
      if (turn) wanted.push({ key: 't-' + turn.id, turn })
    }
  }
  for (const turn of thread?.turns || []) if (!wanted.some(row => row.turn?.id === turn.id)) {
    const next = wanted.findIndex(row => row.turn && row.turn.startedAt > turn.startedAt)
    if (next < 0) wanted.push({ key: 't-' + turn.id, turn }); else wanted.splice(Math.max(0, next - 1), 0, { key: 't-' + turn.id, turn })
  }
  messages.querySelector('.empty')?.remove()
  let previous = null
  for (const entry of wanted) {
    let row = rows.get(entry.key)
    if (!row) { row = entry.turn ? createTurn() : createMessage(entry.message); rows.set(entry.key, row) }
    if (entry.turn) updateTurn(row, entry.turn, {
      messages: thread.messages,
      commands: (thread.commands || []).filter(command => command.turnId === entry.turn.id),
      onTerminate: async session_id => { try { await api('commands/terminate', { threadId: thread.id, session_id }); await refresh() } catch (error) { toast(error.message) } },
    })
    const expected = previous ? previous.nextSibling : messages.firstChild
    if (expected !== row) messages.insertBefore(row, expected)
    previous = row
  }
  if (!wanted.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = '一起改造你的应用。\n\n创建插件、修改代码，或整理当前笔记。\n添加选区或图片，让想法更具体。'; messages.append(empty) }
  messages.scrollTop = nearBottom ? messages.scrollHeight : scrollTop
  followButton()
  $('stop').hidden = !state.activeThreadId
  $('send').hidden = !!state.activeThreadId
  $('activity').textContent = state.activeThreadId && state.activeThreadId !== threadId ? '另一个对话正在执行任务' : ''
  const progress = developmentStatus(state.application.development)
  const hot = state.application.online && state.application.managed && state.application.mode === 'development'
    ? ' · ' + progress.label : ''
  $('connection').textContent = (binding?.appId === appId ? '应用已连接 · 可操作当前页面' : '代码模式 · 当前会话未连接应用页面') + hot
  $('development-progress').hidden = !progress.details
  $('development-details').textContent = progress.details
  if (progress.attention) $('development-progress').open = true
  const usage = thread?.contextUsage, threshold = config?.compaction?.threshold || 128000
  $('context-usage').textContent = `上下文 ${usage?.tokens == null ? '待下轮确认' : '约 ' + usage.tokens.toLocaleString()} / ${threshold.toLocaleString()} tokens${config?.compaction?.enabled === false ? ' · 自动压缩关闭' : ''}`
  $('context-usage').title = `模型窗口 ${(usage?.contextWindow || 1048576).toLocaleString()} tokens；用量含估算，以接口后续回报为准。`
  $('compact').disabled = !!state.activeThreadId || !thread?.canCompact || submitting
  $('compose-model').disabled = $('compose-effort').disabled = !!state.activeThreadId || submitting
  renderThreads(); renderComposer()
  sessionStorage.setItem('agent-thread', threadId); sessionStorage.setItem('agent-app', appId)
}
function needsVision() { return (images.length || current()?.hasImages) && !config?.models?.find(m => m.id === $('compose-model').value)?.images }
function renderComposer() {
  $('browser-verification').checked = browserChoice()
  $('browser-verification').disabled = submitting
  const vision = needsVision()
  $('vision-hint').hidden = !vision
  $('vision-hint').querySelector('span').textContent = current()?.hasImages ? '此对话含图片历史，需使用 Flash。' : 'Pro 不支持图片。'
  $('send').disabled = !!state?.activeThreadId || uploading > 0 || submitting || !!vision
  $('switch-flash').disabled = !!state?.activeThreadId || uploading > 0 || submitting
  $('composer-hint').textContent = uploading ? `正在上传 ${uploading} 张图片…` : 'Enter 发送 · Shift + Enter 换行'
  $('upload-status').hidden = !uploading
  $('upload-status').textContent = uploading ? `正在上传 ${uploading} 张图片…` : ''
  resizePrompt()
}
function renderAttachments() {
  $('attachments').replaceChildren()
  for (const item of attachments) {
    const row = document.createElement('div'); row.className = 'attachment'
    const text = document.createElement('span'); text.textContent = '↳ ' + item.label + ' · ' + item.text.slice(0, 80); row.append(text)
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', '移除选区'); remove.onclick = () => { attachments = attachments.filter(a => a.id !== item.id); renderAttachments() }; row.append(remove); $('attachments').append(row)
    row.title = item.text
  }
  $('image-previews').replaceChildren()
  for (const image of images) {
    const item = document.createElement('div'); item.className = 'image-preview'
    const img = document.createElement('img'); img.src = '/api/images/' + image.id; img.alt = image.name || '待发送图片'
    const remove = document.createElement('button'); remove.textContent = '×'; remove.type = 'button'; remove.setAttribute('aria-label', '移除图片')
    remove.onclick = safe(async () => { images = images.filter(value => value.id !== image.id); renderAttachments(); await removeDraftImage(image.id) })
    item.append(img, remove); $('image-previews').append(item)
  }
  renderComposer()
}
let uploadQueue = Promise.resolve(), draftGeneration = 0
function uploadImages(files) {
  const accepted = [...files].filter(file => file.type.startsWith('image/'))
  if (!accepted.length) return toast('请选择 PNG、JPEG、WebP 或 GIF 图片')
  const generation = draftGeneration
  uploading += accepted.length; renderComposer()
  uploadQueue = uploadQueue.then(async () => {
    for (const file of accepted) {
      try {
        if (generation !== draftGeneration) continue
        if (images.length >= 10) throw Error('每条消息最多 10 张图片')
        if (file.size > 8 * 1024 * 1024 || file.size + images.reduce((n, image) => n + image.bytes, 0) > 20 * 1024 * 1024) throw Error('单张图片最多 8 MB，每条消息合计最多 20 MB')
        const response = await fetch('/api/images', { method: 'POST', headers: { 'Content-Type': file.type }, body: file }), value = await response.json()
        if (!response.ok) throw Error(value.error)
        if (generation !== draftGeneration) await api('images/remove', { id: value.id })
        else images.push({ ...value, name: file.name })
      } catch (error) { toast(error.message) }
      finally { uploading--; renderAttachments() }
    }
  })
  return uploadQueue
}
function clearDraftAttachments() {
  draftGeneration++; attachments = []
  for (const image of images) void removeDraftImage(image.id).catch(() => {})
  images = []; renderAttachments()
}
function newThread() { threadId = ''; browserDrafts.delete(browserChoiceKey()); clearDraftAttachments(); render() }
function connectFrame() { if (!standalone && appOrigin) frame.contentWindow.postMessage({ channel: 'cordis-agent', type: 'connect' }, appOrigin) }
async function refresh() {
  if (polling) return; polling = true
  try {
    const fresh = await api('state')
    if (state) {
      for (const thread of fresh.threads) { const newer = state.threads.find(t => t.id === thread.id); if (newer && newer.revision > thread.revision) Object.assign(thread, newer) }
      for (const thread of state.threads) if (!fresh.threads.some(t => t.id === thread.id)) fresh.threads.push(thread)
      fresh.activeThreadId = fresh.threads.find(t => t.running)?.id || null
    }
    state = fresh
    $('app-select').replaceChildren(...state.applications.map(app => {
      const option = new Option(app.name + (app.error ? ' · 清单错误' : ''), app.id)
      if (app.error) option.title = app.error
      return option
    }))
    if (!appId || !state.applications.some(app => app.id === appId)) appId = state.application.state?.current?.id || state.applications[0]?.id || ''
    if (threadId && !current()) threadId = ''
    $('app-select').value = appId
    if (!appOrigin) { appOrigin = new URL(state.appUrl).origin; if (!standalone) frame.src = state.appUrl }
    $('offline').hidden = state.application.online; $('logs').textContent = [state.application.error, ...state.application.logs.map(log => log.text)].filter(Boolean).join('\n')
    if (!state.application.online) binding = null
    render(); connectFrame()
  } finally { polling = false }
}
window.addEventListener('message', safe(async event => {
  const message = event.data
  if (standalone || event.source !== frame.contentWindow || event.origin !== appOrigin || message?.channel !== 'cordis-agent') return
  if (message.type === 'ready') {
    if (binding && (binding.pageId !== message.pageId || binding.session !== message.session)) { attachments = []; renderAttachments() }
    binding = message
    if (message.appId && message.appId !== lastPageAppId) {
      lastPageAppId = message.appId
      if (message.appId !== appId) { appId = message.appId; $('app-select').value = appId; newThread() }
    }
    await api('bridge', { ...message, clientId }); render()
  } else if (message.type === 'attachment') {
    if (message.pageId !== binding?.pageId || message.appId !== appId) return
    if (attachments.length >= 10) throw Error('每条消息最多添加 10 个选区')
    attachments.push({ ...message.attachment, appId: message.appId, pageId: message.pageId, session: message.session }); showChat(); renderAttachments(); $('prompt').focus()
  } else if (message.type === 'result') await api('bridge', { ...message, clientId })
  else if (message.type === 'disconnect') { binding = null; await api('bridge', { type: 'disconnect', clientId }); render() }
}))
frame.addEventListener('load', connectFrame)
$('launcher').onclick = showChat
$('chat-close').onclick = hideChat
$('messages').addEventListener('scroll', followButton)
$('messages').addEventListener('process-toggle', () => requestAnimationFrame(followButton))
$('latest').onclick = () => { const box = $('messages'); box.scrollTo({ top: box.scrollHeight, behavior: motion() ? 'smooth' : 'auto' }) }
$('new-thread').onclick = newThread
$('app-select').onchange = () => { appId = $('app-select').value; newThread() }
$('threads').onchange = () => { threadId = $('threads').value; clearDraftAttachments(); render(); $('messages').scrollTop = $('messages').scrollHeight }
$('browser-verification').onchange = () => {
  const key = browserChoiceKey(), enabled = $('browser-verification').checked, id = threadId
  const draft = { enabled }
  browserDrafts.set(key, draft)
  if (!id) return
  preferenceWrites++
  preferenceQueue = preferenceQueue.catch(() => {}).then(async () => {
    const thread = await api('thread-preferences', { threadId: id, browserVerificationEnabled: enabled })
    upsert(thread)
    if (browserDrafts.get(key) === draft) browserDrafts.delete(key)
    render()
  }).catch(error => toast('验收偏好保存失败：' + error.message)).finally(() => { preferenceWrites-- })
}
async function send(mode = 'chat') {
  if (state.activeThreadId || uploading || submitting) return
  const prompt = $('prompt').value.trim(); if (mode === 'chat' && !prompt && !images.length) return
  if (needsVision()) { toast('请点击「切换 Flash 并发送」，或选择 Flash 模型后操作。'); return }
  const submitted = { appId, threadId, generation: draftGeneration, prompt: $('prompt').value, revision: promptRevision,
    browserVerificationEnabled: browserChoice(),
    images: new Set(mode === 'chat' ? images.map(image => image.id) : []), attachments: new Set(mode === 'chat' ? attachments.map(item => item.id) : []) }
  let accepted = false
  pendingImages = submitted.images
  submitting = true; renderComposer()
  try {
    const effort = $('compose-effort').value
    const payload = { appId: submitted.appId, threadId: submitted.threadId || undefined, clientId: binding?.appId === submitted.appId ? clientId : undefined, prompt, attachments: mode === 'chat' ? [...attachments] : [], images: mode === 'chat' ? images.map(image => image.id) : [], model: $('compose-model').value, thinking: effort !== 'off', reasoningEffort: effort === 'off' ? 'high' : effort, browserVerificationEnabled: submitted.browserVerificationEnabled }
    if (preferenceWrites) await preferenceQueue
    const thread = await api(mode === 'compact' ? 'compact' : 'run', payload)
    accepted = true; upsert(thread)
    if (appId === submitted.appId && threadId === submitted.threadId && draftGeneration === submitted.generation) {
      browserDrafts.delete(browserChoiceKey())
      threadId = thread.id
      if (mode === 'chat') {
        if (promptRevision === submitted.revision && $('prompt').value === submitted.prompt) $('prompt').value = ''
        attachments = attachments.filter(item => !submitted.attachments.has(item.id))
        images = images.filter(image => !submitted.images.has(image.id))
        renderAttachments()
      }
    }
    render()
  } finally {
    pendingImages = new Set()
    if (!accepted) for (const id of submitted.images) if (!images.some(image => image.id === id)) void removeDraftImage(id).catch(() => {})
    submitting = false; render()
  }
}
$('composer').onsubmit = safe(async event => { event.preventDefault(); await send() })
$('prompt').addEventListener('input', () => { promptRevision++; resizePrompt() })
$('prompt').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('composer').requestSubmit() } }
$('compose-model').onchange = renderComposer
$('switch-flash').onclick = safe(async () => { $('compose-model').value = 'deepseek-flash'; renderComposer(); await send() })
$('attach-image').onclick = () => $('image-input').click()
$('image-input').onchange = () => { void uploadImages($('image-input').files); $('image-input').value = '' }
$('composer').addEventListener('paste', event => {
  const files = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean)
  if (!files.length) return
  event.preventDefault(); const text = event.clipboardData.getData('text/plain')
  if (text) { $('prompt').setRangeText(text, $('prompt').selectionStart, $('prompt').selectionEnd, 'end'); promptRevision++ }
  void uploadImages(files)
})
$('chat').addEventListener('dragover', event => { if ([...(event.dataTransfer?.types || [])].includes('Files')) { event.preventDefault(); $('composer').classList.add('dragging') } })
$('chat').addEventListener('dragleave', event => { if (!$('chat').contains(event.relatedTarget)) $('composer').classList.remove('dragging') })
$('chat').addEventListener('drop', event => { event.preventDefault(); $('composer').classList.remove('dragging'); void uploadImages(event.dataTransfer.files) })
$('stop').onclick = safe(() => api('interrupt', {}))
$('compact').onclick = safe(() => send('compact'))
$('start-app').onclick = safe(async () => { await api('application/start', {}); if (!standalone) frame.src = state.appUrl; await refresh() })
function setModelOptions() {
  for (const id of ['model', 'compose-model']) $(id).replaceChildren(...config.models.map(model => { const option = new Option(id === 'compose-model' ? (model.id.includes('flash') ? 'Flash · 识图' : 'Pro · 文字') : model.name + (model.images ? ' · 识图' : ' · 文字'), model.id); option.title = model.name; return option }))
  $('compose-model').value = config.model; $('compose-effort').value = config.thinking ? config.reasoningEffort : 'off'
}
$('settings-open').onclick = safe(async () => {
  config = await api('config'); $('base-url').value = config.baseUrl; $('model').value = config.model; $('effort').value = config.thinking ? config.reasoningEffort : 'off'
  $('auto-compact').checked = config.compaction.enabled; $('compact-threshold').value = config.compaction.threshold; $('keep-recent').value = config.compaction.keepRecentTokens
  $('api-key').value = ''; $('api-key').placeholder = config.hasKey ? '已配置，留空保留现有密钥' : '输入 DeepSeek API 密钥'; $('settings').showModal()
})
$('settings-close').onclick = () => { $('api-key').value = ''; $('settings').close() }
$('settings-form').onsubmit = safe(async event => {
  event.preventDefault(); const effort = $('effort').value
  await api('config', { baseUrl: $('base-url').value, model: $('model').value, thinking: effort !== 'off', reasoningEffort: effort === 'off' ? 'high' : effort, apiKey: $('api-key').value, compaction: { enabled: $('auto-compact').checked, threshold: Number($('compact-threshold').value), keepRecentTokens: Number($('keep-recent').value) } })
  config = await api('config'); setModelOptions(); $('api-key').value = ''; $('settings').close(); render(); toast('Agent 设置已保存')
})
const events = new EventSource('/api/events')
events.onmessage = event => {
  const message = JSON.parse(event.data)
  if (message.type === 'page-call') { if (message.clientId === clientId) frame.contentWindow.postMessage({ ...message, type: 'call', channel: 'cordis-agent' }, appOrigin); return }
  if (message.type === 'reload-app') { if (!standalone) { binding = null; frame.src = state.appUrl }; return }
  if (message.type === 'error') return toast(message.error)
  if (!state) return
  if (message.type === 'thread') {
    upsert(message.thread)
    if (!message.thread.running && $('chat').hidden) $('badge').hidden = false
  } else if (message.type === 'turn') {
    const thread = state.threads.find(thread => thread.id === message.threadId)
    if (!thread) { void refresh(); return }
    if (message.revision <= thread.revision) return
    const index = thread.turns.findIndex(turn => turn.id === message.turn.id)
    if (index < 0) thread.turns.push(message.turn); else thread.turns[index] = message.turn
    thread.revision = message.revision; thread.contextUsage = message.contextUsage
  }
  scheduleRender()
}
events.onopen = () => void refresh().catch(error => toast(error.message))
events.onerror = () => { $('connection').textContent = '工作台连接中断，正在重连…' }
config = await api('config'); setModelOptions()
await refresh().catch(error => toast(error.message))
setInterval(() => void refresh().catch(() => {}), 3000)
setInterval(() => { if (current()?.running || current()?.commands?.some(command => command.status === 'running')) scheduleRender() }, 1000)
