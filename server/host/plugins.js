import { Service } from 'cordis'
import { mkdir, readFile } from 'node:fs/promises'
import { writeSnapshot } from '../../shared/persistence.js'
import { join, resolve } from 'node:path'
import { fail } from './http.js'
import { randomUUID } from 'node:crypto'
import { runtimeState, actualFiber, bindingsFor } from '../../shared/lifecycle.js'
import { dependencyIds } from '../../shared/plugin-relations.js'
import { PluginSettings } from './plugin-settings.js'

export class Plugins extends Service {
  static inject = ['http']
  constructor(ctx, { dataDir, file, builtinPlugins = [] }) {
    super(ctx, 'plugins'); this.dataDir = resolve(dataDir); this.file = file; this.records = new Map(); this.queue = Promise.resolve(); this.revision = 0
    this.pendingSwitch = null
    this.savedFlags = {}
    this.settings = new PluginSettings(this)
    for (const item of builtinPlugins) this.records.set(item.manifest.id, { ...item, state: 'disabled', enabled: item.defaultEnabled !== false, error: '' })
    ctx.on('internal/status', fiber => {
      const record = [...this.records.values()].find(r => actualFiber(r.fiber) === fiber)
      if (record) this.refreshState(record)
    })
  }
  describe(record) {
    return { ...record.manifest, ...this.settings.describe(record), state: record.state, serverState: record.server ? record.state : 'not-applicable',
      enabled: record.enabled, error: record.error, generation: record.generation || 0,
      bindings: { server: bindingsFor(record.fiber, this.records) },
      waitingFor: record.state === 'waiting' ? (record.manifest.requires?.server || record.server?.inject || []).filter(name => !this.ctx.get(name)) : [],
    }
  }
  serialize() { return { revision: this.revision, pendingConfig: this.settings.pending ? { id: this.settings.pending.id, token: this.settings.pending.token, backend: this.settings.pending.backend } : null, pendingSwitch: this.pendingSwitch ? { token: this.pendingSwitch.token, group: this.pendingSwitch.group, target: this.pendingSwitch.target, previous: this.pendingSwitch.previous, phase: this.pendingSwitch.phase } : null, plugins: [...this.records.values()].map(r => this.describe(r)) } }
  refreshState(record) {
    if (!record.fiber) return
    const state = runtimeState(record.fiber)
    if (state === record.state) return
    record.state = state
    if (state === 'enabled') { record.generation = (record.generation || 0) + 1; record.error = '' }
    if (state === 'failed') {
      const fiber = record.fiber
      record.error = '插件运行失败'
      fiber.await().catch(error => { if (record.fiber === fiber && record.state === 'failed') { record.error = error.message; this.changed() } })
    }
    this.changed()
  }
  changed() { this.revision++; this.ctx.http.broadcast() }
  locked(fn) { const task = this.queue.then(fn); this.queue = task.catch(() => {}); return task }
  async persist(commitSwitch = false) {
    const path = join(this.dataDir, 'plugins-state.json')
    const pending = this.pendingSwitch
    const flags = { ...this.savedFlags, ...Object.fromEntries([...this.records].map(([id, record]) => [id,
      pending && !commitSwitch && record.manifest.exclusiveGroup === pending.group ? pending.previous.includes(id) : record.enabled])) }
    await writeSnapshot(path, JSON.stringify(flags, null, 2))
    this.savedFlags = flags
  }
  async init() {
    await mkdir(join(this.dataDir, 'plugin-data'), { recursive: true })
    let state = {}
    try { state = JSON.parse(await readFile(join(this.dataDir, 'plugins-state.json'), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
    this.savedFlags = state
    await this.settings.load()
    for (const [id, record] of this.records) if (typeof state[id] === 'boolean') record.enabled = state[id]
    // Repair conflicting saved choices deterministically; newly added themes default off.
    const groups = new Set([...this.records.values()].map(r => r.manifest.exclusiveGroup).filter(Boolean))
    for (const group of groups) {
      const candidates = [...this.records.values()].filter(r => r.manifest.exclusiveGroup === group && r.enabled)
      const explicit = candidates.filter(r => state[r.manifest.id] === true)
      const chosen = explicit.at(-1) || candidates[0]
      for (const candidate of candidates) candidate.enabled = candidate === chosen
    }
    for (const [id, record] of this.records) if (record.enabled) { try { await this.start(id) } catch {} }
    await this.persist()
  }
  async start(id) {
    const record = this.records.get(id)
    if (!record) throw fail(400, `缺少依赖：${id}`)
    if (record.state === 'enabled') return
    record.state = 'starting'; record.error = ''; this.changed()
    try {
      if (record.fiber) await record.fiber.dispose()
      const plugin = record.server || { inject: record.manifest.requires?.server || [], apply() {} }
      const dataDir = join(this.dataDir, 'plugin-data', id)
      await mkdir(dataDir, { recursive: true })
      const fiber = this.ctx.plugin(plugin, {
        settings: record.configOverride ?? this.settings.describe(record).config ?? {},
        runtime: { id, dataDir, appDataDir: this.dataDir, legacyFile: this.file, writeSnapshot },
        bind: binding => { record.configBinding = binding },
      }); record.fiber = fiber
      this.refreshState(record); await fiber; this.refreshState(record)
    } catch (error) {
      if (record.fiber) { await record.fiber.dispose().catch(() => {}); record.fiber = null }
      record.state = 'failed'; record.error = error.message; this.changed(); throw error
    }
  }
  dependents(id) {
    const plugins = [...this.records.values()].map(r => this.describe(r))
    const result = [], visit = parent => { for (const record of plugins) if (record.enabled && !['failed', 'disabled'].includes(record.state) && record.id !== id && dependencyIds(record, plugins).includes(parent) && !result.includes(record.id)) { result.push(record.id); visit(record.id) } }
    visit(id); return result
  }
  async stop(id) {
    const record = this.records.get(id); if (!record) throw fail(404, '插件不存在')
    record.state = 'stopping'; this.changed()
    if (record.fiber) { await record.fiber.dispose(); record.fiber = null }
    record.state = 'disabled'; this.changed()
  }
  toggle(id, enabled) {
    return this.locked(async () => {
      this.settings.assertIdle()
      const record = this.records.get(id); if (!record) throw fail(404, '插件不存在')
      if (typeof enabled !== 'boolean') throw fail(400, 'enabled 必须是布尔值')
      if (this.pendingSwitch) throw fail(409, '正在确认插件切换，请稍后再试')
      if (record.manifest.exclusiveGroup) return this.beginExclusive(record, enabled)
      if (!enabled) {
        const deps = this.dependents(id)
        if (deps.length) throw fail(409, `请先停用依赖此插件的功能：${deps.map(key => this.records.get(key).manifest.name).join('、')}`)
        await this.stop(id); record.enabled = false
      } else { record.enabled = true; try { await this.start(id) } catch (error) { await this.persist(); throw error } }
      await this.persist(); return this.serialize()
    })
  }
  async beginExclusive(record, enabled) {
    const id = record.manifest.id, group = record.manifest.exclusiveGroup
    if ((enabled && record.state === 'enabled') || (!enabled && record.state === 'disabled')) return this.serialize()
    const previous = [...this.records.values()].filter(r => r.manifest.exclusiveGroup === group && r.state === 'enabled').map(r => r.manifest.id)
    for (const oldId of previous) {
      const users = this.dependents(oldId)
      if (users.length) throw fail(409, `无法切换，仍有插件依赖 ${this.records.get(oldId).manifest.name}：${users.map(key => this.records.get(key).manifest.name).join('、')}`)
    }
    const transaction = { token: randomUUID(), group, previous, target: enabled ? id : null, requested: id, phase: 'switching', timer: null }
    this.pendingSwitch = transaction; this.changed()
    try {
      for (const oldId of previous) await this.stop(oldId)
      for (const member of this.records.values()) if (member.manifest.exclusiveGroup === group) member.enabled = false
      if (enabled) { record.enabled = true; await this.start(id) }
      else if (record.state !== 'disabled') await this.stop(id)
      transaction.phase = 'awaiting-client'
      // Old committed flags remain on disk until the initiating page confirms mount.
      transaction.timer = setTimeout(() => this.locked(() => this.rollbackExclusive(transaction.token, '页面未在 20 秒内确认，切换已取消')).catch(console.error), 20000)
      this.changed(); return this.serialize()
    } catch (error) { const message = await this.rollbackExclusive(transaction.token, error.message); throw fail(500, message) }
  }
  finishExclusive(token, success, error = '') {
    return this.locked(async () => {
      const pending = this.pendingSwitch
      if (!pending || pending.token !== token || pending.phase !== 'awaiting-client') throw fail(409, '此切换已结束，请刷新插件状态')
      if (typeof success !== 'boolean') throw fail(400, 'success 必须是布尔值')
      if (!success) {
        const message = await this.rollbackExclusive(token, String(error).slice(0, 500) || '前端加载失败')
        return { ...this.serialize(), message }
      }
      try { await this.persist(true) } catch (cause) { const message = await this.rollbackExclusive(token, `保存插件选择失败：${cause.message}`); throw fail(500, message) }
      clearTimeout(pending.timer); this.pendingSwitch = null; this.changed(); return this.serialize()
    })
  }
  async rollbackExclusive(token, reason) {
    const pending = this.pendingSwitch
    if (!pending || pending.token !== token) return '此切换已结束'
    clearTimeout(pending.timer); pending.phase = 'rolling-back'; this.changed()
    const problems = []
    for (const record of this.records.values()) if (record.manifest.exclusiveGroup === pending.group) {
      try { if (record.fiber) await this.stop(record.manifest.id) } catch (error) { problems.push(error.message) }
      record.enabled = false
    }
    for (const oldId of pending.previous) {
      const old = this.records.get(oldId); old.enabled = true
      try { await this.start(oldId) } catch (error) { problems.push(`恢复 ${old.manifest.name} 失败：${error.message}`) }
    }
    const requested = this.records.get(pending.requested)
    const message = `切换失败：${reason}。${problems.length ? problems.join('；') : pending.previous.length ? '已恢复原插件' : '已停用此插件'}`
    if (!pending.previous.includes(pending.requested)) { requested.state = 'failed'; requested.error = message; requested.enabled = false }
    else requested.error = message
    this.pendingSwitch = null; this.changed(); return message
  }
  async close() { await this.queue; if (this.settings.pending) await this.settings.cancel(this.settings.pending.token, '应用正在退出'); if (this.pendingSwitch) await this.rollbackExclusive(this.pendingSwitch.token, '应用正在退出'); for (const id of [...this.records.keys()].reverse()) await this.stop(id) }
}
