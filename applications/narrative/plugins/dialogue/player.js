export function createDialoguePlayer(engine, changed = () => {}) {
  let pending = false, disposed = false, lockedRuntime, lockedNode
  const live = runtime => !disposed && engine.mode === 'play' && engine.runtime === runtime
  function view() {
    const node = engine.scene(), runtime = engine.mode === 'play' ? engine.runtime : null
    if (!node || node.type === 'chat') return null
    const lineIndex = runtime?.lineIndex ?? 0
    const atEnd = lineIndex >= node.lines.length - 1
    const text = runtime ? runtime.text : node.lines[lineIndex] || { speaker: '', text: '' }
    const choices = atEnd && !runtime?.ended && node.type !== 'ending' ? node.choices.map(choice => {
      let available = false, reason = ''
      try {
        available = engine.test(choice.condition)
        if (!available) reason = '条件未满足'
      } catch (error) { reason = error.message }
      if (!engine.project.nodes.some(item => item.id === choice.target)) { available = false; reason = '尚未连接目标节点' }
      return { ...choice, available, reason }
    }) : []
    return { node, text, lineIndex, atEnd, choices, playing: !!runtime, ended: !!runtime?.ended, busy: pending || !!runtime?.busy || engine.held, style: engine.project.settings.dialogueStyle }
  }
  async function advance() {
    const state = view()
    if (disposed || !state?.playing || state.busy || state.ended || (state.atEnd && state.node.choices.length)) return false
    pending = true; changed()
    try { await engine.advance(); return true } finally { pending = false; if (!disposed) changed() }
  }
  async function choose(id) {
    const state = view()
    if (disposed || !state?.playing || state.busy || state.ended || !state.atEnd) return false
    const choice = state.node.choices.find(item => item.id === id)
    if (!choice || !engine.test(choice.condition) || !engine.project.nodes.some(node => node.id === choice.target)) return false
    const runtime = engine.runtime, nodeId = state.node.id
    pending = true; lockedRuntime = runtime; lockedNode = nodeId
    engine.transact(next => { next.busy = true })
    changed()
    const payload = { nodeId, choiceId: choice.id, choice }
    try {
      await engine.runActions(choice.actions || [], payload)
      if (!live(runtime)) return false
      await engine.emit('choice.select', payload)
      if (!live(runtime)) return false
      await engine.go(choice.target)
      return true
    } finally {
      pending = false; lockedRuntime = null
      // The destination chat handler may own a different busy operation.
      if (engine.mode === 'play' && engine.runtime === runtime && runtime.nodeId === nodeId) engine.transact(next => { next.busy = false })
      if (!disposed) changed()
    }
  }
  return { view, advance, choose, dispose() {
    disposed = true
    if (lockedRuntime && engine.mode === 'play' && engine.runtime === lockedRuntime && lockedRuntime.nodeId === lockedNode) engine.transact(next => { next.busy = false })
  } }
}
