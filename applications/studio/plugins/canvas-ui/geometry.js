export function cardBounds(nodes, size) {
  if (!nodes.length) return null
  const x = Math.min(...nodes.map(n => n.x)), y = Math.min(...nodes.map(n => n.y))
  return { x, y, width: Math.max(...nodes.map(n => n.x + size(n).width)) - x,
    height: Math.max(...nodes.map(n => n.y + size(n).height)) - y }
}

export function fitView(bounds, width, height, bottom = 80, top = 32) {
  if (!bounds || width <= 0 || height <= 0) return null
  const usableWidth = Math.max(1, width - 64), usableHeight = Math.max(1, height - bottom - top - 32)
  const zoom = Math.max(.15, Math.min(1.25, usableWidth / Math.max(1, bounds.width), usableHeight / Math.max(1, bounds.height)))
  return { x: Math.max(-100000, Math.min(100000, 32 + (usableWidth - bounds.width * zoom) / 2 - bounds.x * zoom)),
    y: Math.max(-100000, Math.min(100000, top + (usableHeight - bounds.height * zoom) / 2 - bounds.y * zoom)), zoom }
}

export function gridPlan(nodes, size, { gapX = 48, gapY = 48 } = {}) {
  if (!nodes.length) return null
  const items = nodes.map((node, index) => ({ node, index, ...size(node) }))
  let best = null
  for (let columns = 1; columns <= items.length; columns++) {
    const rows = Math.ceil(items.length / columns), columnWidths = Array(columns).fill(0), rowHeights = Array(rows).fill(0)
    for (const item of items) {
      const column = item.index % columns, row = Math.floor(item.index / columns)
      columnWidths[column] = Math.max(columnWidths[column], item.width)
      rowHeights[row] = Math.max(rowHeights[row], item.height)
    }
    const width = columnWidths.reduce((sum, value) => sum + value, 0) + Math.max(0, columns - 1) * gapX
    const height = rowHeights.reduce((sum, value) => sum + value, 0) + Math.max(0, rows - 1) * gapY
    const score = Math.abs(Math.log(Math.max(1, width) / Math.max(1, height)))
    if (!best || score < best.score - 1e-9 || Math.abs(score - best.score) <= 1e-9 && columns > best.columns) {
      best = { columns, rows, columnWidths, rowHeights, width, height, score }
    }
  }
  const columnOffsets = best.columnWidths.map((_, index) => best.columnWidths.slice(0, index).reduce((sum, value) => sum + value, 0) + index * gapX)
  const rowOffsets = best.rowHeights.map((_, index) => best.rowHeights.slice(0, index).reduce((sum, value) => sum + value, 0) + index * gapY)
  return {
    ...best,
    positions: items.map(item => {
      const column = item.index % best.columns, row = Math.floor(item.index / best.columns)
      return { node: item.node, x: columnOffsets[column] + (best.columnWidths[column] - item.width) / 2,
        y: rowOffsets[row] + (best.rowHeights[row] - item.height) / 2 }
    }),
  }
}

export function arrangeGrid(nodes, size, { gapX = 48, gapY = 48, startX, startY } = {}) {
  if (nodes.length < 2) return []
  const plan = gridPlan(nodes, size, { gapX, gapY })
  const originX = startX ?? Math.min(...nodes.map(node => node.x)), originY = startY ?? Math.min(...nodes.map(node => node.y)), operations = []
  for (const item of plan.positions) {
    const patch = { x: Math.round(originX + item.x), y: Math.round(originY + item.y) }
    if (Math.abs(patch.x) > 100000 || Math.abs(patch.y) > 100000) throw Error('排列超出画布边界，请先将卡片移近中心。')
    if (item.node.x !== patch.x || item.node.y !== patch.y) operations.push({ type: 'update', id: item.node.id, patch })
  }
  return operations
}

export function layoutGraph(nodes, edges, size, { gapX = 120, gapY = 48, gridGapX = 48, resultLinks = true } = {}) {
  if (nodes.length < 2) return []
  const ids = new Set(nodes.map(node => node.id)), parents = new Map(nodes.map(node => [node.id, new Set()]))
  for (const edge of edges || []) {
    if (ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to) parents.get(edge.to).add(edge.from)
  }
  if (resultLinks) for (const node of nodes) {
    if (node.sourceNodeId && ids.has(node.sourceNodeId) && node.sourceNodeId !== node.id) parents.get(node.id).add(node.sourceNodeId)
  }
  const children = new Map(nodes.map(node => [node.id, []])), indegree = new Map()
  for (const [id, values] of parents) {
    indegree.set(id, values.size)
    for (const parent of values) children.get(parent).push(id)
  }
  const original = new Map(nodes.map(node => [node.id, node]))
  const ready = nodes.filter(node => indegree.get(node.id) === 0).sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id)).map(node => node.id)
  const layers = new Map(), queue = [...ready]
  while (queue.length) {
    const id = queue.shift()
    const layer = Math.max(-1, ...[...parents.get(id)].map(parent => layers.get(parent) ?? -1)) + 1
    layers.set(id, layer)
    for (const child of children.get(id)) {
      indegree.set(child, indegree.get(child) - 1)
      if (indegree.get(child) === 0) queue.push(child)
    }
  }
  // Cycles can exist in old documents. Keep those cards visible rather than
  // omitting them from an otherwise valid layout.
  for (const node of nodes) if (!layers.has(node.id)) layers.set(node.id, 0)
  const columns = new Map()
  for (const node of nodes) {
    const layer = layers.get(node.id)
    if (!columns.has(layer)) columns.set(layer, [])
    columns.get(layer).push(node)
  }
  const ordered = [...columns.entries()].sort((a, b) => a[0] - b[0]).map(([layer, column]) => ({
    layer,
    nodes: column.sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id)),
  }))
  const startX = Math.min(...nodes.map(node => node.x)), startY = Math.min(...nodes.map(node => node.y))
  const layouts = ordered.map(column => ({ ...gridPlan(column.nodes, size, { gapX: gridGapX, gapY }), nodes: column.nodes }))
  const maxHeight = Math.max(...layouts.map(layout => layout.height)), operations = []
  let x = startX
  layouts.forEach(layout => {
    const offsetY = startY + (maxHeight - layout.height) / 2
    for (const item of layout.positions) {
      const patch = { x: Math.round(x + item.x), y: Math.round(offsetY + item.y) }
      if (Math.abs(patch.x) > 100000 || Math.abs(patch.y) > 100000) throw Error('整理后超出画布边界，请先将卡片移近中心。')
      const before = original.get(item.node.id)
      if (before.x !== patch.x || before.y !== patch.y) operations.push({ id: item.node.id, patch })
    }
    x += layout.width + gapX
  })
  return operations
}

export function moveDelta(nodes, dx, dy) {
  return { x: Math.max(-100000 - Math.min(...nodes.map(n => n.x)), Math.min(100000 - Math.max(...nodes.map(n => n.x)), dx)),
    y: Math.max(-100000 - Math.min(...nodes.map(n => n.y)), Math.min(100000 - Math.max(...nodes.map(n => n.y)), dy)) }
}

export function overlayPosition(anchor, width, height, stageWidth, stageHeight, bottom = 0) {
  const maxX = Math.max(8, stageWidth - width - 8), maxY = Math.max(8, stageHeight - bottom - height - 8)
  const above = anchor.y - height - 14, below = anchor.y + anchor.height + 14
  return { x: Math.max(8, Math.min(maxX, anchor.x + anchor.width / 2 - width / 2)),
    y: Math.max(8, Math.min(maxY, above >= 8 ? above : below <= maxY ? below : 8)) }
}
