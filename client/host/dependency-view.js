import { dependencyGraph } from './dependency-graph.js'

export function createDependencyView({ el, card, labels, failures }) {
  const host = el('section', { id: 'dependency-view', 'aria-label': '插件依赖树', hidden: true })
  const controls = el('div', { class: 'dependency-controls' }), tools = el('div')
  controls.append(el('p', {}, '下级依赖上级提供的服务。服务绑定与代码包依赖分别显示在详情中；↗ 表示共享引用。'), tools)
  const expand = el('button', {}, '全部展开'), collapse = el('button', {}, '全部收起'); tools.append(expand, collapse)
  const legend = el('div', { class: 'dependency-legend' })
  for (const [state, label] of [['enabled', '运行中'], ['waiting', '等待服务'], ['disabled', '已停用'], ['failed', '失败']]) { const item = el('span'); item.append(el('i', { class: 'dependency-dot ' + state }), document.createTextNode(label)); legend.append(item) }
  const columns = el('div', { class: 'dependency-columns' }), tree = el('div', { class: 'dependency-tree' }), detail = el('aside', { class: 'dependency-detail', 'aria-label': '选中插件详情' })
  columns.append(tree, detail); host.append(controls, legend, columns)
  let selected = null, graph, plugins = [], collapsed = new Set()
  expand.onclick = () => { collapsed.clear(); render(plugins) }
  collapse.onclick = () => { collapsed = new Set(graph.byId.keys()); render(plugins) }
  function select(id) {
    selected = id
    for (const button of tree.querySelectorAll('[data-plugin-id]')) button.setAttribute('aria-pressed', String(button.dataset.pluginId === id))
    renderDetail()
  }
  function reveal(id) {
    selected = id; let ancestor = graph.parent.get(id)
    while (ancestor) { collapsed.delete(ancestor); ancestor = graph.parent.get(ancestor) }
    render(plugins)
    const button = [...tree.querySelectorAll('[data-plugin-id]')].find(node => node.dataset.pluginId === id && node.dataset.primary === 'true')
    button?.focus({ preventScroll: true }); button?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
  function relations(title, ids, empty) {
    const section = el('section', { class: 'dependency-relations' }); section.append(el('h3', {}, title))
    const list = el('div', { class: 'dependency-chips' })
    for (const id of ids) {
      const plugin = graph.byId.get(id)
      const button = el('button', { disabled: !plugin, class: plugin ? '' : 'missing' }, plugin?.name || `${id}（缺失）`)
      button.onclick = () => reveal(id); list.append(button)
    }
    if (!ids.length) list.append(el('span', {}, empty))
    section.append(list); return section
  }
  function renderDetail() {
    detail.replaceChildren(); const plugin = graph.byId.get(selected)
    if (!plugin) { detail.append(el('p', {}, '选择一个插件查看依赖关系。')); return }
    detail.append(card(plugin, 'dependency-selected-card'))
    if (plugin.exclusiveGroup) detail.append(relations('同组候选（只能启用一个，不是依赖关系）', plugins.filter(p => p.exclusiveGroup === plugin.exclusiveGroup && p.id !== plugin.id).map(p => p.id), '没有其他候选'))
    detail.append(relations('关联的服务提供者', graph.dependencies.get(selected), '无插件关联；宿主服务和缺失服务请查看上方声明'))
    detail.append(relations('直接依赖它的插件', graph.dependents.get(selected), '没有其他插件直接依赖它'))
    const indirect = [...graph.downstream(selected)].filter(id => !graph.dependents.get(selected).includes(id))
    if (indirect.length) detail.append(relations('间接依赖它的插件', indirect, ''))
    const running = [...graph.downstream(selected)].filter(id => graph.byId.get(id)?.state === 'enabled')
    const notice = el('p', { class: 'dependency-impact' }, running.length
      ? `依赖链上有 ${running.length} 个插件正在运行。停用前请先检查这些依赖方；系统会保留原有的依赖保护，不会自动批量停用。`
      : '当前没有运行中的依赖方。启停操作仍会检查依赖并保护未保存的笔记。')
    detail.append(notice)
  }
  function render(items) {
    plugins = items; graph = dependencyGraph(items)
    if (!graph.byId.has(selected)) selected = graph.roots[0] || items[0]?.id || null
    const focused = tree.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null
    tree.replaceChildren()
    const title = el('div', { class: 'dependency-tree-heading' }); title.append(el('strong', {}, '插件关系'), el('span', {}, `${items.length} 个插件 · ${[...graph.dependencies.values()].reduce((n, deps) => n + deps.length, 0)} 条关联`)); tree.append(title)
    const list = el('ul', { class: 'dependency-branches' })
    function branch(id, reference, path) {
      const plugin = graph.byId.get(id), li = el('li'), row = el('div', { class: 'dependency-row' })
      const button = el('button', { class: 'dependency-node', 'aria-label': `${plugin.name}${reference ? '，共享依赖引用' : ''}`, 'aria-pressed': String(id === selected) })
      button.dataset.pluginId = id; button.dataset.primary = String(!reference); button.dataset.focusKey = path
      const state = failures.has(id) ? 'failed' : plugin.state
      button.append(el('span', { class: 'dependency-dot ' + state, title: failures.has(id) ? '前端失败' : labels[state] }), el('span', { class: 'dependency-name' }, plugin.name))
      if (reference) button.append(el('span', { class: 'dependency-reference', title: '该插件有多个依赖，点击定位到主节点' }, '↗'))
      else if (graph.dependencies.get(id).length > 1) button.append(el('span', { class: 'dependency-count', title: '完整服务依赖显示在详情中' }, `${graph.dependencies.get(id).length} 关联`))
      if (graph.dependencies.get(id).some(dep => !graph.byId.has(dep))) button.append(el('span', { class: 'dependency-warning' }, '缺失依赖'))
      button.onclick = () => reference ? reveal(id) : select(id)
      const children = reference ? [] : graph.children.get(id)
      if (children.length) {
        const disclosure = el('details', { open: !collapsed.has(id) }), summary = el('summary', { 'aria-label': `展开或收起${plugin.name}的依赖方` })
        summary.dataset.focusKey = path + '-toggle'; summary.append(el('span', { class: 'branch-arrow', 'aria-hidden': 'true' }, '›'))
        disclosure.append(summary)
        const nested = el('ul')
        for (const child of children) nested.append(branch(child.id, child.reference, path + '/' + child.id))
        disclosure.append(nested)
        // Separate selection from native disclosure: both work with a keyboard.
        row.append(button); li.append(row, disclosure)
        disclosure.addEventListener('toggle', () => { if (!disclosure.isConnected) return; disclosure.open ? collapsed.delete(id) : collapsed.add(id) })
      } else { row.classList.add('dependency-leaf'); row.append(button); li.append(row) }
      return li
    }
    for (const id of graph.roots) list.append(branch(id, false, id))
    tree.append(list)
    if (!items.length) tree.append(el('p', { class: 'dependency-empty' }, '还没有发现插件。'))
    if (graph.cycles.size) tree.append(el('p', { class: 'dependency-impact' }, '发现循环依赖，相关节点已拆开显示；原始依赖保留在详情中。'))
    renderDetail()
    if (focused) [...tree.querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === focused)?.focus({ preventScroll: true })
  }
  return { host, render }
}
