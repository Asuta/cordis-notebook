// Registrations belong to the contributing plugin, never to a global singleton.
export function createRegistry() {
  const entries = new Map(), observers = new Set()
  const notify = () => { for (const fn of observers) fn() }
  return {
    get: id => entries.get(id), list: () => [...entries.values()],
    require(id) { const value = entries.get(id); if (!value) throw Object.assign(Error(`能力 ${id} 不可用，请启用对应插件`), { status: 409 }); return value },
    register(owner, definition) {
      if (!definition || !/^[a-z][a-z0-9-]*$/.test(definition.id) || entries.has(definition.id)) throw Error('能力名称无效或重复：' + definition?.id)
      const value = Object.freeze({ ...definition })
      return owner.effect(() => { entries.set(value.id, value); notify(); return () => { if (entries.get(value.id) === value) { entries.delete(value.id); notify() } } })
    },
    observe(owner, fn) { return owner.effect(() => { observers.add(fn); fn(); return () => observers.delete(fn) }) },
  }
}

export function createNodeRegistry() {
  const registry = createRegistry(), register = registry.register
  const reserved = new Set(['id', 'type', 'title', 'x', 'y', 'sourceNodeId', 'jobId', '__proto__', 'constructor', 'prototype'])
  registry.register = (owner, definition) => {
    if (typeof definition?.label !== 'string' || !Array.isArray(definition.fields) || new Set(definition.fields).size !== definition.fields.length || definition.fields.some(f => typeof f !== 'string' || !/^[a-zA-Z][\w]*$/.test(f) || reserved.has(f)) || typeof definition.defaults !== 'function' || typeof definition.validate !== 'function') throw Error('卡片声明缺少合法的字段、默认值或校验方法')
    return register(owner, { ...definition, fields: Object.freeze([...definition.fields]), ...(definition.accepts ? { accepts: Object.freeze([...definition.accepts]) } : {}) })
  }
  return registry
}
