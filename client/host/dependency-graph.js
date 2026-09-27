import { serviceRelations } from '../../shared/plugin-relations.js'

// Inspection only: arrows point from service providers to consumers. Package
// dependencies and exclusive-group alternatives are not runtime dependency edges.
export function dependencyGraph(plugins) {
  const byId = new Map(plugins.map(plugin => [plugin.id, plugin]))
  const dependencies = new Map(), dependents = new Map([...byId.keys()].map(id => [id, []]))
  const relations = new Map(), edges = []
  for (const plugin of byId.values()) {
    const services = serviceRelations(plugin, [...byId.values()])
    relations.set(plugin.id, services)
    const deps = [...new Set(services.map(r => r.provider).filter(Boolean))]
    dependencies.set(plugin.id, deps)
    for (const source of deps) {
      if (!byId.has(source)) continue
      dependents.get(source).push(plugin.id)
      edges.push({ id: JSON.stringify([source, plugin.id]), source, target: plugin.id,
        services: services.filter(r => r.provider === source) })
    }
  }
  // All edges participate in cycle detection, not just one chosen display parent.
  const indices = new Map(), low = new Map(), stack = [], onStack = new Set(), components = []
  let sequence = 0
  function visit(id) {
    indices.set(id, sequence); low.set(id, sequence++)
    stack.push(id); onStack.add(id)
    for (const next of dependents.get(id)) {
      if (!indices.has(next)) { visit(next); low.set(id, Math.min(low.get(id), low.get(next))) }
      else if (onStack.has(next)) low.set(id, Math.min(low.get(id), indices.get(next)))
    }
    if (low.get(id) !== indices.get(id)) return
    const group = []; let member
    do { member = stack.pop(); onStack.delete(member); group.push(member) } while (member !== id)
    components.push(group.sort())
  }
  for (const id of [...byId.keys()].sort()) if (!indices.has(id)) visit(id)
  const componentOf = new Map(), cycles = new Set()
  components.forEach((members, index) => {
    for (const id of members) {
      componentOf.set(id, index)
      if (members.length > 1 || dependencies.get(id).includes(id)) cycles.add(id)
    }
  })
  function reachable(id, adjacency) {
    const found = new Set(), pending = [...(adjacency.get(id) || [])]
    while (pending.length) {
      const next = pending.pop()
      if (next === id || found.has(next)) continue
      found.add(next); pending.push(...(adjacency.get(next) || []))
    }
    return found
  }
  return {
    byId, dependencies, dependents, relations, edges, components, componentOf, cycles,
    roots: [...byId.keys()].filter(id => !dependencies.get(id).some(source =>
      byId.has(source) && componentOf.get(source) !== componentOf.get(id))),
    upstream: id => reachable(id, dependencies),
    downstream: id => reachable(id, dependents),
  }
}
