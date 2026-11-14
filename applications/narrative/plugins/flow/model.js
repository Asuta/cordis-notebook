const stageDefaults = { background: '', characterId: '', expression: 'neutral', position: 50, scale: 100 }

export function createNode(type, characters = []) {
  const node = {
    id: `${type}-${crypto.randomUUID()}`, type,
    title: { story: '新的剧情', chat: '新的聊天', ending: '新的结局' }[type] || '新节点',
    stage: { ...stageDefaults }, lines: [], choices: [], next: '',
  }
  if (type === 'chat') node.chat = { characterId: characters[0]?.id || '', prompt: '', maxTurns: 4, next: '', label: '继续剧情', demoReplies: [] }
  return node
}

export function flowEdges(nodes) {
  const ids = new Set(nodes.map(node => node.id)), edges = []
  for (const node of nodes) {
    if (node.type === 'ending') continue
    if (node.type !== 'chat' && node.choices?.length) {
      for (const choice of node.choices) if (ids.has(choice.target)) edges.push({ from: node.id, to: choice.target, label: choice.text || '选项' })
      continue
    }
    const next = node.type === 'chat' ? node.chat?.next || node.next : node.next
    if (ids.has(next)) edges.push({ from: node.id, to: next, label: '继续' })
  }
  return edges
}

export function createFlowHandlers(engine) {
  const active = node => engine.mode === 'play' && engine.runtime?.nodeId === node.id
  const textAt = (node, index) => ({ speaker: node.lines?.[index]?.speaker || '', text: node.lines?.[index]?.text || '' })
  const enter = node => {
    if (!active(node)) return
    engine.transact(runtime => {
      runtime.lineIndex = 0
      runtime.text = textAt(node, 0)
      runtime.stage = { ...stageDefaults, ...node.stage }
      runtime.ended = node.type === 'ending' && (node.lines?.length || 0) <= 1
    })
  }
  const advance = async node => {
    if (!active(node) || engine.runtime.ended || engine.runtime.busy || engine.held) return
    const index = engine.runtime.lineIndex + 1
    if (index < (node.lines?.length || 0)) {
      engine.transact(runtime => {
        runtime.lineIndex = index
        runtime.text = textAt(node, index)
        runtime.ended = node.type === 'ending' && index >= node.lines.length - 1
      })
      return
    }
    // A branch must be selected explicitly, even when every condition is false.
    if (node.type !== 'ending' && node.choices?.length) return
    if (node.type !== 'ending' && node.next) return await engine.go(node.next)
    engine.transact(runtime => { runtime.ended = true })
  }
  return { story: { type: 'story', label: '剧情', color: '#8c7bdf', enter, advance }, ending: { type: 'ending', label: '结局', color: '#e2aa63', enter, advance } }
}
