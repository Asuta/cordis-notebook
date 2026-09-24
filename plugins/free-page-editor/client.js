import { createHistory } from './history.js'

export default function(ctx, sdk) {
  const model = ctx.notebook, states = new Map(), nodes = new Map()
  let noteId = null, selected = null, gesture = null, frame = 0, composing = false
  const root = sdk.el('section', { class: 'free-page', 'aria-label': '自由页面编辑器' })
  const controls = sdk.el('div', { class: 'free-page-controls' })
  const add = sdk.el('button', {}, '＋ 文字块'), undo = sdk.el('button', { 'aria-label': '撤销文字块操作' }, '↶ 撤销'), redo = sdk.el('button', { 'aria-label': '重做文字块操作' }, '↷ 重做'), remove = sdk.el('button', {}, '删除文字块')
  controls.append(add, undo, redo, remove, sdk.el('span', {}, '双击空白处书写 · 拖动手柄移动'))
  const viewport = sdk.el('div', { class: 'free-page-viewport', tabIndex: 0, 'aria-label': '自由页面纸张' })
  const paper = sdk.el('div', { class: 'free-page-paper' })
  viewport.append(paper); root.append(controls, viewport)
  const style = sdk.el('link', { rel: 'stylesheet', href: '/builtin/free-page-editor/style.css' })
  sdk.effect(() => { document.head.append(style); return () => style.remove() })
  ctx.editorHost.register(ctx, 'freeform', root)
  const blocks = () => model.current()?.blocks || []
  const state = () => {
    if (!states.has(noteId)) {
      let scroll = [0, 0]
      try { const saved = JSON.parse(sessionStorage.getItem('cordis-page-scroll-' + noteId)); if (Array.isArray(saved) && saved.length === 2 && saved.every(Number.isFinite)) scroll = saved.map(n => Math.max(0, Math.min(10000000, n))) } catch {}
      states.set(noteId, { history: createHistory(), scroll })
    }
    return states.get(noteId)
  }
  const saveScroll = () => {
    if (!noteId || !viewport.isConnected || root.hidden) return
    state().scroll = [viewport.scrollLeft, viewport.scrollTop]
    try { sessionStorage.setItem('cordis-page-scroll-' + noteId, JSON.stringify(state().scroll)) } catch {}
  }
  const stopGesture = () => { if (frame) cancelAnimationFrame(frame); frame = 0; gesture = null; if (noteId) state().history.breakGroup() }
  const updateButtons = () => {
    const history = noteId && state().history, disabled = !noteId || model.busy || !model.editable
    add.disabled = disabled; undo.disabled = disabled || !history?.canUndo; redo.disabled = disabled || !history?.canRedo
    remove.disabled = disabled || !blocks().some(block => block.id === selected)
  }
  const select = id => {
    selected = id
    for (const [key, item] of nodes) item.node.classList.toggle('selected', key === id)
    updateButtons()
  }
  const commit = (next, group = null) => {
    if (!noteId || model.busy || !model.editable) return false
    const previous = blocks()
    if (JSON.stringify(previous) === JSON.stringify(next)) return true
    try {
      model.edit({ blocks: next })
      state().history.record(previous, group); updateButtons(); return true
    } catch (error) { sdk.toast(error.message); render(); return false }
  }
  const resizePaper = () => {
    let width = viewport.clientWidth, height = viewport.clientHeight
    for (const block of blocks()) {
      width = Math.max(width, block.x + block.width + 160)
      height = Math.max(height, block.y + (nodes.get(block.id)?.node.offsetHeight || 100) + 220)
    }
    // Keep the current scroll location stable when moving or deleting an edge block.
    paper.style.width = Math.max(width, viewport.scrollLeft + viewport.clientWidth) + 'px'
    paper.style.height = Math.max(height, viewport.scrollTop + viewport.clientHeight) + 'px'
  }
  const addBlock = (x, y) => {
    const block = { id: crypto.randomUUID(), x: Math.max(0, x), y: Math.max(0, y), width: 320, text: '' }
    if (commit([...blocks(), block])) { select(block.id); nodes.get(block.id)?.text.focus() }
  }
  const travel = direction => {
    if (!noteId || model.busy || !model.editable || composing) return
    stopGesture()
    const next = state().history[direction](blocks())
    if (next) { model.edit({ blocks: next }); updateButtons() }
  }
  const move = () => {
    if (!gesture || model.busy || !model.editable || model.selected !== noteId) { stopGesture(); return }
    const g = gesture, rect = viewport.getBoundingClientRect()
    const speed = (point, low, high) => point < low + 35 ? -14 : point > high - 35 ? 14 : 0
    const dx = speed(g.clientX, rect.left, rect.right), dy = speed(g.clientY, rect.top, rect.bottom)
    if (dx > 0) paper.style.width = Math.max(paper.offsetWidth, viewport.scrollLeft + viewport.clientWidth + 100) + 'px'
    if (dy > 0) paper.style.height = Math.max(paper.offsetHeight, viewport.scrollTop + viewport.clientHeight + 100) + 'px'
    viewport.scrollBy(dx, dy)
    const x = g.clientX - rect.left + viewport.scrollLeft, y = g.clientY - rect.top + viewport.scrollTop
    const patch = g.kind === 'move' ? { x: Math.max(0, Math.min(10000000, g.block.x + x - g.x)), y: Math.max(0, Math.min(10000000, g.block.y + y - g.y)) }
      : { width: Math.max(120, Math.min(4000, g.block.width + x - g.x)) }
    commit(blocks().map(block => block.id === g.block.id ? { ...block, ...patch } : block), 'gesture:' + g.block.id)
    frame = requestAnimationFrame(move)
  }
  const startGesture = (event, blockId, kind) => {
    if (event.button !== 0 || model.busy || !model.editable) return
    event.preventDefault(); stopGesture(); select(blockId)
    const block = blocks().find(block => block.id === blockId), rect = viewport.getBoundingClientRect()
    gesture = { kind, block, x: event.clientX - rect.left + viewport.scrollLeft, y: event.clientY - rect.top + viewport.scrollTop, clientX: event.clientX, clientY: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
    frame = requestAnimationFrame(move)
  }
  function render() {
    const note = model.current(), nextId = note && ctx.noteFormats.typeOf(note) === 'freeform' ? note.id : null
    const changed = nextId !== noteId
    if (changed) { saveScroll(); stopGesture(); noteId = nextId; selected = null; nodes.clear(); paper.replaceChildren(); composing = false }
    if (!noteId) return
    if (model.busy) stopGesture()
    const current = note.blocks || [], ids = new Set(current.map(block => block.id))
    for (const [id, item] of nodes) if (!ids.has(id)) { item.node.remove(); nodes.delete(id) }
    for (const block of current) {
      let item = nodes.get(block.id)
      if (!item) {
        const node = sdk.el('div', { class: 'free-block' }), handle = sdk.el('button', { class: 'free-block-handle', title: '拖动移动；方向键微调', 'aria-label': '移动文字块' }, '⠿')
        const text = sdk.el('textarea', { class: 'free-block-text', spellcheck: false, placeholder: '输入文字…', 'aria-label': '文字块正文', maxLength: 200000 })
        const grip = sdk.el('button', { class: 'free-block-resize', title: '拖动调整宽度；左右键微调', 'aria-label': '调整文字块宽度' })
        node.append(handle, text, grip); paper.append(node); item = { node, text, handle, grip }; nodes.set(block.id, item)
        // Element-owned handlers disappear with the node, without growing context listeners.
        text.onfocus = () => { select(block.id); state().history.breakGroup() }
        text.onblur = () => state().history.breakGroup()
        text.oncompositionstart = () => { composing = true }
        text.oncompositionend = () => { composing = false }
        text.oninput = () => commit(blocks().map(value => value.id === block.id ? { ...value, text: text.value } : value), 'text:' + block.id)
        handle.onpointerdown = event => startGesture(event, block.id, 'move')
        grip.onpointerdown = event => startGesture(event, block.id, 'resize')
        for (const control of [handle, grip]) {
          control.onfocus = () => select(block.id)
          control.onkeydown = event => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
            event.preventDefault()
            const delta = event.shiftKey ? 10 : 1, current = blocks().find(value => value.id === block.id)
            const patch = control === grip ? { width: Math.max(120, Math.min(4000, current.width + (event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0))) }
              : { x: Math.max(0, Math.min(10000000, current.x + (event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0))), y: Math.max(0, Math.min(10000000, current.y + (event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0))) }
            commit(blocks().map(value => value.id === block.id ? { ...value, ...patch } : value))
          }
        }
      }
      item.node.style.left = block.x + 'px'; item.node.style.top = block.y + 'px'; item.node.style.width = block.width + 'px'
      if (item.text.value !== block.text) item.text.value = block.text
      item.text.disabled = item.handle.disabled = item.grip.disabled = model.busy || !model.editable
      item.text.style.height = 'auto'; item.text.style.height = Math.max(44, item.text.scrollHeight) + 'px'
      item.node.classList.toggle('selected', block.id === selected)
    }
    resizePaper()
    if (changed) {
      const [left, top] = state().scroll
      paper.style.width = Math.max(paper.offsetWidth, left + viewport.clientWidth) + 'px'
      paper.style.height = Math.max(paper.offsetHeight, top + viewport.clientHeight) + 'px'
      viewport.scrollTo(left, top)
    }
    updateButtons()
  }
  sdk.listen(add, 'click', () => addBlock(viewport.scrollLeft + 32, viewport.scrollTop + 40))
  sdk.listen(undo, 'click', () => travel('undo')); sdk.listen(redo, 'click', () => travel('redo'))
  sdk.listen(remove, 'click', () => { if (selected) { commit(blocks().filter(block => block.id !== selected)); select(null) } })
  sdk.listen(paper, 'dblclick', event => { if (event.target === paper && !model.busy) { const rect = paper.getBoundingClientRect(); addBlock(event.clientX - rect.left, event.clientY - rect.top) } })
  sdk.listen(paper, 'pointerdown', event => { if (event.target === paper) { select(null); state().history.breakGroup() } })
  sdk.listen(root, 'pointermove', event => { if (gesture) { gesture.clientX = event.clientX; gesture.clientY = event.clientY } })
  sdk.listen(root, 'pointerup', stopGesture); sdk.listen(root, 'pointercancel', stopGesture); sdk.listen(root, 'lostpointercapture', stopGesture)
  sdk.listen(root, 'keydown', event => {
    if (event.isComposing || composing) return
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
      event.preventDefault(); travel(event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo')
    }
    if (event.key === 'Delete' && event.target.tagName !== 'TEXTAREA' && selected) { event.preventDefault(); remove.click() }
  })
  sdk.listen(viewport, 'scroll', saveScroll)
  const observer = new ResizeObserver(() => { if (noteId) { for (const item of nodes.values()) { item.text.style.height = 'auto'; item.text.style.height = Math.max(44, item.text.scrollHeight) + 'px' }; resizePaper() } })
  observer.observe(viewport)
  ctx.effect(() => () => { saveScroll(); stopGesture(); observer.disconnect(); states.clear(); nodes.clear() })
  model.observe(ctx, render)
}
