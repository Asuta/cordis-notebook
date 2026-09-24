// Package requirements are explicit IDs. Service requirements are scoped names.
// This projection is for inspection/protection only, never for startup ordering.
export function serviceRelations(plugin, plugins) {
  const result = []
  for (const scope of ['server', 'client']) for (const name of plugin.requires?.[scope] || []) {
    const bound = plugin.bindings?.[scope]?.[name]
    const candidates = plugins.filter(p => p.id !== plugin.id && p.provides?.[scope]?.includes(name))
    const active = candidates.filter(p => p.enabled && p.state === 'enabled')
    const provider = bound && bound !== '@host' ? bound : bound === '@host' ? null
      : active.length === 1 ? active[0].id : candidates.length === 1 ? candidates[0].id : null
    result.push({ scope, name, provider, bound: !!bound, candidates: candidates.map(p => p.id), host: bound === '@host' || scope === 'server' && name === 'http' })
  }
  return result
}
export function dependencyIds(plugin, plugins) {
  return [...new Set([...(plugin.dependencies || []), ...serviceRelations(plugin, plugins).map(r => r.provider).filter(Boolean)])]
}
