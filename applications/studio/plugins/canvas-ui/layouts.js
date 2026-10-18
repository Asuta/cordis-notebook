import { gridPlan, layoutGraph } from './geometry.js'

export const canvasLayouts = [
  { id: 'layered-grid', label: '分层网格', description: '现有方案 · 从左到右分层，每层排成网格' },
  { id: 'workflow', label: '流程分组', description: '参数卡与它的产物放在一起，流程从左向右展开' },
  { id: 'layered', label: '连线分层', description: '同层竖向排列，调整顺序以减少连线交叉' },
  { id: 'grid', label: '整齐网格', description: '全部卡片排成近方形网格，方便总览' },
  { id: 'masonry', label: '紧凑瀑布流', description: '按卡片高度填入最短列，减少空白' },
]

function relations(nodes, edges) {
  const ids = new Set(nodes.map(node => node.id)), parents = new Map(nodes.map(node => [node.id, new Set()]))
  for (const edge of edges || []) if (ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to) parents.get(edge.to).add(edge.from)
  for (const node of nodes) if (ids.has(node.sourceNodeId) && node.sourceNodeId !== node.id) parents.get(node.id).add(node.sourceNodeId)
  return parents
}

function layeredPlan(nodes, edges, size) {
  const parents = relations(nodes, edges), children = new Map(nodes.map(node => [node.id, []]))
  const degree = new Map([...parents].map(([id, values]) => [id, values.size])), rank = new Map()
  for (const [id, values] of parents) for (const parent of values) children.get(parent).push(id)
  const queue = nodes.filter(node => !degree.get(node.id)).map(node => node.id)
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]
    rank.set(id, Math.max(-1, ...[...parents.get(id)].map(parent => rank.get(parent) ?? -1)) + 1)
    for (const child of children.get(id)) {
      degree.set(child, degree.get(child) - 1)
      if (!degree.get(child)) queue.push(child)
    }
  }
  // Legacy cycles remain visible in the first layer.
  for (const node of nodes) if (!rank.has(node.id)) rank.set(node.id, 0)
  const columns = []
  for (const node of nodes) (columns[rank.get(node.id)] ||= []).push(node)
  const positions = new Map()
  const refresh = () => columns.forEach(column => column.forEach((node, i) => positions.set(node.id, (i + .5) / column.length)))
  refresh()
  for (let sweep = 0; sweep < 4; sweep++) {
    const forward = sweep % 2 === 0
    for (const column of forward ? columns : [...columns].reverse()) {
      const order = new Map(column.map((node, i) => [node.id, i])), scores = new Map()
      for (const node of column) {
        const neighbors = [...(forward ? parents.get(node.id) : children.get(node.id))].filter(id => rank.get(id) !== rank.get(node.id))
        scores.set(node.id, neighbors.length ? neighbors.reduce((sum, id) => sum + positions.get(id), 0) / neighbors.length : positions.get(node.id))
      }
      column.sort((a, b) => scores.get(a.id) - scores.get(b.id) || order.get(a.id) - order.get(b.id))
      refresh()
    }
  }
  const plans = columns.map(column => {
    const height = column.reduce((sum, node) => sum + size(node).height, 0) + (column.length - 1) * 48
    // Fold unusually large layers so hundreds of results remain within canvas bounds.
    if (height > 12000) return gridPlan(column, size)
    const width = Math.max(...column.map(node => size(node).width)), positions = []
    let y = 0
    for (const node of column) { positions.push({ node, x: (width - size(node).width) / 2, y }); y += size(node).height + 48 }
    return { width, height, positions }
  })
  const height = Math.max(...plans.map(plan => plan.height)), placements = []
  let x = 0
  plans.forEach(plan => {
    for (const item of plan.positions) placements.push({ ...item, x: x + item.x, y: item.y + (height - plan.height) / 2 })
    x += plan.width + 140
  })
  return placements
}

function workflowPlan(nodes, edges, size) {
  const groups = new Map(nodes.filter(node => node.type === 'generator').map(node => [node.id, { root: node, products: [] }]))
  const owner = new Map()
  for (const node of nodes) {
    const group = node.type !== 'generator' && groups.get(node.sourceNodeId)
    if (group) { group.products.push(node); owner.set(node.id, group.root.id) }
    else { if (!groups.has(node.id)) groups.set(node.id, { root: node, products: [] }); owner.set(node.id, node.id) }
  }
  const blocks = [...groups.values()].map(group => {
    const dimensions = size(group.root), products = gridPlan(group.products, size)
    const height = Math.max(dimensions.height, products?.height || 0)
    const positions = [{ node: group.root, x: 0, y: (height - dimensions.height) / 2 }]
    if (products) for (const item of products.positions) positions.push({ ...item, x: dimensions.width + 88 + item.x, y: item.y + (height - products.height) / 2 })
    return { id: group.root.id, x: 0, y: 0, width: dimensions.width + (products ? 88 + products.width : 0), height, positions }
  })
  const blockEdges = []
  for (const [to, parents] of relations(nodes, edges)) for (const from of parents) {
    if (owner.get(from) !== owner.get(to)) blockEdges.push({ from: owner.get(from), to: owner.get(to) })
  }
  const blockPositions = new Map(layoutGraph(blocks, blockEdges, block => block, { gapX: 180, gapY: 100, gridGapX: 100, resultLinks: false }).map(item => [item.id, item.patch]))
  return blocks.flatMap(block => {
    const offset = blockPositions.get(block.id) || block
    return block.positions.map(item => ({ ...item, x: item.x + offset.x, y: item.y + offset.y }))
  })
}

function masonryPlan(nodes, size) {
  const items = nodes.map((node, index) => ({ node, index, ...size(node) })).sort((a, b) => b.height - a.height || a.index - b.index)
  const columnWidth = Math.max(...items.map(item => item.width))
  let best
  for (let columns = 1; columns <= items.length; columns++) {
    const heights = Array(columns).fill(0), positions = []
    for (const item of items) {
      const column = heights.indexOf(Math.min(...heights))
      positions.push({ node: item.node, x: column * (columnWidth + 40) + (columnWidth - item.width) / 2, y: heights[column] })
      heights[column] += item.height + 40
    }
    const width = columns * (columnWidth + 40) - 40, height = Math.max(...heights) - 40
    const score = Math.abs(Math.log(width / height))
    if (!best || score < best.score) best = { score, positions }
  }
  return best.positions
}

export function arrangeCanvas(nodes, edges, size, algorithm = 'layered-grid') {
  if (!canvasLayouts.some(layout => layout.id === algorithm)) throw Error('未知的画布整理方式')
  if (nodes.length < 2) return []
  const dimensions = new Map(nodes.map(node => [node.id, size(node)])), measured = node => dimensions.get(node.id)
  if (algorithm === 'layered-grid') return layoutGraph(nodes, edges, measured)
  const startX = Math.min(...nodes.map(node => node.x)), startY = Math.min(...nodes.map(node => node.y))
  const placements = algorithm === 'workflow' ? workflowPlan(nodes, edges, measured)
    : algorithm === 'layered' ? layeredPlan(nodes, edges, measured)
      : algorithm === 'masonry' ? masonryPlan(nodes, measured) : gridPlan(nodes, measured).positions
  return placements.flatMap(({ node, x, y }) => {
    const patch = { x: Math.round(startX + x), y: Math.round(startY + y) }
    if (Math.abs(patch.x) > 100000 || Math.abs(patch.y) > 100000) throw Error('整理后超出画布边界，请先将卡片移近中心。')
    return node.x === patch.x && node.y === patch.y ? [] : [{ id: node.id, patch }]
  })
}
