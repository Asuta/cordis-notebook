const MAX_TRANSCRIPT = 1000
const MAX_MESSAGE = 8000
const id = () => globalThis.crypto.randomUUID()
export const maxTurns = node => Math.max(1, Math.min(100, Number.isInteger(node?.chat?.maxTurns) ? node.chat.maxTurns : 4))
export const nextNode = node => node?.chat?.next || node?.next || ''
export const characterFor = (project, node) => project.characters.find(character => character.id === (node.chat?.characterId || node.stage?.characterId))
export const demoReply = (node, turns) => typeof node.chat?.demoReplies?.[turns] === 'string' ? node.chat.demoReplies[turns].trim() : ''

function historyFor(runtime, userText) {
  const messages = []
  let chars = userText.length
  for (const item of [...(runtime.transcript || [])].reverse()) {
    if (!['user', 'assistant'].includes(item.role) || typeof item.text !== 'string' || !item.text.trim()) continue
    if (messages.length >= 39) break
    const content = item.text.slice(0, MAX_MESSAGE).trim()
    if (chars + content.length > 48000) break
    chars += content.length
    messages.unshift({ role: item.role, content })
  }
  return [...messages, { role: 'user', content: userText }]
}

export function createChatController(ctx, engine, request, connection, changed = () => {}) {
  let disposed = false, visit = 0, pending = null
  const valid = (runtime, nodeId, token) => !disposed && engine.mode === 'play' && engine.runtime === runtime && runtime?.nodeId === nodeId && (token === undefined || token === visit)
  const cancel = (clearBusy = true) => {
    visit++
    const old = pending
    pending = null
    old?.controller.abort()
    if (clearBusy && old && valid(old.runtime, old.nodeId)) engine.transact(runtime => { runtime.busy = false })
  }
  const report = (runtime, nodeId, token, message) => { if (valid(runtime, nodeId, token)) engine.error(message) }

  async function continueStory(node) {
    const runtime = engine.runtime, token = visit
    if (!valid(runtime, node.id, token) || engine.held || runtime.busy || runtime.ended || pending) return
    // Choices belong to the authored flow. Never bypass a condition-gated choice.
    if (node.choices?.length || !nextNode(node)) return
    const task = { runtime, nodeId: node.id, token, controller: new AbortController() }
    pending = task
    engine.transact(current => { current.busy = true })
    try {
      await engine.emit('chat.continue', { nodeId: node.id, node, chatTurns: runtime.chatTurns })
      if (!valid(runtime, node.id, token)) return
      engine.transact(current => { current.busy = false })
      await engine.go(nextNode(node))
    } catch { report(runtime, node.id, token, '无法继续剧情，请检查节点连接和事件规则') }
    finally {
      if (pending === task) pending = null
      if (valid(runtime, node.id, token) && runtime.busy) engine.transact(current => { current.busy = false })
    }
  }

  const handler = {
    type: 'chat', label: '聊天', color: '#63a5b8',
    enter(node) {
      cancel(false)
      if (!valid(engine.runtime, node.id)) return
      const character = characterFor(engine.project, node)
      const welcome = node.lines?.[0]
      engine.transact(runtime => {
        runtime.chatTurns = 0; runtime.busy = false; runtime.ended = false; runtime.error = ''; runtime.lineIndex = 0
        runtime.text = { speaker: welcome ? welcome.speaker || '' : character?.id || '', text: welcome?.text || '' }
        // Earlier story/chat entries deliberately survive entering a new chat node.
        if (!Array.isArray(runtime.transcript)) runtime.transcript = []
        if (welcome?.text) {
          runtime.transcript.push({ id: id(), role: welcome.speaker ? 'assistant' : 'narrator', name: engine.project.characters.find(item => item.id === welcome.speaker)?.name || '', text: welcome.text })
          if (runtime.transcript.length > MAX_TRANSCRIPT) runtime.transcript.splice(0, runtime.transcript.length - MAX_TRANSCRIPT)
        }
      })
    },
    advance: continueStory,
  }
  engine.registerNode(ctx, handler)
  engine.observe(ctx, event => {
    if (event.type === 'mode' || pending && !valid(pending.runtime, pending.nodeId, pending.token)) cancel()
  })
  ctx.effect(() => () => { cancel(); disposed = true })

  async function send(raw) {
    const runtime = engine.runtime, node = engine.scene(), token = visit
    if (!node || node.type !== 'chat' || !valid(runtime, node.id, token) || engine.held || runtime.busy || runtime.ended || pending || runtime.chatTurns >= maxTurns(node)) return false
    const content = typeof raw === 'string' ? raw.trim() : ''
    if (!content || content.length > 4000) { report(runtime, node.id, token, '请输入 1–4000 字的消息'); return false }
    const settings = connection()
    if (!settings) { report(runtime, node.id, token, '连接设置尚未载入，请在 AI 对话面板重试'); return false }
    const live = !!(settings.baseUrl && settings.model)
    const authored = demoReply(node, runtime.chatTurns)
    if (!live && !authored) { report(runtime, node.id, token, '本轮未编写示例回复，请继续剧情或返回编辑器补充'); return false }
    const controller = new AbortController()
    const task = { runtime, nodeId: node.id, token, controller }
    pending = task
    const character = characterFor(engine.project, node)
    const payload = {
      character: character ? { id: character.id, name: character.name, description: character.description, personality: character.personality } : { name: '角色' },
      personality: character?.personality || '', worldInfo: engine.project.settings.worldInfo || '',
      prompt: node.chat?.prompt || '', messages: historyFor(runtime, content),
    }
    engine.transact(current => { current.busy = true; current.error = '' })
    let delivered = false
    try {
      // sdk.request supplies X-Application-Session but has no public AbortSignal API.
      // A local abort invalidates this turn; the server independently bounds the fetch.
      const result = live ? await request('/api/narrative/ai/reply', 'POST', payload) : { reply: authored }
      if (controller.signal.aborted || !valid(runtime, node.id, token)) return false
      if (typeof result?.reply !== 'string' || !result.reply.trim() || result.reply.length > MAX_MESSAGE) throw Error('invalid reply')
      const reply = result.reply.trim()
      engine.transact(current => {
        current.transcript.push({ id: id(), role: 'user', name: '你', text: content }, { id: id(), role: 'assistant', name: character?.name || '角色', text: reply })
        if (current.transcript.length > MAX_TRANSCRIPT) current.transcript.splice(0, current.transcript.length - MAX_TRANSCRIPT)
        current.text = { speaker: character?.id || node.chat?.characterId || '', text: reply }
        current.chatTurns++; current.error = ''
      })
      delivered = true
      // Rules see one completed player/character turn and exclusively own stat changes.
      await engine.emit('chat.message', { nodeId: node.id, node, characterId: character?.id || '', message: content, reply, chatTurns: runtime.chatTurns, demo: !live })
      return true
    } catch {
      if (!controller.signal.aborted) report(runtime, node.id, token, delivered ? '对话已记录，但事件规则执行失败，请检查规则' : live ? 'AI 回复失败，请检查连接设置或稍后重试（未切换为示例对话）' : '示例对话执行失败')
      return delivered
    } finally {
      if (pending === task) pending = null
      if (valid(runtime, node.id, token) && runtime.busy) engine.transact(current => { current.busy = false })
      changed()
    }
  }
  return { send, continueStory, cancel, get disposed() { return disposed } }
}
