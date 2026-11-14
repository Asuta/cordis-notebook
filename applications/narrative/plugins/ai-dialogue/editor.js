import { el, button, field, input, select } from './ui.js'
import { characterFor } from './chat.js'

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
  const node = engine.project.nodes.find(item => item.id === engine.selection.nodeId)
  if (node?.type === 'chat') {
    const chat = { characterId: node.stage?.characterId || '', prompt: '', maxTurns: 4, next: '', label: '继续剧情', demoReplies: [], ...node.chat }
    const patch = (key, value) => update(project => {
      const selected = project.nodes.find(item => item.id === node.id)
      if (!selected || selected.type !== 'chat') throw Error('selection changed')
      selected.chat = { ...chat, ...selected.chat, [key]: value }
    })
    const speaker = select(chat.characterId, [['', '使用舞台角色'], ...engine.project.characters.map(character => [character.id, character.name])], value => patch('characterId', value))
    const prompt = input(chat.prompt, value => patch('prompt', value), { multiline: true })
    const turns = input(chat.maxTurns, value => {
      const number = Number(value)
      if (!Number.isInteger(number) || number < 1 || number > 100) { turns.setCustomValidity('请输入 1–100 的整数'); turns.reportValidity(); return }
      turns.setCustomValidity(''); patch('maxTurns', number)
    }, { type: 'number', event: 'change' })
    turns.min = '1'; turns.max = '100'; turns.step = '1'
    const next = select(chat.next || node.next || '', [['', '不设置'], ...engine.project.nodes.filter(item => item.id !== node.id).map(item => [item.id, item.title])], value => {
      update(project => {
        const selected = project.nodes.find(item => item.id === node.id)
        if (!selected) return
        selected.chat = { ...chat, ...selected.chat, next: value }
        selected.next = value
      })
    })
    const label = input(chat.label, value => patch('label', value), { maxLength: 160 })
    projectFieldset.append(el('h3', 'ne-section-title', '聊天节点 · ' + node.title), field('对话角色', speaker), field('本节点聊天提示', prompt), field('最多对话轮数', turns), field('后续节点', next), field('继续按钮文字', label), el('p', 'ne-muted', '玩家可以提前继续；达到轮数后停止发送。若节点有分支选项，需通过原有选项与条件继续。'))
    const welcome = node.lines?.[0] || { speaker: chat.characterId, text: '' }
    projectFieldset.append(field('开场对白', input(welcome.text, value => update(project => {
      const selected = project.nodes.find(item => item.id === node.id)
      if (!selected) return
      if (!selected.lines.length) selected.lines.push({ speaker: characterFor(project, selected)?.id || '', text: value })
      else selected.lines[0].text = value
    }), { multiline: true })))
    const demoList = el('div', 'ne-stack')
    projectFieldset.append(el('h3', 'ne-section-title', '示例对话'), el('p', 'ne-muted', '未配置接口和模型时，按本节点已完成轮数依次使用作者写好的回复。用完后不会自动编造或循环。'), demoList)
    let replies = [...chat.demoReplies]
    const drawReplies = () => {
      demoList.replaceChildren()
      replies.forEach((reply, index) => {
        const row = el('div', 'ne-stack ne-ai-demo-row')
        row.append(field('第 ' + (index + 1) + ' 轮示例回复', input(reply, value => { replies[index] = value; patch('demoReplies', [...replies]) }, { multiline: true })), button('删除第 ' + (index + 1) + ' 轮', () => { replies.splice(index, 1); patch('demoReplies', [...replies]); drawReplies() }))
        demoList.append(row)
      })
      const add = button('添加示例回复', () => { if (replies.length < 100) { replies.push(''); patch('demoReplies', [...replies]); drawReplies() } })
      add.disabled = replies.length >= 100
      demoList.append(add, el('small', 'ne-muted', '已编写 ' + replies.length + ' 条示例回复。'))
    }
    drawReplies()
  } else projectFieldset.append(el('p', 'ne-empty', '在剧情图中选中聊天节点，可编辑提示、轮数、后续剧情和示例回复。'))
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
  card.append(el('h3', 'ne-section-title', 'AI 连接'), el('p', 'ne-muted', '接口和模型默认留空，使用示例对话。密钥只保存在服务器私有设置中，不随作品导出。'), connectionFields, notice)
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
