// A spanning forest keeps the view compact. Additional dependency edges are
// rendered as reference leaves, so a shared plugin is never silently omitted.
import { dependencyIds } from './plugin-relations.js'
export function dependencyGraph(plugins) {
  const byId = new Map(plugins.map(plugin => [plugin.id, plugin]))
  const dependencies = new Map(), dependents = new Map(plugins.map(p => [p.id, []]))
  const parent = new Map(), cycles = new Set()
  for (const plugin of plugins) {
    const deps = dependencyIds(plugin, plugins)
    dependencies.set(plugin.id, deps)
    const known = deps.filter(id => byId.has(id))
    parent.set(plugin.id, known[0] || null)
    for (const id of known) dependents.get(id).push(plugin.id)
  }
  // Break only display-parent cycles. The original dependency edges stay intact.
  for (const plugin of plugins) {
    const path = [], positions = new Map(); let id = plugin.id
    while (id !== null) {
      if (positions.has(id)) {
        for (const member of path.slice(positions.get(id))) cycles.add(member)
        parent.set(id, null); break
      }
      positions.set(id, path.length); path.push(id); id = parent.get(id) ?? null
    }
  }
  const children = new Map(plugins.map(p => [p.id, []]))
  for (const plugin of plugins) for (const id of dependencies.get(plugin.id)) {
    if (children.has(id)) children.get(id).push({ id: plugin.id, reference: parent.get(plugin.id) !== id })
  }
  function reachable(id, edges) {
    const found = new Set(), visit = current => {
      for (const next of edges.get(current) || []) if (next !== id && !found.has(next)) { found.add(next); visit(next) }
    }
    visit(id); return found
  }
  return {
    byId, dependencies, dependents, parent, children, cycles,
    roots: plugins.filter(p => parent.get(p.id) === null).map(p => p.id),
    upstream: id => reachable(id, dependencies),
    downstream: id => reachable(id, dependents),
  }
}
