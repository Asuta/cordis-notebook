import { button, el, textArea } from './ui.js'
import { applyAtmosphere, artFor, narrative, renderScene } from './experience.js'

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_EDGE = 1280
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024

export function renderChat({ session, project, settings, busy, pending, canStop = true, pendingMessage, pendingImages = 0, streamText = '', editIndex, draft, attachments = [], suggestions = [], onInspire, onSuggestion, onMemory, onPlayer, compact = false, onDraft, onSend, onStop, onAttach, onRemoveAttachment, onError, onEdit, onBranch, onCancelEdit }) {
  const player = session?.player || project.player
  const opening = session?.opening || project.opening
  const layout = el('div', 'rp-play-layout' + (compact ? ' is-compact' : ''))
  applyAtmosphere(layout, project)
  const root = el('section', 'rp-chat')
  const avatar = el('img', 'rp-chat-avatar')
  avatar.src = artFor(project, 'portrait'); avatar.alt = ''
  const details = el('details', 'rp-character-details', el('summary', '', '角色资料'), el('div', '', el('strong', '', project.character.name), el('p', '', project.character.description), el('p', '', opening?.situation)))
  const header = el('header', 'rp-chat-header', avatar, el('div', 'rp-chat-heading', el('strong', '', project.character.name), el('span', '', opening?.location || '故事进行中')), details)
  const tools = el('div', 'rp-story-tools')
  if (onPlayer) tools.append(button('◈ ' + player.name, onPlayer, 'rp-story-chip rp-player-chip'))
  else tools.append(el('span', 'rp-story-chip', '◈ ' + player.name))
  if (onMemory) tools.append(button('≋ 剧情记忆', onMemory, 'rp-story-chip'))
  tools.append(el('span', 'rp-model-chip', settings.model || '尚未连接模型'))
  const messages = el('div', 'rp-messages')
  messages.setAttribute('aria-label', compact ? '试聊消息' : '故事对话')
  messages.append(el('div', 'rp-chapter', el('span', 'rp-eyebrow', 'CHAPTER 01'), el('h2', '', opening?.title || project.title), el('p', '', [opening?.time, opening?.location].filter(Boolean).join(' / ')),
    opening?.situation && el('div', 'rp-opening-situation', opening.situation)))
  if (!session?.messages?.length) {
    messages.append(el('div', 'rp-welcome', el('div', 'rp-welcome-avatar', project.character.name?.slice(0, 1) || '人'),
      el('span', 'rp-eyebrow', 'A NEW CONVERSATION'), el('h1', '', '和 ' + (project.character.name || '这位角色') + ' 开始聊天'),
      el('p', '', project.character.description || '你可以从一个简单的问候开始。'),
      project.character.greeting && el('blockquote', '', '“' + project.character.greeting + '”')))
  }
  for (const [index, message] of (session?.messages || []).entries()) messages.append(messageView(message, index, session.messages.length, session.messages.some(item => item.role === 'user'), project, onEdit, onBranch, busy, player))
  if (pendingMessage) messages.append(el('article', 'rp-message-row rp-message-user rp-message-pending', el('div', 'rp-avatar rp-avatar-user', '我'),
    el('div', 'rp-message-content', el('div', 'rp-message-meta', el('span', 'rp-message-author', '你'), el('span', 'rp-message-author', '发送中')),
      pendingImages > 0 && el('p', 'rp-pending-images', '附带 ' + pendingImages + ' 张图片'),
      el('div', 'rp-message-text', narrative(pendingMessage)))))
  if (pending && streamText) messages.append(el('div', 'rp-message-row rp-message-assistant rp-message-streaming',
    el('div', 'rp-avatar', project.character.name?.slice(0, 1) || '人'),
    el('div', 'rp-message-content', el('span', 'rp-message-author', project.character.name),
      el('div', 'rp-message-text rp-stream-text', narrative(streamText)), el('span', 'rp-stream-cursor', '▍'))))
  else if (pending) messages.append(el('div', 'rp-message-row rp-message-assistant', el('div', 'rp-avatar', project.character.name?.slice(0, 1) || '人'), el('div', 'rp-message-content', el('span', 'rp-message-author', project.character.name), el('div', 'rp-typing', el('i'), el('i'), el('i')))))

  const composer = el('div', 'rp-composer-wrap')
  if (suggestions.length) {
    const choices = el('div', 'rp-suggestions')
    choices.setAttribute('aria-label', '接话建议')
    for (const [index, text] of suggestions.entries()) {
      const choice = button(el('span', '', el('small', '', '0' + (index + 1)), text), () => onSuggestion?.(text), 'rp-suggestion')
      choice.disabled = busy
      choices.append(choice)
    }
    composer.append(el('div', 'rp-suggestion-heading', '换个方向，让故事继续', el('span', '', '选择后可修改，再发送')), choices)
  }
  const attachmentList = el('div', 'rp-attachment-list')
  for (const item of attachments) attachmentList.append(attachmentView(item, () => onRemoveAttachment?.(item.id), busy))
  attachmentList.hidden = attachments.length === 0
  const input = textArea(draft, onDraft, '写下你想说的话…', 3)
  input.classList.add('rp-composer-input')
  input.setAttribute('aria-label', compact ? '试聊输入' : '对话输入')
  input.disabled = busy
  const send = button(busy ? (canStop ? '■ 停止生成' : '正在回复…') : editIndex >= 0 ? '修改并继续 →' : '发送消息 →',
    () => { if (busy) { if (canStop) onStop?.(); return } void onSend(input.value, attachments) },
    'rp-button ' + (busy ? 'rp-button-stop' : 'rp-button-primary') + ' rp-send-button')
  send.disabled = busy && !canStop
  input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!busy) void onSend(input.value, attachments) } })
  const fileInput = el('input', 'rp-file-input')
  fileInput.type = 'file'
  fileInput.accept = IMAGE_TYPES.join(',')
  fileInput.multiple = true
  fileInput.hidden = true
  const attach = button('＋ 图片', () => fileInput.click(), 'rp-button rp-button-secondary rp-attach-button')
  attach.setAttribute('aria-label', '添加图片')
  attach.title = '添加图片（PNG、JPEG 或 WebP，每条最多 2 张）'
  attach.disabled = busy || attachments.length >= 2
  fileInput.addEventListener('change', async () => {
    const files = [...(fileInput.files || [])]
    fileInput.value = ''
    if (!files.length) return
    try { onAttach?.(await Promise.all(files.map(prepareImage))) }
    catch (error) { onError?.(error.message) }
  })
  const counter = el('span', 'rp-composer-hint', 'Enter 发送 · Shift + Enter 换行 · 可附 2 张图片')
  const inspire = onInspire && button('✧ 接话灵感', onInspire, 'rp-inspire-button')
  if (inspire) inspire.disabled = busy
  composer.append(el('div', 'rp-composer-card', editIndex >= 0 && el('div', 'rp-editing-label', '正在重写消息', button('取消', onCancelEdit, 'rp-text-button')),
    attachmentList, input, el('div', 'rp-composer-bottom', el('div', 'rp-composer-tools', inspire, !compact && attach, !compact && fileInput, counter), send)))
  if (!settings.hasApiKey) composer.append(el('p', 'rp-no-key-hint', '配置模型 API Key 后即可发送消息。'))
  root.append(header, tools, messages, composer)
  if (!compact) layout.append(renderScene(project, opening))
  layout.append(root)
  requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight })
  return layout
}

function attachmentView(item, remove, busy) {
  const thumbnail = el('img', 'rp-attachment-image')
  thumbnail.src = item.dataUrl
  thumbnail.alt = '待发送的图片'
  const close = button('×', remove, 'rp-attachment-remove')
  close.setAttribute('aria-label', '移除这张图片')
  close.disabled = busy
  return el('div', 'rp-attachment', thumbnail, close)
}

function messageView(message, index, count, hasUserMessage, project, onEdit, onBranch, busy, player) {
  const assistant = message.role === 'assistant'
  const avatar = el('div', assistant ? 'rp-avatar' : 'rp-avatar rp-avatar-user', assistant ? project.character.name?.slice(0, 1) || '人' : '我')
  const author = el('span', 'rp-message-author', assistant ? project.character.name : player.name)
  const body = el('div', 'rp-message-text', narrative(message.content))
  const images = el('div', 'rp-message-images')
  for (const image of message.images || []) {
    const thumbnail = el('img', 'rp-message-image')
    thumbnail.src = image.dataUrl
    thumbnail.alt = '玩家发送的图片'
    images.append(thumbnail)
  }
  images.hidden = images.childElementCount === 0
  const actions = el('div', 'rp-message-actions')
  if (!assistant && onEdit) actions.append(button('从这里重写', () => onEdit(index), 'rp-text-button'))
  if (onBranch) actions.append(button('从这里分支', () => onBranch(index), 'rp-text-button'))
  if (onBranch && assistant && index === count - 1 && hasUserMessage) actions.append(button('重新生成', () => onBranch(index, { regenerate: true }), 'rp-text-button'))
  if (busy) actions.hidden = true
  const content = el('div', 'rp-message-content', el('div', 'rp-message-meta', author, message.createdAt && el('time', '', new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))), images, body, actions)
  return el('article', 'rp-message-row ' + (assistant ? 'rp-message-assistant' : 'rp-message-user'), avatar, content)
}

export async function prepareImage(file) {
  if (!IMAGE_TYPES.includes(file.type)) throw Error('仅支持 PNG、JPEG 或 WebP 图片')
  if (file.size > MAX_UPLOAD_BYTES) throw Error('图片不能超过 12 MB')
  const url = URL.createObjectURL(file)
  try {
    const image = await loadImage(url)
    const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height
    if (!width || !height) throw Error('无法读取这张图片')
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.86)
    if (dataUrl.length > 800000) throw Error('图片压缩后仍然过大，请换一张更小的图片')
    return { id: crypto.randomUUID(), mimeType: 'image/jpeg', dataUrl }
  } finally { URL.revokeObjectURL(url) }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(Error('无法读取这张图片'))
    image.src = url
  })
}
