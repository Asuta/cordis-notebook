const invalid = message => { throw Object.assign(Error(message), { status: 400 }) }
const object = value => !!value && typeof value === 'object' && !Array.isArray(value)
const hasKeys = (value, allowed, label, optional = []) => {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key)) || allowed.some(key => !optional.includes(key) && !(key in value))) invalid(label + '字段无效')
}
const string = (value, max, { required = false, trim = false } = {}) => typeof value === 'string' && value.length <= max && (!required || (trim ? value.trim() : value).length > 0)
const idOK = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/i.test(value)
const isoDate = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const uniqueIds = rows => rows.every(row => object(row) && idOK(row.id)) && new Set(rows.map(row => row.id)).size === rows.length

export const LIMITS = Object.freeze({ projectBytes: 2 * 1024 * 1024, sessionMessages: 300, sessionBytes: 512 * 1024, messageChars: 12000, contextChars: 48000, sessions: 200, imagesPerMessage: 2, imageChars: 800000, sessionImageBytes: 4 * 1024 * 1024 })
export const IMAGE_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp'])
export const emptyMemory = () => ({ summary: '', scene: '', relationship: '', facts: [] })
export const defaultPlayer = () => ({ name: '旅人', description: '一位在雨夜偶然走进唱片店的成年旅人。', relationship: '初次相识，彼此还不熟悉。' })
export const defaultOpening = () => ({ title: '雨停之前', location: '回声唱片店', time: '傍晚 · 细雨', situation: '' })
export const defaultPresentation = () => ({ portrait: '', background: '', theme: 'amber' })

export function validatePlayer(player) {
  hasKeys(player, ['name', 'description', 'relationship'], '玩家身份')
  if (!string(player.name, 100, { required: true, trim: true }) || !string(player.description, 4000) || !string(player.relationship, 3000)) invalid('玩家身份内容无效')
  return player
}
export function validateOpening(opening) {
  hasKeys(opening, ['title', 'location', 'time', 'situation'], '开场情境')
  if (!string(opening.title, 120) || !string(opening.location, 200) || !string(opening.time, 200) || !string(opening.situation, 6000)) invalid('开场情境内容无效')
  return opening
}
export function validateMemory(memory) {
  hasKeys(memory, ['summary', 'scene', 'relationship', 'facts'], '剧情记忆')
  if (!string(memory.summary, 6000) || !string(memory.scene, 3000) || !string(memory.relationship, 3000) || !Array.isArray(memory.facts) || memory.facts.length > 40 || !uniqueIds(memory.facts)) invalid('剧情记忆内容无效')
  for (const fact of memory.facts) {
    hasKeys(fact, ['id', 'content', 'enabled'], '记忆条目')
    if (!string(fact.content, 1000, { required: true, trim: true }) || typeof fact.enabled !== 'boolean') invalid('记忆条目内容无效')
  }
  return memory
}
export function validatePresentation(presentation) {
  hasKeys(presentation, ['portrait', 'background', 'theme'], '视觉设置')
  const asset = value => string(value, LIMITS.imageChars) && (!value || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))
  if (!asset(presentation.portrait) || !asset(presentation.background) || !['amber', 'forest', 'midnight'].includes(presentation.theme)) invalid('视觉设置内容无效，请使用 PNG、JPEG 或 WebP 图片')
  return presentation
}

// 旧作品和会话在读取时补齐新字段，保留已有文案、消息及 revision。
export function normalizeProject(input) {
  if (input?.schemaVersion !== 1) return validateProject(input)
  const project = structuredClone(input)
  project.schemaVersion = 2
  project.player = defaultPlayer()
  project.opening = { ...defaultOpening(), title: project.title, situation: project.character?.scenario || '' }
  project.presentation = defaultPresentation()
  return validateProject(project)
}
export function normalizeSession(input, project) {
  return validateSession({ ...structuredClone(input), player: input.player ?? structuredClone(project.player), opening: input.opening ?? structuredClone(project.opening), memory: input.memory ?? emptyMemory() })
}

export function validateProject(project) {
  hasKeys(project, ['schemaVersion', 'id', 'revision', 'title', 'description', 'character', 'attributes', 'worldInfo', 'context', 'player', 'opening', 'presentation'], '作品')
  if (project.schemaVersion !== 2 || !idOK(project.id) || !Number.isSafeInteger(project.revision) || project.revision < 0 || !string(project.title, 120, { required: true, trim: true }) || !string(project.description, 4000)) invalid('作品基本信息无效')
  validatePlayer(project.player)
  validateOpening(project.opening)
  validatePresentation(project.presentation)

  const character = project.character
  hasKeys(character, ['name', 'description', 'personality', 'background', 'scenario', 'greeting', 'exampleDialogue'], '人物卡')
  if (!string(character.name, 100, { required: true, trim: true }) || !string(character.description, 6000) || !string(character.personality, 6000) || !string(character.background, 8000) || !string(character.scenario, 6000) || !string(character.greeting, 12000) || !string(character.exampleDialogue, 12000)) invalid('人物卡内容无效')

  if (!Array.isArray(project.attributes) || project.attributes.length > 100 || !uniqueIds(project.attributes)) invalid('自定义属性列表无效')
  for (const attribute of project.attributes) {
    hasKeys(attribute, ['id', 'name', 'value', 'description', 'includeInContext'], '自定义属性')
    if (!idOK(attribute.id) || !string(attribute.name, 120, { required: true, trim: true }) || !string(attribute.value, 6000) || !string(attribute.description, 2000) || typeof attribute.includeInContext !== 'boolean') invalid('自定义属性内容无效')
  }

  if (!Array.isArray(project.worldInfo) || project.worldInfo.length > 200 || !uniqueIds(project.worldInfo)) invalid('世界信息列表无效')
  for (const entry of project.worldInfo) {
    hasKeys(entry, ['id', 'title', 'keys', 'content', 'enabled', 'alwaysActive'], '世界信息')
    if (!idOK(entry.id) || !string(entry.title, 160, { required: true, trim: true }) || !Array.isArray(entry.keys) || entry.keys.length > 30 || !entry.keys.every(key => string(key, 120, { required: true, trim: true })) || !string(entry.content, 12000) || typeof entry.enabled !== 'boolean' || typeof entry.alwaysActive !== 'boolean') invalid('世界信息内容无效')
  }

  const context = project.context
  hasKeys(context, ['systemPrompt', 'authorNote', 'maxHistoryMessages', 'temperature', 'maxTokens'], '上下文设置')
  if (!string(context.systemPrompt, 16000) || !string(context.authorNote, 6000) || !Number.isSafeInteger(context.maxHistoryMessages) || context.maxHistoryMessages < 0 || context.maxHistoryMessages > 100 || typeof context.temperature !== 'number' || !Number.isFinite(context.temperature) || context.temperature < 0 || context.temperature > 2 || !Number.isSafeInteger(context.maxTokens) || context.maxTokens < 1 || context.maxTokens > 8192) invalid('上下文设置无效')

  if (new TextEncoder().encode(JSON.stringify(project)).byteLength > LIMITS.projectBytes) invalid('作品数据不能超过 2 MB')
  return project
}

export function validateImages(images) {
  if (!Array.isArray(images) || !images.length || images.length > LIMITS.imagesPerMessage || !uniqueIds(images)) invalid('消息图片列表无效')
  for (const image of images) {
    hasKeys(image, ['id', 'mimeType', 'dataUrl'], '消息图片')
    if (!idOK(image.id) || !IMAGE_TYPES.includes(image.mimeType)) invalid('消息图片格式无效')
    const prefix = 'data:' + image.mimeType + ';base64,'
    if (typeof image.dataUrl !== 'string' || image.dataUrl.length > LIMITS.imageChars || !image.dataUrl.startsWith(prefix)) invalid('消息图片内容无效')
    const payload = image.dataUrl.slice(prefix.length)
    if (!payload || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) invalid('消息图片编码无效')
  }
  return images
}

export function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length > LIMITS.sessionMessages || !uniqueIds(messages)) invalid('对话消息列表无效')
  let bytes = 0, imageBytes = 0
  for (const message of messages) {
    hasKeys(message, ['id', 'role', 'content', 'createdAt', 'images'], '对话消息', ['images'])
    if (!idOK(message.id) || !['user', 'assistant'].includes(message.role) || !string(message.content, LIMITS.messageChars, { required: true, trim: true }) || !isoDate(message.createdAt)) invalid('对话消息内容无效')
    bytes += new TextEncoder().encode(message.content).byteLength
    if ('images' in message) {
      if (message.role !== 'user') invalid('只有玩家消息可以携带图片')
      for (const image of validateImages(message.images)) imageBytes += Math.ceil(image.dataUrl.length * 3 / 4)
    }
  }
  if (bytes > LIMITS.sessionBytes) invalid('对话内容不能超过 512 KB')
  if (imageBytes > LIMITS.sessionImageBytes) invalid('对话图片总量不能超过 4 MB，请新建对话或减少图片')
  return messages
}

export function validateSession(session) {
  hasKeys(session, ['id', 'revision', 'title', 'createdAt', 'updatedAt', 'messages', 'player', 'opening', 'memory'], '会话', ['player', 'opening', 'memory'])
  if (!idOK(session.id) || !Number.isSafeInteger(session.revision) || session.revision < 0 || !string(session.title, 120, { required: true, trim: true }) || !isoDate(session.createdAt) || !isoDate(session.updatedAt)) invalid('会话基本信息无效')
  validateMessages(session.messages)
  if (session.player !== undefined) validatePlayer(session.player)
  if (session.opening !== undefined) validateOpening(session.opening)
  if (session.memory !== undefined) validateMemory(session.memory)
  return session
}

export function demoProject() {
  return {
    schemaVersion: 2,
    id: 'main',
    revision: 0,
    title: '雨夜唱片店',
    description: '在一间快打烊的独立唱片店里，和一位刚认识的成年人慢慢聊天。',
    player: defaultPlayer(),
    opening: { ...defaultOpening(), situation: '末班车已经离开，雨还没有停。你推开亮着暖灯的店门，铜铃轻响。柜台后的人抬起头，把第二只茶杯放到桌上。' },
    presentation: defaultPresentation(),
    character: {
      name: '林澄',
      description: '28 岁的成年女性，经营「回声」独立唱片店，也为纪录片录制环境音。她习惯先听完再回答，遇到喜欢的话题会露出一点孩子气的兴奋。',
      personality: '温和、好奇、有分寸，偶尔用轻松的玩笑缓和沉默。她会表达自己的看法，也愿意听听对方怎么看。',
      background: '林澄在这条旧街长大。几年前她把外婆留下的杂货铺改成唱片店，店里一台老收音机仍然只能收到两个台。她喜欢收集雨声和城市里快要消失的声音。',
      scenario: '一个下雨的傍晚，你走进快打烊的「回声」唱片店避雨。林澄刚放好一张唱片，窗边的热茶还冒着气。你们刚刚认识，接下来聊什么由你决定。',
      greeting: '林澄把唱针轻轻抬起，抬头朝你笑了笑：「外面雨挺大的。你也是来躲雨的吗？我刚泡了茶，想坐一会儿、聊点什么都可以。」',
      exampleDialogue: '玩家：这张唱片听起来有点旧。\n林澄：嗯，是我外婆以前常放的那张。每次听到第二面，我都会想起厨房窗台上的薄荷。你平时会听什么？',
    },
    attributes: [
      { id: 'mood', name: '此刻心情', value: '平静，带着一点雨天的倦意', description: '帮助保持林澄当下的情绪基调。', includeInContext: true },
      { id: 'tea', name: '店里的茶', value: '桂花乌龙，温热', description: '场景中的一个可自然提及的小细节。', includeInContext: true },
      { id: 'private-note', name: '作者备注', value: '用于作者自己的提醒，不进入模型上下文。', description: '', includeInContext: false },
    ],
    worldInfo: [
      { id: 'echo-records', title: '回声唱片店', keys: ['回声', '唱片店', '唱片'], content: '店面不大，门边挂着一串旧铜铃。靠窗有两把椅子和一张常被雨水映亮的小圆桌。', enabled: true, alwaysActive: true },
      { id: 'old-street', title: '旧街', keys: ['旧街', '老街', '街区'], content: '这片街区正慢慢翻修，几家老店还留着原来的招牌。傍晚常有细雨从河面飘过来。', enabled: true, alwaysActive: false },
    ],
    context: {
      systemPrompt: '请自然地扮演人物卡中的角色，保持对话开放、连贯，并尊重玩家的表达。不要替玩家决定想法或行动。',
      authorNote: '对话从初次相识开始。保持温暖、生活化的节奏，让玩家自由选择话题。',
      maxHistoryMessages: 30,
      temperature: 0.85,
      maxTokens: 900,
    },
  }
}

export function composeContext(projectInput, historyInput, state = {}) {
  const project = validateProject(projectInput)
  const history = validateMessages(historyInput)
  const recent = project.context.maxHistoryMessages ? history.slice(-project.context.maxHistoryMessages) : history.at(-1)?.role === 'user' ? history.slice(-1) : []
  const searchable = [...recent.map(message => message.content), state.memory?.scene || '', ...(state.memory?.facts || []).filter(fact => fact.enabled).map(fact => fact.content)].join('\n').toLocaleLowerCase()
  const activeWorldInfo = project.worldInfo.filter(entry => entry.enabled && (entry.alwaysActive || entry.keys.some(key => searchable.includes(key.toLocaleLowerCase()))))
  const character = project.character
  const parts = [project.context.systemPrompt.trim()]
  parts.push([
    '[人物卡]',
    '姓名：' + character.name,
    '描述：' + character.description,
    '性格：' + character.personality,
    '背景：' + character.background,
    '场景：' + character.scenario,
    character.exampleDialogue ? '示例对话：\n' + character.exampleDialogue : '',
  ].filter(Boolean).join('\n'))
  const player = validatePlayer(state.player || project.player)
  const opening = validateOpening(state.opening || project.opening)
  const memory = validateMemory(state.memory || emptyMemory())
  parts.push('[玩家身份]\n姓名：' + player.name + '\n身份：' + player.description + '\n初始关系：' + player.relationship)
  parts.push('[开场情境]\n' + [opening.title, opening.location, opening.time, opening.situation].filter(Boolean).join(' · '))
  const remembered = [memory.summary && '共同经历：' + memory.summary, memory.scene && '当前情境：' + memory.scene, memory.relationship && '当前关系：' + memory.relationship, ...memory.facts.filter(fact => fact.enabled).map(fact => '重要事实或约定：' + fact.content)].filter(Boolean)
  if (remembered.length) parts.push('[剧情记忆 · 优先于开场设定]\n' + remembered.join('\n'))
  parts.push('使用中文自然推进故事。用 *动作或环境描写* 表示旁白，用「对白」表示角色发言。尊重玩家身份与已确认的记忆；不要替玩家决定行动、想法或回答。')
  const attributes = project.attributes.filter(attribute => attribute.includeInContext)
  if (attributes.length) parts.push('[角色属性]\n' + attributes.map(attribute => attribute.name + '：' + attribute.value + (attribute.description ? '（' + attribute.description + '）' : '')).join('\n'))
  if (activeWorldInfo.length) parts.push('[相关世界信息]\n' + activeWorldInfo.map(entry => '【' + entry.title + ' · ' + entry.id + '】\n' + entry.content).join('\n\n'))
  if (project.context.authorNote.trim()) parts.push('[作者备注]\n' + project.context.authorNote.trim())
  const system = parts.filter(Boolean).join('\n\n')
  if (system.length > LIMITS.contextChars) invalid('人物卡与常驻设定超过上下文长度上限，请精简内容')
  let used = system.length
  const selected = []
  for (let index = recent.length - 1; index >= 0; index--) {
    const message = recent[index]
    const images = message.images || []
    const cost = message.content.length + message.role.length + 8 + images.length * 1400
    if (used + cost > LIMITS.contextChars) {
      if (!selected.length) invalid('最近一条对话超过上下文长度上限，请缩短消息')
      break
    }
    used += cost
    selected.unshift({ role: message.role, content: message.content, ...(images.length ? { images: images.map(image => ({ ...image })) } : {}) })
  }
  return { messages: [{ role: 'system', content: system }, ...selected], activeWorldInfoIds: activeWorldInfo.map(entry => entry.id) }
}
