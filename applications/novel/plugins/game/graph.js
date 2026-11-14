import { diagnose, commandIssues } from './model.js'
import { el, button, select, field, heading } from './ui.js'

export function graph(p, view, update, openScene, play) {
  const root = el('div', 'novel-graph'), issues = [...diagnose(p), ...commandIssues(p)]
  root.append(heading('剧情连线', '拖动场景整理位置 · 在连接面板调整目标 · 连线箭头表示剧情方向'))
  if (issues.length) root.append(el('details', 'novel-diagnostics has-issues', el('summary', '', issues.length + ' 项剧情检查提示'), issues.map(x => el('p', '', x))))
  const controls = el('div', 'novel-control-row'), viewport = el('div', 'novel-graph-viewport'), canvas = el('div', 'novel-graph-canvas')
  let zoom = view.graphZoom || 1, connecting = null
  const setZoom = value => { zoom = Math.max(.4, Math.min(1.5, value)); view.graphZoom = zoom; canvas.style.zoom = zoom }
  controls.append(button('− 缩小', () => setZoom(zoom - .1), 'novel-secondary'), button('＋ 放大', () => setZoom(zoom + .1), 'novel-secondary'), button('自动排列', () => update(project => { for (const s of project.scenes) delete s.position }, true), 'novel-secondary'))
  const depths = new Map([[p.startSceneId, 0]]), queue = [p.startSceneId]
  const links = scene => [...scene.choices.map(c => ({ id: c.id, text: c.text, targetId: c.targetId, kind: 'choice' })), ...(scene.commands || []).filter(c => c.type === 'jump').map(c => ({ id: c.id, text: '跳转', targetId: c.targetId, kind: 'jump' }))]
  while (queue.length) { const id = queue.shift(), s = p.scenes.find(s => s.id === id); if (!s) continue; for (const edge of links(s)) if (p.scenes.some(s => s.id === edge.targetId) && !depths.has(edge.targetId)) { depths.set(edge.targetId, depths.get(id) + 1); queue.push(edge.targetId) } }
  const rows = new Map(), positions = new Map(), nodes = new Map()
  for (const s of p.scenes) { const d = depths.get(s.id) ?? 0, row = rows.get(d) || 0; rows.set(d, row + 1); positions.set(s.id, s.position || { x: 35 + d * 365, y: 35 + row * 190 }) }
  const width = Math.max(1000, ...[...positions.values()].map(pos => pos.x + 300)), height = Math.max(500, ...[...positions.values()].map(pos => pos.y + 190))
  canvas.style.width = width + 'px'; canvas.style.height = height + 'px'; setZoom(zoom)
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('novel-graph-edges'); svg.setAttribute('width', width); svg.setAttribute('height', height)
  function edges() {
    svg.replaceChildren()
    for (const s of p.scenes) for (const [i, edge] of links(s).entries()) {
      const from = positions.get(s.id), to = positions.get(edge.targetId); if (!to) continue
      const path = document.createElementNS(svg.namespaceURI, 'path'), x = from.x + 245, y = from.y + 62 + Math.min(i, 4) * 20, tx = to.x, ty = to.y + 65
      const bend = Math.max(65, Math.abs(tx - x) / 2)
      path.setAttribute('d', 'M ' + x + ' ' + y + ' C ' + (x + bend) + ' ' + y + ', ' + (tx - bend) + ' ' + ty + ', ' + tx + ' ' + ty)
      path.setAttribute('fill', 'none'); path.setAttribute('stroke', '#bd9c69'); path.setAttribute('stroke-width', '2'); svg.append(path)
      const label = document.createElementNS(svg.namespaceURI, 'text'); label.setAttribute('x', x + 12); label.setAttribute('y', y - 8); label.setAttribute('fill', '#bfae92'); label.setAttribute('font-size', '10'); label.textContent = edge.text.length > 8 ? edge.text.slice(0, 8) + '…' : edge.text; svg.append(label)
      const arrow = document.createElementNS(svg.namespaceURI, 'path'); arrow.setAttribute('d', 'M ' + (tx - 8) + ' ' + (ty - 5) + ' L ' + tx + ' ' + ty + ' L ' + (tx - 8) + ' ' + (ty + 5)); arrow.setAttribute('fill', 'none'); arrow.setAttribute('stroke', '#e6c58e'); arrow.setAttribute('stroke-width', '2'); svg.append(arrow)
    }
  }
  canvas.append(svg)
  const inspector = el('section', 'novel-panel')
  function inspect(scene) {
    view.graphSceneId = scene.id
    for (const [id, node] of nodes) node.classList.toggle('selected', id === scene.id)
    inspector.replaceChildren(heading('连接 · ' + scene.title))
    for (const edge of links(scene)) inspector.append(field(edge.text, select(edge.targetId, [{ value: '', label: '未连接' }, ...p.scenes.map(s => ({ value: s.id, label: s.title }))], value => update(project => { const s = project.scenes.find(s => s.id === scene.id); const item = (edge.kind === 'jump' ? s.commands : s.choices).find(x => x.id === edge.id); item.targetId = value }, true))))
    if (!links(scene).length) inspector.append(el('p', '', scene.ending ? '结局场景' : '还没有连接，在剧本中添加分支选项或跳转指令。'))
  }
  for (const s of p.scenes) {
    const pos = positions.get(s.id), node = el('article', 'novel-graph-node' + (!depths.has(s.id) ? ' unreachable' : ''))
    node.dataset.sceneId = s.id; node.style.left = pos.x + 'px'; node.style.top = pos.y + 'px'
    const handle = el('div', 'novel-graph-handle', el('span', 'novel-eyebrow', s.id === p.startSceneId ? 'START / 起点' : s.ending ? 'ENDING / 结局' : 'SCENE / 场景'), el('strong', '', s.title))
    node.append(handle, el('small', '', s.lines.length + ' 句对白 · ' + links(s).length + ' 条连接'), el('div', 'novel-control-row', button('编辑', () => openScene(s.id), 'novel-secondary'), button('连接', () => inspect(s), 'novel-secondary'), button('▶', () => play(s.id), 'novel-inline-action')))
    node.append(button('从此连线 →', event => {
      event.stopPropagation()
      if (!connecting) { connecting = s.id; for (const node of nodes.values()) node.querySelector('.novel-connect-port').textContent = '连接到此'; node.querySelector('.novel-connect-port').textContent = '取消连线' }
      else if (connecting === s.id) { connecting = null; for (const node of nodes.values()) node.querySelector('.novel-connect-port').textContent = '从此连线 →' }
      else { const source = connecting; update(project => { const origin = project.scenes.find(s => s.id === source); origin.ending = false; origin.choices.push({ id: crypto.randomUUID(), text: '前往' + s.title, targetId: s.id, condition: null, effects: [] }); if (!origin.commands.some(c => c.type === 'choice')) { const at = origin.commands.findIndex(c => c.type === 'jump'); origin.commands.splice(at < 0 ? origin.commands.length : at, 0, { id: crypto.randomUUID(), type: 'choice' }) } }, true) }
    }, 'novel-inline-action novel-connect-port'))
    node.addEventListener('click', () => inspect(s))
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return; event.preventDefault(); handle.setPointerCapture(event.pointerId)
      const began = { ...positions.get(s.id) }, start = { ...positions.get(s.id) }
      const pointer = { x: event.clientX, y: event.clientY }
      const move = e => { const x = Math.max(0, Math.min(9700, start.x + (e.clientX - pointer.x) / zoom)), y = Math.max(0, Math.min(9700, start.y + (e.clientY - pointer.y) / zoom)); positions.set(s.id, { x, y }); node.style.left = x + 'px'; node.style.top = y + 'px'; edges() }
      const done = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', done); handle.removeEventListener('pointercancel', done); const pos = positions.get(s.id); if (pos.x !== began.x || pos.y !== began.y) update(project => { project.scenes.find(x => x.id === s.id).position = { x: Math.round(pos.x), y: Math.round(pos.y) } }, true) }
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', done); handle.addEventListener('pointercancel', done)
    })
    nodes.set(s.id, node); canvas.append(node)
  }
  edges(); inspect(p.scenes.find(s => s.id === view.graphSceneId) || p.scenes[0]); viewport.append(canvas); root.append(controls, viewport, inspector); return root
}
