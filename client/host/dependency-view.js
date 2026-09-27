import { dependencyGraph } from './dependency-graph.js'
import { dependencyLayout, dependencyPath } from './dependency-layout.js'

let viewSequence = 0
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const svgElement = (tag, attrs = {}) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value)
  return node
}
export function createDependencyView({ el, card, labels, failures }) {
  const uid = 'dependency-network-' + ++viewSequence
  const host = el('section', { id: 'dependency-view', 'aria-label': '插件依赖网图', hidden: true })
  const controls = el('div', { class: 'dependency-controls' })
  const searchBox = el('div', { class: 'dependency-search' })
  const search = el('input', { type: 'search', placeholder: '搜索插件名称或 ID', 'aria-label': '在依赖网图中搜索插件', autocomplete: 'off' })
  const results = el('div', { class: 'dependency-search-results', hidden: true })
  const reset = el('button', { type: 'button' }, '清除选择')
  searchBox.append(search, results); controls.append(searchBox, reset)
  const legend = el('div', { class: 'dependency-legend' })
  for (const [state, label] of [['enabled', '运行中'], ['waiting', '等待服务'], ['disabled', '已停用'], ['failed', '失败']]) {
    const item = el('span'); item.append(el('i', { class: 'dependency-dot ' + state }), document.createTextNode(label)); legend.append(item)
  }
  legend.append(el('span', { class: 'dependency-edge-legend' }, '实线：已绑定'), el('span', { class: 'dependency-edge-legend candidate' }, '虚线：候选，未绑定'))
  const columns = el('div', { class: 'dependency-columns' }), panel = el('div', { class: 'dependency-network' })
  const detail = el('aside', { class: 'dependency-detail', 'aria-label': '选中插件详情' })
  const heading = el('div', { class: 'dependency-network-heading' }), count = el('span')
  heading.append(el('strong', {}, '依赖网图'), count)
  const tools = el('div', { class: 'dependency-network-tools' })
  const zoomOut = el('button', { type: 'button', 'aria-label': '缩小依赖网图' }, '−')
  const zoomIn = el('button', { type: 'button', 'aria-label': '放大依赖网图' }, '+')
  const zoomValue = el('output', { 'aria-label': '网图缩放比例' }, '100%')
  const fit = el('button', { type: 'button' }, '适应全部')
  const locate = el('button', { type: 'button', disabled: true }, '定位所选')
  tools.append(zoomOut, zoomValue, zoomIn, fit, locate)
  const direction = el('p', { class: 'dependency-direction' }, '依赖的插件 → 当前插件 → 依赖它的插件')
  const viewport = el('div', { class: 'dependency-viewport', tabindex: 0, 'aria-label': '依赖网图画布', 'aria-describedby': uid + '-help' })
  const scene = el('div', { class: 'dependency-scene' }), svg = svgElement('svg', { class: 'dependency-lines' })
  const defs = svgElement('defs'), marker = svgElement('marker', { id: uid + '-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto', markerUnits: 'userSpaceOnUse' })
  marker.append(svgElement('path', { d: 'M 1 1 L 9 5 L 1 9 Z', fill: 'context-stroke' })); defs.append(marker); svg.append(defs)
  const nodes = el('div', { class: 'dependency-nodes' }), empty = el('p', { class: 'dependency-empty', hidden: true }, '还没有发现插件。')
  scene.append(svg, nodes); viewport.append(scene, empty)
  const help = el('p', { class: 'dependency-network-help', id: uid + '-help' }, '滚轮缩放 · 拖动空白平移 · 点击节点或连线查看详情 · 方向键平移，0 适应全部')
  const notice = el('p', { class: 'dependency-cycle-notice', hidden: true }, '存在循环依赖：橙色回绕连线保留真实关系，节点不会重复。')
  panel.append(heading, direction, tools, viewport, help, notice); columns.append(panel, detail); host.append(controls, legend, columns)
  let graph, layout, plugins = [], selected = null, selectedEdge = null, signature = '', destroyed = false
  const nodeElements = new Map(), edgeElements = new Map()
  const camera = { x: 0, y: 0, scale: 1 }
  let autoFit = true, drag = null, suppressClick = false
  function paintCamera() {
    scene.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`
    zoomValue.textContent = `${Math.round(camera.scale * 100)}%`
  }
  function fitAll() {
    autoFit = true
    if (!layout || !viewport.clientWidth || !viewport.clientHeight) return
    camera.scale = clamp(Math.min((viewport.clientWidth - 24) / layout.width, (viewport.clientHeight - 24) / layout.height), .08, 1)
    camera.x = (viewport.clientWidth - layout.width * camera.scale) / 2
    camera.y = (viewport.clientHeight - layout.height * camera.scale) / 2
    paintCamera()
  }
  function zoom(factor, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2) {
    const next = clamp(camera.scale * factor, .08, 2)
    camera.x = x - (x - camera.x) * next / camera.scale
    camera.y = y - (y - camera.y) * next / camera.scale
    camera.scale = next; autoFit = false; paintCamera()
  }
  function center(id) {
    const node = layout?.nodes.get(id)
    if (!node) return
    camera.scale = Math.max(camera.scale, .85)
    camera.x = viewport.clientWidth / 2 - (node.x + node.width / 2) * camera.scale
    camera.y = viewport.clientHeight / 2 - (node.y + node.height / 2) * camera.scale
    autoFit = false; paintCamera()
  }
  function highlight() {
    const related = new Set(selected ? [selected, ...graph.dependencies.get(selected), ...graph.dependents.get(selected)] : [])
    for (const [id, button] of nodeElements) {
      button.setAttribute('aria-pressed', String(id === selected))
      button.classList.toggle('dimmed', !!selected && !related.has(id))
      button.classList.toggle('related', !!selected && id !== selected && related.has(id))
    }
    for (const edge of graph.edges) {
      const node = edgeElements.get(edge.id)
      const direct = edge.source === selected || edge.target === selected
      node.classList.toggle('active', direct)
      node.classList.toggle('dimmed', !!selected && !direct)
      node.classList.toggle('chosen', selectedEdge === edge.id)
    }
    locate.disabled = !selected; reset.disabled = !selected
  }
  function select(id, edge = null) {
    if (id && !graph.byId.has(id)) return
    selected = id; selectedEdge = edge; highlight(); renderDetail()
  }
  function reveal(id) {
    select(id); center(id)
    nodeElements.get(id)?.focus({ preventScroll: true })
  }
  function relations(title, ids, fallback) {
    const section = el('section', { class: 'dependency-relations' }); section.append(el('h3', {}, title))
    const list = el('div', { class: 'dependency-chips' })
    for (const id of ids) {
      const plugin = graph.byId.get(id)
      const button = el('button', { type: 'button', disabled: !plugin, class: plugin ? '' : 'missing' }, plugin?.name || `${id}（缺失）`)
      button.onclick = () => reveal(id); list.append(button)
    }
    if (!ids.length) list.append(el('span', {}, fallback))
    section.append(list); return section
  }
  function renderDetail() {
    detail.replaceChildren()
    const plugin = graph.byId.get(selected)
    if (!plugin) {
      const intro = el('div', { class: 'dependency-welcome' })
      intro.append(el('span', { class: 'dependency-welcome-symbol', 'aria-hidden': true }, '↔'), el('h3', {}, '看清插件之间的协作'),
        el('p', {}, '每个插件只出现一次。点击节点，高亮左侧服务提供者与右侧使用者；点击连线查看具体服务。'),
        el('p', {}, '服务依赖决定这里的连线。代码包依赖与互斥组候选仍显示在插件详情中。'))
      detail.append(intro); return
    }
    const edge = graph.edges.find(e => e.id === selectedEdge)
    if (edge) {
      const info = el('section', { class: 'dependency-edge-detail' })
      info.append(el('h3', {}, '服务连接'), el('p', {}, `${graph.byId.get(edge.source).name} → ${graph.byId.get(edge.target).name}`))
      for (const service of edge.services) info.append(el('p', {}, `${service.scope === 'server' ? '后端' : '前端'} · ${service.name} · ${service.bound ? '已绑定' : '候选，未绑定'}`))
      detail.append(info)
    }
    detail.append(card(plugin, uid + '-selected-card'))
    if (plugin.exclusiveGroup) detail.append(relations('同组候选（只能启用一个，不是依赖关系）', plugins.filter(p => p.exclusiveGroup === plugin.exclusiveGroup && p.id !== plugin.id).map(p => p.id), '没有其他候选'))
    detail.append(relations('左侧 · 它依赖的插件', graph.dependencies.get(selected), '无插件关联；宿主服务和待绑定服务请查看上方声明'))
    detail.append(relations('右侧 · 直接依赖它的插件', graph.dependents.get(selected), '没有其他插件直接依赖它'))
    const unresolved = graph.relations.get(selected).filter(r => !r.host && (!r.provider || !graph.byId.has(r.provider)))
    if (unresolved.length) detail.append(el('p', { class: 'dependency-impact' }, '待确定的服务：' + unresolved.map(r => `${r.name}${r.candidates.length > 1 ? '（多个候选）' : '（缺少提供者）'}`).join('、')))
    const indirect = [...graph.downstream(selected)].filter(id => !graph.dependents.get(selected).includes(id))
    if (indirect.length) detail.append(relations('间接依赖它的插件', indirect, ''))
    const running = [...graph.downstream(selected)].filter(id => graph.byId.get(id)?.state === 'enabled')
    detail.append(el('p', { class: 'dependency-impact' }, running.length
      ? `依赖链上有 ${running.length} 个插件正在运行。启停仍执行原有依赖检查，不会自动批量停用。`
      : '当前没有运行中的依赖方。启停操作仍会检查依赖并保护未保存的笔记。'))
  }
  function searchResults() {
    results.replaceChildren()
    const query = search.value.trim().toLocaleLowerCase()
    results.hidden = !query
    if (!query) return
    const matches = plugins.filter(p => `${p.name} ${p.id}`.toLocaleLowerCase().includes(query))
    for (const plugin of matches) {
      const button = el('button', { type: 'button' }, `${plugin.name} · ${plugin.id}`)
      button.onclick = () => { reveal(plugin.id); results.hidden = true }
      results.append(button)
    }
    if (!matches.length) results.append(el('p', { role: 'status' }, '没有匹配的插件'))
  }
  search.oninput = searchResults
  search.onfocus = searchResults
  search.onkeydown = event => {
    if (event.key === 'Enter') { event.preventDefault(); results.querySelector('button')?.click() }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); results.hidden = true }
  }
  searchBox.onfocusout = event => { if (!searchBox.contains(event.relatedTarget)) results.hidden = true }
  reset.onclick = () => select(null)
  fit.onclick = fitAll; locate.onclick = () => center(selected)
  zoomIn.onclick = () => zoom(1.25); zoomOut.onclick = () => zoom(.8)
  viewport.addEventListener('wheel', event => {
    event.preventDefault()
    const rect = viewport.getBoundingClientRect(), delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1)
    zoom(Math.exp(-clamp(delta, -180, 180) * .003), event.clientX - rect.left, event.clientY - rect.top)
  }, { passive: false })
  viewport.onpointerdown = event => {
    if (event.button !== 0 && event.button !== 1) return
    if (event.button === 0 && event.target.closest('[data-plugin-id], [data-edge-id]')) return
    event.preventDefault(); viewport.focus({ preventScroll: true }); results.hidden = true
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, cx: camera.x, cy: camera.y, moved: false }
    suppressClick = false; viewport.setPointerCapture?.(event.pointerId)
  }
  viewport.onpointermove = event => {
    if (!drag || drag.id !== event.pointerId) return
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y
    if (!drag.moved && Math.hypot(dx, dy) < 4) return
    drag.moved = true; autoFit = false; viewport.classList.add('panning')
    camera.x = drag.cx + dx; camera.y = drag.cy + dy; paintCamera()
  }
  const endDrag = event => {
    if (!drag || drag.id !== event.pointerId) return
    suppressClick = drag.moved || event.type !== 'pointerup'; drag = null
    viewport.classList.remove('panning')
    if (viewport.hasPointerCapture?.(event.pointerId)) viewport.releasePointerCapture(event.pointerId)
  }
  viewport.onpointerup = endDrag; viewport.onpointercancel = endDrag; viewport.onlostpointercapture = endDrag
  viewport.onclick = event => {
    if (suppressClick) { suppressClick = false; return }
    if (!event.target.closest('[data-plugin-id], [data-edge-id]')) select(null)
  }
  viewport.onkeydown = event => {
    if (event.target !== viewport) return
    if (event.key === '0') { event.preventDefault(); fitAll() }
    else if (['+', '=', '-'].includes(event.key)) { event.preventDefault(); zoom(event.key === '-' ? .8 : 1.25) }
    else if (event.key.startsWith('Arrow')) {
      event.preventDefault(); autoFit = false
      camera.x += event.key === 'ArrowLeft' ? 60 : event.key === 'ArrowRight' ? -60 : 0
      camera.y += event.key === 'ArrowUp' ? 60 : event.key === 'ArrowDown' ? -60 : 0
      paintCamera()
    }
  }
  const observer = new ResizeObserver(() => { if (!destroyed && autoFit) fitAll() })
  observer.observe(viewport)
  function render(items) {
    if (destroyed) return
    plugins = items; graph = dependencyGraph(items)
    const next = JSON.stringify([[...graph.byId.keys()].sort(), graph.edges.map(e => e.id).sort()])
    const changed = next !== signature
    if (changed) {
      if (![...graph.byId.keys()].some(id => nodeElements.has(id))) autoFit = true
      signature = next; layout = dependencyLayout(graph)
      scene.style.width = layout.width + 'px'; scene.style.height = layout.height + 'px'
      svg.setAttribute('width', layout.width); svg.setAttribute('height', layout.height)
    }
    if (!graph.byId.has(selected)) selected = null
    if (!graph.edges.some(e => e.id === selectedEdge)) selectedEdge = null
    for (const [id, button] of nodeElements) if (!graph.byId.has(id)) { button.remove(); nodeElements.delete(id) }
    for (const plugin of graph.byId.values()) {
      let button = nodeElements.get(plugin.id)
      if (!button) {
        button = el('button', { type: 'button', class: 'dependency-node' })
        button.dataset.pluginId = plugin.id
        button.append(el('i', { class: 'dependency-port input', 'aria-hidden': true }), el('i', { class: 'dependency-dot' }),
          el('strong', { class: 'dependency-name' }), el('small', { class: 'dependency-id' }), el('span', { class: 'dependency-node-hint' }),
          el('i', { class: 'dependency-port output', 'aria-hidden': true }))
        button.onclick = () => select(plugin.id)
        button.onfocus = () => {
          const r = button.getBoundingClientRect(), v = viewport.getBoundingClientRect()
          if (r.right < v.left || r.left > v.right || r.bottom < v.top || r.top > v.bottom) center(plugin.id)
        }
        nodes.append(button); nodeElements.set(plugin.id, button)
      }
      const state = failures.has(plugin.id) ? 'failed' : plugin.state
      const pending = graph.relations.get(plugin.id).some(r => !r.host && (!r.provider || !graph.byId.has(r.provider)))
      const hint = graph.cycles.has(plugin.id) ? '循环依赖' : pending ? '服务待确定' : labels[state] || state
      button.setAttribute('aria-label', `${plugin.name}，${hint}`)
      button.title = `${plugin.name} (${plugin.id}) · ${hint}`
      button.querySelector('.dependency-dot').className = 'dependency-dot ' + state
      button.querySelector('.dependency-name').textContent = plugin.name
      button.querySelector('.dependency-id').textContent = plugin.id
      button.querySelector('.dependency-node-hint').textContent = hint
      button.classList.toggle('cycle', graph.cycles.has(plugin.id))
      const point = layout.nodes.get(plugin.id)
      Object.assign(button.style, { left: point.x + 'px', top: point.y + 'px', width: point.width + 'px', height: point.height + 'px' })
    }
    const ids = new Set(graph.edges.map(e => e.id))
    for (const [id, node] of edgeElements) if (!ids.has(id)) { node.remove(); edgeElements.delete(id) }
    for (const edge of graph.edges) {
      let node = edgeElements.get(edge.id)
      if (!node) {
        node = svgElement('g', { class: 'dependency-edge', tabindex: 0, role: 'button', 'data-edge-id': edge.id })
        node.dataset.source = edge.source; node.dataset.target = edge.target
        node.append(svgElement('title'), svgElement('path', { class: 'dependency-edge-hit' }), svgElement('path', { class: 'dependency-edge-line', 'marker-end': `url(#${uid}-arrow)` }))
        node.onclick = event => { event.stopPropagation(); select(edge.target, edge.id) }
        node.onkeydown = event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); select(edge.target, edge.id) } }
        svg.append(node); edgeElements.set(edge.id, node)
      }
      const title = `${graph.byId.get(edge.source).name} → ${graph.byId.get(edge.target).name}\n` + edge.services.map(r => `${r.scope === 'server' ? '后端' : '前端'} ${r.name}（${r.bound ? '已绑定' : '候选，未绑定'}）`).join('\n')
      node.setAttribute('aria-label', title); node.querySelector('title').textContent = title
      const path = dependencyPath(layout.nodes.get(edge.source), layout.nodes.get(edge.target))
      for (const line of node.querySelectorAll('path')) line.setAttribute('d', path)
      node.classList.toggle('candidate', edge.services.every(r => !r.bound))
      node.classList.toggle('cycle', graph.componentOf.get(edge.source) === graph.componentOf.get(edge.target))
    }
    count.textContent = `${graph.byId.size} 个插件 · ${graph.edges.length} 条连接`
    empty.hidden = !!graph.byId.size; notice.hidden = !graph.cycles.size
    if (changed && autoFit) fitAll()
    highlight(); renderDetail()
    if (!results.hidden) searchResults()
  }
  return { host, render, destroy() { if (destroyed) return; destroyed = true; observer.disconnect(); drag = null } }
}
