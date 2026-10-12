import { readFile } from 'node:fs/promises'
import { writeSnapshot } from '../../shared/persistence.js'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { normalizeConfig } from '../../shared/config-schema.js'
import { fail } from './http.js'

// Only the initiating page previews uncommitted settings. SSE carries committed values.
export class PluginSettings {
  constructor(manager) { this.manager = manager; this.pending = null; this.values = new Map(); this.errors = new Map(); this.savedValues = {} }
  describe(record) {
    if (!record.manifest.settings) return {}
    const saved = this.values.get(record.manifest.id)
    return { config: saved?.value ?? normalizeConfig(record.manifest.settings), configRevision: saved?.revision ?? 0, configError: this.errors.get(record.manifest.id) || '' }
  }
  async load() {
    let saved = {}
    try { saved = JSON.parse(await readFile(join(this.manager.dataDir, 'plugins-config.json'), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('插件配置文件格式无效')
    this.savedValues = saved
    for (const record of this.manager.records.values()) {
      const { id, settings } = record.manifest
      if (!settings || !Object.hasOwn(saved, id)) continue
      try {
        if (!Number.isSafeInteger(saved[id].revision) || saved[id].revision < 0) throw new Error('配置版本无效')
        this.values.set(id, { value: normalizeConfig(settings, saved[id].value), revision: saved[id].revision })
      } catch (error) { this.errors.set(id, `存储的配置无效，暂用默认值：${error.message}`) }
    }
  }
  async persist(id, value, revision) {
    const next = new Map(this.values); next.set(id, { value, revision })
    const path = join(this.manager.dataDir, 'plugins-config.json')
    const stored = { ...this.savedValues, ...Object.fromEntries(next) }
    await writeSnapshot(path, JSON.stringify(stored, null, 2))
    this.savedValues = stored
    this.values = next
  }
  assertIdle() { if (this.pending) throw fail(409, '正在应用插件配置，请稍后再试', 'PLUGIN_CONFIG_PENDING', true) }
  async applyBackend(record, value, restart = false) {
    record.configOverride = value
    if (restart || record.manifest.settings.mode === 'restart') {
      await this.manager.stop(record.manifest.id)
      await this.manager.start(record.manifest.id)
    } else {
      if (!record.configBinding) throw new Error('后端没有配置处理器')
      let timer
      try { await Promise.race([record.configBinding.update(value), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('后端配置处理超时')), 10000) })]) }
      catch (error) { record.configBinding.cancel(); throw error }
      finally { clearTimeout(timer) }
    }
  }
  async checkHealthy(ids) {
    for (const id of ids) {
      const record = this.manager.records.get(id)
      await record.fiber?.await()
      this.manager.refreshState(record)
      if (record.state !== 'enabled') throw new Error(`${record.manifest.name} 未恢复运行`)
    }
  }
  begin(id, input, expectedRevision, operationId) {
    return this.manager.operations.run('plugin.configure', [id], { config: input, expectedRevision }, operationId, operationId => this.manager.locked(async () => {
      this.assertIdle()
      if (this.manager.pendingSwitch) throw fail(409, '正在确认插件切换，请稍后再试', 'PLUGIN_CHANGE_PENDING', true)
      const record = this.manager.records.get(id)
      if (!record?.manifest.settings) throw fail(400, '此插件尚未提供配置声明')
      const previous = this.describe(record)
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== previous.configRevision) throw fail(409, '配置已在其他页面更新，请载入最新设置后重试', 'CONFIG_REVISION_CONFLICT')
      let value
      try { value = normalizeConfig(record.manifest.settings, input) } catch (error) { throw fail(400, error.message) }
      if (JSON.stringify(value) === JSON.stringify(previous.config) && !previous.configError) return this.manager.serialize()
      if (record.enabled && record.state !== 'enabled') throw fail(409, '插件尚未就绪，请恢复运行或停用后保存配置', 'PLUGIN_NOT_READY')
      const revision = previous.configRevision + 1
      if (!record.enabled) {
        await this.persist(id, value, revision); this.errors.delete(id); this.manager.changed()
        return this.manager.serialize()
      }
      this.errors.delete(id)
      const pending = { id, token: randomUUID(), operationId, value, revision, previous: previous.config, backend: !!record.server,
        healthy: [...this.manager.records.values()].filter(r => r.state === 'enabled').map(r => r.manifest.id), generation: record.generation }
      this.pending = pending
      this.manager.changed()
      if (pending.backend) {
        try {
          await this.applyBackend(record, value)
          await this.checkHealthy(pending.healthy)
          pending.generation = record.generation
        } catch (error) {
          await this.cancel(pending.token, `后端配置应用失败：${error.message}`)
          throw fail(500, this.errors.get(id))
        }
      }
      pending.timer = setTimeout(() => this.manager.locked(() => this.cancel(pending.token, '页面未在 20 秒内确认应用，原配置已保留')).catch(console.error), 20000)
      this.manager.operations.waiting(operationId)
      this.manager.changed()
      return { ...this.manager.serialize(), preview: { ...this.manager.describe(record), config: value, configRevision: revision } }
    }))
  }
  finish(token, success, message = '') {
    return this.manager.locked(async () => {
      const pending = this.pending
      if (!pending || pending.token !== token) throw fail(409, '本次配置变更已结束，请载入最新设置')
      if (typeof success !== 'boolean') throw fail(400, 'success 必须是布尔值')
      if (!success) { await this.cancel(token, `配置应用失败：${String(message).slice(0, 500)}。原配置已保留`); return { ...this.manager.serialize(), operation: this.manager.operations.get(pending.operationId) } }
      const record = this.manager.records.get(pending.id)
      if (!record.enabled || record.state !== 'enabled' || record.generation !== pending.generation) { await this.cancel(token, '插件运行状态已变化，原配置已保留'); throw fail(409, '插件运行状态已变化，配置未保存') }
      try {
        if (pending.backend) await this.checkHealthy(pending.healthy)
        await this.persist(pending.id, pending.value, pending.revision)
      }
      catch (error) { await this.cancel(token, '写入配置失败，原配置已保留'); throw error }
      delete record.configOverride
      clearTimeout(pending.timer); this.pending = null; this.errors.delete(pending.id); this.manager.operations.succeed(pending.operationId); this.manager.changed()
      return { ...this.manager.serialize(), operation: this.manager.operations.get(pending.operationId) }
    })
  }
  async cancel(token, message) {
    if (this.pending?.token !== token) return
    const pending = this.pending, record = this.manager.records.get(pending.id)
    this.manager.operations.update(pending.operationId, 'running', 'rolling-back')
    let recoveryFailed = false
    clearTimeout(pending.timer)
    if (pending.backend) {
      try {
        // Recreate the committed activation, even if a live callback failed halfway.
        await this.applyBackend(record, pending.previous, true)
        await this.checkHealthy(pending.healthy)
      } catch (error) { recoveryFailed = true; message += `；恢复失败：${error.message}` }
      finally { delete record.configOverride }
    }
    this.errors.set(pending.id, message); this.pending = null
    this.manager.operations.fail(pending.operationId, Object.assign(fail(500, message, recoveryFailed ? 'CONFIG_RECOVERY_FAILED' : 'CONFIG_CHANGE_REJECTED'), { operationId: pending.operationId }))
    this.manager.changed()
  }
}
