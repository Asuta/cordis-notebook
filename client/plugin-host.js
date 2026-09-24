import { Service } from 'cordis'
import { runtimeState, actualFiber, bindingsFor } from './lifecycle.js'

export class ClientPlugins {
  constructor(root, { sdkFor, load, onChange = () => {} }) {
    this.root = root; this.sdkFor = sdkFor; this.load = load; this.onChange = onChange
    this.entries = new Map(); this.gates = new Map(); this.plugins = []; this.attempt = 0
    root.on('internal/status', fiber => {
      const entry = [...this.entries.values()].find(item => actualFiber(item.fiber) === fiber)
      if (!entry) return
      if (runtimeState(fiber) === 'enabled') entry.error = ''
      this.onChange()
      if (runtimeState(fiber) === 'failed') fiber.await().catch(error => {
        if (actualFiber(entry.fiber) === fiber && runtimeState(fiber) === 'failed') { entry.error = error.message; this.onChange() }
      })
    })
  }
  state(id) {
    const entry = this.entries.get(id)
    return entry?.deferred ? 'waiting' : entry?.fiber ? runtimeState(entry.fiber) : entry?.error ? 'failed' : entry?.loading ? 'starting' : 'disabled'
  }
  describe(plugin) {
    const entry = this.entries.get(plugin.id), clientState = !plugin.client ? 'not-applicable' : !plugin.enabled ? 'disabled' : entry ? this.state(plugin.id) : 'starting'
    const serverState = plugin.serverState ?? plugin.state
    const states = [serverState, clientState]
    const state = !plugin.enabled && plugin.state !== 'failed' ? 'disabled' : plugin.state === 'failed' || states.includes('failed') ? 'failed'
      : states.includes('stopping') ? 'stopping' : states.includes('starting') ? 'starting' : states.includes('waiting') ? 'waiting'
      : states.includes('disabled') ? 'disabled' : plugin.enabled ? 'enabled' : 'disabled'
    const waitingFor = [...(plugin.waitingFor || []).map(name => '后端 ' + name)]
    if (clientState === 'waiting') {
      if (entry.deferred) waitingFor.push('后端就绪')
      for (const name of entry.requires) if (!this.root[name]) waitingFor.push('前端 ' + name)
      if (entry.gate && !this.root[entry.gate]) waitingFor.push('后端就绪')
    }
    return { ...plugin, state, serverState, clientState, waitingFor, error: entry?.error || plugin.error,
      bindings: { ...plugin.bindings, client: bindingsFor(entry?.fiber, this.entries) } }
  }
  async sync(plugins) {
    this.plugins = plugins
    const wanted = new Map(plugins.filter(p => p.enabled && p.client).map(p => [p.id, p]))
    // Backend readiness is a transport boundary, represented as an injected gate.
    for (const [id, item] of this.gates) {
      const legacy = id.startsWith('legacy:')
      const p = legacy ? plugins.find(p => p.id === id.slice(7) && !p.client && p.enabled) : wanted.get(id)
      if (!p || (legacy ? p.state : p.serverState) !== 'enabled' || p.generation !== item.generation) { this.gates.delete(id); await item.fiber.dispose() }
    }
    for (const [id, entry] of [...this.entries].reverse()) {
      if (!wanted.has(id) || wanted.get(id).generation !== entry.generation || entry.deferred && wanted.get(id).state === 'enabled') {
        this.entries.delete(id); if (entry.fiber) await entry.fiber.dispose()
      }
    }
    for (const p of wanted.values()) if (p.serverState === 'enabled' && !this.gates.has(p.id)) {
      const fiber = this.root.plugin(ctx => { new Service(ctx, 'backend:' + p.id) })
      this.gates.set(p.id, { fiber, generation: p.generation }); await fiber
    }
    // Register all consumers even when their providers are absent. Cordis orders activation.
    await Promise.all([...wanted.values()].map(async plugin => {
      if (this.entries.has(plugin.id)) return
      const entry = { generation: plugin.generation, requires: [], error: '', fiber: null, loading: true }
      this.entries.set(plugin.id, entry)
      if (!plugin.builtin && plugin.state !== 'enabled') { entry.deferred = true; return }
      try {
        const module = await deadline(this.load({ ...plugin, attempt: ++this.attempt }))
        if (typeof module.default !== 'function') throw new Error('前端入口需要导出 default 函数')
        const declared = plugin.builtin ? plugin.requires.client : module.inject || []
        entry.requires = Array.isArray(declared) ? declared : Object.keys(declared)
        entry.gate = plugin.serverState === 'not-applicable' ? null : 'backend:' + plugin.id
        const inject = { ...(Array.isArray(declared) ? Object.fromEntries(declared.map(name => [name, null])) : declared) }
        if (entry.gate) inject[entry.gate] = null
        // Preserve API v1 dependency gating without adding it to builtin service contracts.
        if (!plugin.builtin) for (const id of plugin.dependencies) inject['plugin:' + id] = null
        entry.fiber = this.root.plugin({ name: plugin.name, inject, apply: async ctx => {
          const cleanup = await deadline(Promise.resolve(module.default(ctx, this.sdkFor(ctx, plugin))))
          if (typeof cleanup === 'function') ctx.effect(() => cleanup)
          new Service(ctx, 'plugin:' + plugin.id)
        } })
        entry.loading = false
        await deadline(entry.fiber)
      } catch (error) { entry.loading = false; entry.error = error.message }
    }))
    // Pure backend dependencies of API v1 packages also expose a compatibility gate.
    for (const p of plugins.filter(p => !p.client && p.enabled && p.state === 'enabled')) {
      // The transport gates above are only for frontend entries; these markers have
      // the same owned lifetime as their backend status snapshot.
      const key = 'legacy:' + p.id
      if (!this.gates.has(key)) {
        const fiber = this.root.plugin(ctx => { new Service(ctx, 'plugin:' + p.id) })
        this.gates.set(key, { fiber, generation: p.generation }); await fiber
      }
    }
    await Promise.all([...this.entries.values()].map(entry => entry.fiber?.await().catch(error => { entry.error = error.message })))
    this.onChange()
  }
  async retry(id) {
    const entry = this.entries.get(id); this.entries.delete(id)
    if (entry?.fiber) await entry.fiber.dispose()
    await this.sync(this.plugins)
  }
}
async function deadline(promise) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('前端插件加载超过 10 秒')), 10000) })]) }
  finally { clearTimeout(timer) }
}
