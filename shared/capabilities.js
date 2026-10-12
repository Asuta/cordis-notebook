/** Provider-owned metadata; references are relative to the declaring plugin. */
export function capabilitiesOf(manifest) {
  const entries = manifest.capabilities ?? []
  if (!Array.isArray(entries) || entries.length > 100) throw Error('capabilities 必须是最多 100 项的数组')
  const seen = new Set()
  return entries.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw Error('能力声明必须是对象')
    const allowed = ['service', 'side', 'description', 'contracts', 'examples', 'tests', 'lifecycle']
    if (Object.keys(entry).some(key => !allowed.includes(key))) throw Error('能力声明包含未知字段')
    if (!['client', 'server'].includes(entry.side) || !manifest.provides?.[entry.side]?.includes(entry.service)) throw Error('能力必须引用本插件 provides 中的同侧服务')
    const key = entry.side + ':' + entry.service
    if (seen.has(key)) throw Error('能力重复声明：' + key)
    seen.add(key)
    if (typeof entry.description !== 'string' || !entry.description.trim() || entry.description.length > 2000) throw Error('能力需要简短描述')
    const result = { key, service: entry.service, side: entry.side, description: entry.description }
    for (const field of ['contracts', 'examples', 'tests', 'lifecycle']) {
      const values = entry[field] ?? []
      if (!Array.isArray(values) || values.length > 20 || values.some(value => typeof value !== 'string' || !value.trim() || value.length > 2000) || new Set(values).size !== values.length) throw Error('能力字段无效：' + field)
      if (field !== 'lifecycle' && values.some(value => !/^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*$/.test(value) || value.split('/').some(part => !part || part.startsWith('.') || ['node_modules', 'dist'].includes(part)))) throw Error('能力引用必须是插件内的源码或文档文件')
      result[field] = [...values]
    }
    if (!result.contracts.length) throw Error('能力必须声明公开契约文件')
    return result
  })
}

/** Uses runtime plugin observations when available; a backend cannot verify a page's activation. */
export function capabilityCatalog(plugins) {
  return plugins.flatMap(plugin => capabilitiesOf(plugin).map(capability => ({ ...capability, provider: plugin.id,
    requires: plugin.requires?.[capability.side] || [],
    runtime: { enabled: plugin.enabled ?? null,
      state: plugin.enabled === false ? 'disabled' : capability.side === 'server' ? plugin.serverState || plugin.state || 'unknown' : plugin.clientState || 'unknown',
      verified: capability.side === 'server' ? !!plugin.serverState || !!plugin.state : !!plugin.clientState,
      waitingFor: plugin.waitingFor || [] },
  })))
}
