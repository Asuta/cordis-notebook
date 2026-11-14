import { button, el, field, textArea, textInput, toggle, uid } from './ui.js'

export function playerFields(player, changed) {
  return el('div', 'rp-player-fields',
    field('玩家姓名', textInput(player.name, value => { player.name = value; changed() }, '角色会如何称呼你')),
    field('玩家身份', textArea(player.description, value => { player.description = value; changed() }, '你的年龄、职业、来历、性格或当前目的。', 4)),
    field('与 NPC 的初始关系', textArea(player.relationship, value => { player.relationship = value; changed() }, '例如：初次相识，或多年未见的老朋友。', 3)))
}

export function openingFields(opening, changed) {
  return el('div', '',
    field('章节标题', textInput(opening.title, value => { opening.title = value; changed() }, '例如：雨停之前')),
    el('div', 'rp-two-col', field('地点', textInput(opening.location, value => { opening.location = value; changed() }, '故事发生在哪里')),
      field('时间与氛围', textInput(opening.time, value => { opening.time = value; changed() }, '例如：傍晚 · 细雨'))),
    field('开场发生了什么', textArea(opening.situation, value => { opening.situation = value; changed() }, '让玩家知道身处什么情境、有什么可以回应或探索的事。', 5)))
}

export function memoryFields(memory, changed) {
  const root = el('div', 'rp-memory-fields')
  const facts = el('div', 'rp-memory-facts')
  const renderFacts = () => {
    facts.replaceChildren()
    for (const fact of memory.facts) {
      const input = textArea(fact.content, value => { fact.content = value; changed() }, '记录明确发生的事实或双方约定。', 2)
      input.setAttribute('aria-label', '重要事实或约定')
      facts.append(el('div', 'rp-memory-fact', input, el('div', 'rp-memory-fact-actions',
        toggle(fact.enabled, value => { fact.enabled = value; changed() }, '提供给 AI'),
        button('移除', () => { memory.facts = memory.facts.filter(item => item.id !== fact.id); renderFacts(); changed() }, 'rp-button rp-button-danger'))))
    }
    if (!memory.facts.length) facts.append(el('p', 'rp-hint', '还没有重要约定。可以手动添加，也可以让 AI 从对话整理候选记忆。'))
  }
  root.append(
    field('共同经历', textArea(memory.summary, value => { memory.summary = value; changed() }, '你们已经一起经历了什么？', 4)),
    field('当前情境', textArea(memory.scene, value => { memory.scene = value; changed() }, '当前地点、正在发生的事与尚未解决的问题。', 3)),
    field('当前关系', textArea(memory.relationship, value => { memory.relationship = value; changed() }, '彼此的了解、信任与关系变化。', 3)),
    el('div', 'rp-card-toolbar', el('h3', '', '重要事实与约定'), button('＋ 添加记忆', () => {
      if (memory.facts.length >= 40) return
      memory.facts.push({ id: uid(), content: '', enabled: true }); renderFacts(); changed()
    }, 'rp-button rp-button-secondary')), facts)
  renderFacts()
  return root
}
