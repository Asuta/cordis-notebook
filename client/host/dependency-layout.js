export const nodeWidth = 184, nodeHeight = 66
const columnGap = 104, rowGap = 30, padding = 60

// Rank the acyclic component graph so every non-cycle dependency goes left to
// right. Repeated barycenter sweeps reduce crossings; ID ties keep layouts stable.
export function dependencyLayout(graph) {
  const ranks = graph.components.map(() => 0), incoming = ranks.map(() => new Set()), outgoing = ranks.map(() => new Set())
  for (const edge of graph.edges) {
    const a = graph.componentOf.get(edge.source), b = graph.componentOf.get(edge.target)
    if (a !== b) { outgoing[a].add(b); incoming[b].add(a) }
  }
  const counts = incoming.map(s => s.size), queue = counts.flatMap((n, i) => n ? [] : [i])
  for (let i = 0; i < queue.length; i++) for (const next of outgoing[queue[i]]) {
    ranks[next] = Math.max(ranks[next], ranks[queue[i]] + 1)
    if (!--counts[next]) queue.push(next)
  }
  const columns = []
  for (const id of [...graph.byId.keys()].sort()) {
    const rank = ranks[graph.componentOf.get(id)]
    ;(columns[rank] ||= []).push(id)
  }
  const order = new Map()
  const remember = () => columns.forEach(column => column.forEach((id, i) => order.set(id, (i + .5) / column.length)))
  remember()
  for (let sweep = 0; sweep < 6; sweep++) {
    const forward = sweep % 2 === 0
    const layers = forward ? columns.slice(1) : columns.slice(0, -1).reverse()
    for (const column of layers) {
      const score = id => {
        const neighbors = (forward ? graph.dependencies : graph.dependents).get(id)
          .filter(other => graph.byId.has(other) && graph.componentOf.get(other) !== graph.componentOf.get(id))
        return neighbors.length ? neighbors.reduce((sum, other) => sum + order.get(other), 0) / neighbors.length : order.get(id)
      }
      const scores = new Map(column.map(id => [id, score(id)]))
      column.sort((a, b) => scores.get(a) - scores.get(b) || a.localeCompare(b))
      remember()
    }
  }
  const height = Math.max(300, Math.max(0, ...columns.map(c => c.length)) * (nodeHeight + rowGap) - rowGap + padding * 2)
  const nodes = new Map()
  columns.forEach((column, rank) => {
    const offset = (height - (column.length * (nodeHeight + rowGap) - rowGap)) / 2
    column.forEach((id, row) => nodes.set(id, { id, rank, x: padding + rank * (nodeWidth + columnGap),
      y: offset + row * (nodeHeight + rowGap), width: nodeWidth, height: nodeHeight }))
  })
  return { nodes, width: Math.max(400, columns.length * (nodeWidth + columnGap) - columnGap + padding * 2), height }
}

export function dependencyPath(source, target) {
  const x1 = source.x + source.width, y1 = source.y + source.height / 2
  const x2 = target.x, y2 = target.y + target.height / 2
  if (source.rank < target.rank) {
    const bend = Math.max(44, (x2 - x1) / 2)
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
  }
  // Cycles keep their right-output / left-input ports and loop above the nodes.
  const top = Math.min(source.y, target.y) - 22
  return `M ${x1} ${y1} C ${x1 + 36} ${y1}, ${x1 + 36} ${top}, ${x1} ${top} L ${x2} ${top} C ${x2 - 36} ${top}, ${x2 - 36} ${y2}, ${x2} ${y2}`
}
