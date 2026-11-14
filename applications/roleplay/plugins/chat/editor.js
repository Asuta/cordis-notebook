import { button, el, field, selectInput, textArea, textInput, toggle, uid } from './ui.js'
import { openingFields, playerFields } from './story-editor.js'
import { artFor } from './experience.js'
import { prepareImage } from './chat.js'

const intro = (eyebrow, title, detail) => el('div', 'rp-editor-heading', el('span', 'rp-eyebrow', eyebrow), el('h1', '', title), el('p', '', detail))
const card = (...children) => el('section', 'rp-editor-card', ...children)

export function renderEditor({ project, section, onChange, onPreview, settings, onSaveSettings, onTestSettings, onError = () => {} }) {
  const root = el('div', 'rp-editor-page')
  if (section === 'character') {
    root.append(intro('CHARACTER CARD', '人物卡', '定义 NPC 的身份、性格和回应方式。修改会自动保存。'))
    const c = project.character
    root.append(card(
      el('div', 'rp-card-title', el('div', 'rp-avatar rp-avatar-large', c.name?.slice(0, 1) || '人'), el('div', '', el('h2', '', c.name || '新角色'), el('p', '', '角色的固定设定将作为对话基础上下文。'))),
      field('作品名称', textInput(project.title, value => { project.title = value; onChange() }, '用于标识这段角色扮演设定')),
      field('作品简介', textArea(project.description, value => { project.description = value; onChange() }, '这张人物卡的创作备注。', 2)),
      field('姓名', textInput(c.name, value => { c.name = value; onChange() }, '给这位角色一个名字')),
      field('角色简介', textArea(c.description, value => { c.description = value; onChange() }, '一句话介绍角色，适合展示在人物卡首页。', 3)),
      field('性格特征', textArea(c.personality, value => { c.personality = value; onChange() }, '例如：外冷内热、观察敏锐，不会轻易承认自己在意别人。')),
      field('背景故事', textArea(c.background, value => { c.background = value; onChange() }, '角色经历、重要关系、隐瞒的往事。')),
      field('当前情境', textArea(c.scenario, value => { c.scenario = value; onChange() }, '描述此刻的地点、时间和角色正在做的事。')),
      field('初次见面', textArea(c.greeting, value => { c.greeting = value; onChange() }, '新对话开场时由 NPC 说出的第一句话。', 3)),
      field('示例对话', textArea(c.exampleDialogue, value => { c.exampleDialogue = value; onChange() }, '用几轮示例展示角色的语气；可以留空。', 5)),
    ))
  } else if (section === 'player') {
    root.append(intro('YOUR PERSONA', '玩家身份', '设定玩家在故事里是谁。此处是新故事的默认身份，已有故事可在聊天页单独修改。'),
      card(playerFields(project.player, onChange)))
  } else if (section === 'opening') {
    root.append(intro('OPENING SCENE', '开场情境', '设计故事的第一幕：在哪里、发生了什么，以及 NPC 如何开口。新建故事时使用这里的设定。'),
      card(openingFields(project.opening, onChange),
        field('NPC 开场白', textArea(project.character.greeting, value => { project.character.greeting = value; onChange() }, '用 *动作和环境* 与「对白」编写第一幕。', 6)),
        el('p', 'rp-hint', '开场应给玩家留出回应空间。修改不会覆盖已有对话的消息。')))
  } else if (section === 'visual') {
    root.append(intro('ART DIRECTION', '画面与氛围', '设置角色立绘、场景背景与配色。图片保存在本地作品中，可离线显示。'),
      card(field('氛围配色', selectInput(project.presentation.theme, [['amber', '雨夜暖灯'], ['forest', '静谧青绿'], ['midnight', '午夜蓝调']], value => { project.presentation.theme = value; onChange() })),
        artworkField('portrait', '角色立绘', '建议使用竖向图片，人物位于画面中央。'),
        artworkField('background', '场景背景', '建议使用横向场景图，文字区域会加深处理以保持可读性。')))
  } else if (section === 'attributes') {
    root.append(intro('CHARACTER ATTRIBUTES', '属性编辑', '添加任何你需要的角色属性。属性值会作为设定提供给 AI，不会被 AI 擅自改写。'))
    root.append(card(
      el('div', 'rp-card-toolbar', el('div', '', el('h2', '', '自定义属性'), el('p', '', '例如年龄、身份、信任度、随身物品或当前状态。')),
        button('＋ 添加属性', () => { project.attributes.push({ id: uid(), name: '新属性', value: '', description: '', includeInContext: true }); onChange(true) }, 'rp-button rp-button-primary')),
      project.attributes.length ? el('div', 'rp-attribute-list', project.attributes.map((attribute, index) => el('div', 'rp-repeat-card',
        el('div', 'rp-repeat-heading', el('span', 'rp-number', String(index + 1).padStart(2, '0')), el('strong', '', attribute.name || '未命名属性'), button('删除', () => { project.attributes.splice(index, 1); onChange(true) }, 'rp-button rp-button-danger')),
        el('div', 'rp-two-col', field('属性名称', textInput(attribute.name, value => { attribute.name = value; onChange() }, '例如：职业')),
          field('当前值', textInput(attribute.value, value => { attribute.value = value; onChange() }, '例如：夜班图书管理员'))),
        field('补充说明', textArea(attribute.description, value => { attribute.description = value; onChange() }, '告诉 AI 如何理解这个属性。', 2)),
        toggle(attribute.includeInContext, value => { attribute.includeInContext = value; onChange() }, '将此属性提供给 AI'),
      ))) : el('div', 'rp-empty-state', '还没有自定义属性。点击“添加属性”开始设置。'),
    ))
  } else if (section === 'world') {
    root.append(intro('WORLD INFORMATION', '世界观', '把零散设定整理成可按需注入对话的条目，避免每轮都发送整本设定集。'))
    root.append(card(
      el('div', 'rp-card-toolbar', el('div', '', el('h2', '', '世界信息条目'), el('p', '', '常驻条目始终生效；其他条目会在聊天内容命中关键词时加入上下文。')),
        button('＋ 添加条目', () => { project.worldInfo.push({ id: uid(), title: '新世界设定', keys: [], content: '', enabled: true, alwaysActive: false }); onChange(true) }, 'rp-button rp-button-primary')),
      project.worldInfo.length ? el('div', 'rp-world-list', project.worldInfo.map((entry, index) => el('article', 'rp-world-item',
        el('div', 'rp-repeat-heading', el('div', '', el('span', 'rp-number', String(index + 1).padStart(2, '0')), el('strong', '', entry.title || '未命名条目')),
          button('删除', () => { project.worldInfo.splice(index, 1); onChange(true) }, 'rp-button rp-button-danger')),
        field('条目标题', textInput(entry.title, value => { entry.title = value; onChange() }, '便于自己识别的名称')),
        field('触发关键词', textInput((entry.keys || []).join(', '), value => { entry.keys = value.split(',').map(word => word.trim()).filter(Boolean); onChange() }, '用英文逗号分隔，例如：北塔, 观星台')),
        field('设定内容', textArea(entry.content, value => { entry.content = value; onChange() }, '写下需要在对应话题出现时提供给 AI 的信息。', 4)),
        el('div', 'rp-toggle-row', toggle(entry.enabled, value => { entry.enabled = value; onChange() }, '启用'), toggle(entry.alwaysActive, value => { entry.alwaysActive = value; onChange() }, '始终注入')),
      ))) : el('div', 'rp-empty-state', '还没有世界信息。可以先写下地点、组织或人物关系。'),
    ))
  } else if (section === 'context') {
    root.append(intro('CONTEXT & PROMPT', '上下文设置', '决定每次聊天发送给模型的内容与顺序，并检查实际上下文预览。'))
    root.append(card(
      el('div', 'rp-card-toolbar', el('div', '', el('h2', '', '提示词与记忆范围'), el('p', '', '默认组装顺序：系统指令、人物卡、属性、世界条目、作者备注、最近对话。')),
        button('⌕ 预览实际上下文', onPreview, 'rp-button rp-button-secondary')),
      field('系统指令', textArea(project.context.systemPrompt, value => { project.context.systemPrompt = value; onChange() }, '你是一个沉浸式角色扮演中的 NPC……', 6), '用于约束 AI 的整体行为和回复格式。'),
      field('作者备注', textArea(project.context.authorNote, value => { project.context.authorNote = value; onChange() }, '希望 AI 在近期对话中持续记住的创作方向。', 4), '每轮都会提供给模型，可放置临时剧情重点。'),
      el('div', 'rp-two-col', field('纳入最近消息条数', numberInput(project.context.maxHistoryMessages, value => { project.context.maxHistoryMessages = value; onChange() }, 0, 100), '包含玩家和 NPC 的发言；数量越多，消耗的上下文越多。'),
        field('回复长度上限', numberInput(project.context.maxTokens, value => { project.context.maxTokens = value; onChange() }, 1, 8192), '模型支持时使用。')),
      field('随机度', numberInput(project.context.temperature, value => { project.context.temperature = value; onChange() }, 0, 2, 0.05), '较低的值更稳定，较高的值更有变化。'),
    ))
  } else if (section === 'model') {
    root.append(intro('MODEL CONNECTION', '模型连接', '支持 OpenAI Responses 与 Chat Completions 两种接口。密钥只保存在本机应用数据中。'))
    root.append(card(
      el('div', 'rp-card-toolbar', el('div', '', el('h2', '', '对话模型'), el('p', '', '不同于工作台 Agent 的模型设置，这里专门用于 NPC 对话。')),
        el('span', 'rp-key-status ' + (settings.hasApiKey ? 'is-ready' : ''), settings.hasApiKey ? '● 密钥已配置' : '○ 尚未配置密钥')),
      field('接口格式', selectInput(settings.protocol, [['responses', 'OpenAI Responses（/responses）'], ['chat', 'Chat Completions（/chat/completions）']], value => { settings.protocol = value; settings.testStatus = null }), 'Responses 是较新的接口；只提供 Chat Completions 的服务商请切换。'),
      field('API 地址', textInput(settings.baseUrl, value => { settings.baseUrl = value }, 'https://ollama.com/v1'), '填写 API 根地址，例如 https://ollama.com/v1，末尾不要带 /responses。'),
      field('模型名称', textInput(settings.model, value => { settings.model = value }, '例如：deepseek-v4.1-flash:1017'), '需要与服务商提供的模型 ID 完全一致。'),
      field('API Key', secretInput(), settings.hasApiKey ? '输入新密钥可替换现有值；留空会保留当前密钥。' : '密钥不会返回浏览器，也不会写入项目文件。'),
      toggle(false, value => { settings.clearApiKey = value }, '清除已保存的密钥'),
      el('div', 'rp-settings-actions',
        button('保存连接设置', onSaveSettings, 'rp-button rp-button-primary'),
        button('测试连接', onTestSettings, 'rp-button rp-button-secondary rp-test-connection')),
      settings.testStatus && el('p', 'rp-test-result ' + (settings.testStatus.ok ? 'is-ok' : 'is-error'), settings.testStatus.text),
      el('p', 'rp-security-note', '对话内容会发送到上方配置的模型服务商。请确认该服务商的数据处理政策。'),
      el('p', 'rp-security-note', '对话输入支持附带 1–2 张图片（PNG、JPEG 或 WebP），发送前会自动压缩。图片随消息保存，并作为该轮上下文送给模型。'),
    ))
  } else {
    root.append(intro('APP SETTINGS', '设置', '调整发送给模型时的调用参数，对整个应用生效。'))
    root.append(card(
      el('div', 'rp-card-toolbar', el('div', '', el('h2', '', '调用参数'), el('p', '', '只影响 NPC 对话请求，不改变人物卡与上下文内容。')),
        el('span', 'rp-key-status ' + (settings.stream === false ? '' : 'is-ready'), settings.stream === false ? '逐字显示已关闭' : '流式输出已开启')),
      field('思考强度', selectInput(settings.reasoningEffort || 'default', [
        ['default', '服务商默认'], ['off', '关闭思考'], ['low', '低'], ['medium', '中'], ['high', '高'],
      ], value => { settings.reasoningEffort = value }), '取决于模型是否支持；不支持的服务商会忽略这个参数。'),
      field('请求超时（秒）', numberInput(settings.timeoutSeconds ?? 120, value => { settings.timeoutSeconds = value }, 30, 600), '连接或生成超过该时间会中断，并提示请求超时。'),
      toggle(settings.stream !== false, value => { settings.stream = value }, '流式输出（逐字显示回复）'),
      el('p', 'rp-hint', '关闭流式输出后回复一次性返回，生成期间无法中途停止。'),
      el('div', 'rp-settings-actions', button('保存设置', onSaveSettings, 'rp-button rp-button-primary')),
      el('p', 'rp-security-note', '设置保存在本机应用数据目录，不会写入人物卡或对话文件。'),
    ))
  }
  return root

  function artworkField(key, title, hint) {
    const preview = el('img', 'rp-artwork-thumbnail'); preview.src = artFor(project, key); preview.alt = title + '预览'
    const input = el('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp'; input.hidden = true
    input.setAttribute('aria-label', '上传' + title)
    const upload = button('上传' + title, () => input.click(), 'rp-button rp-button-secondary')
    input.addEventListener('change', async () => {
      const file = input.files?.[0]; input.value = ''; if (!file) return
      upload.disabled = true
      try { const image = await prepareImage(file); project.presentation[key] = image.dataUrl; preview.src = image.dataUrl; onChange() }
      catch (error) { onError(error.message) }
      finally { upload.disabled = false }
    })
    return el('div', 'rp-artwork-field', preview, el('div', '', el('h3', '', title), el('p', 'rp-hint', hint), el('div', 'rp-settings-actions', upload,
      button('使用默认插画', () => { project.presentation[key] = ''; preview.src = artFor(project, key); onChange() }, 'rp-button rp-button-secondary')), input))
  }
}

function numberInput(value, action, min, max, step = 1) {
  const node = textInput(value, raw => { const number = Number(raw); if (Number.isFinite(number)) action(Math.max(min, Math.min(max, number))) })
  node.type = 'number'; node.min = String(min); node.max = String(max); node.step = String(step)
  return node
}

function secretInput() {
  const node = el('input', 'rp-input')
  node.type = 'password'; node.autocomplete = 'new-password'; node.placeholder = 'sk-…'
  node.addEventListener('input', () => { node.dataset.value = node.value })
  return node
}
