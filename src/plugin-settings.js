import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { normalizeConfig } from '../client/config-schema.js'
import { fail } from './http.js'

// Only the initiating page previews uncommitted settings. SSE carries committed values.
export class PluginSettings {
  constructor(manager) { this.manager = manager; this.pending = null; this.values = new Map(); this.errors = new Map() }
  describe(record) {
    if (!record.manifest.settings) return {}
    const saved = this.values.get(record.manifest.id)
    return { config: saved?.value ?? normalizeConfig(record.manifest.settings), configRevision: saved?.revision ?? 0, configError: this.errors.get(record.manifest.id) || '' }
  }
  async load() {
    let saved = {}
    try { saved = JSON.parse(await readFile(join(this.manager.dataDir, 'plugins-config.json'), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('插件配置文件格式无效')
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
    await writeFile(path + '.tmp', JSON.stringify(Object.fromEntries(next), null, 2)); await rename(path + '.tmp', path)
    this.values = next
  }
  assertIdle() { if (this.pending) throw fail(409, '正在应用插件配置，请稍后再试') }
  begin(id, input, expectedRevision) {
    return this.manager.locked(async () => {
      this.assertIdle()
      if (this.manager.pendingSwitch) throw fail(409, '正在确认主题切换，请稍后再试')
      const record = this.manager.records.get(id)
      if (!record?.manifest.builtin || !record.manifest.settings || record.server) throw fail(400, '此插件尚未提供前端配置声明')
      const previous = this.describe(record)
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== previous.configRevision) throw fail(409, '配置已在其他页面更新，请载入最新设置后重试')
      let value
      try { value = normalizeConfig(record.manifest.settings, input) } catch (error) { throw fail(400, error.message) }
      if (JSON.stringify(value) === JSON.stringify(previous.config) && !previous.configError) return this.manager.serialize()
      if (record.enabled && record.state !== 'enabled') throw fail(409, '插件尚未就绪，请恢复运行或停用后保存配置')
      const revision = previous.configRevision + 1
      if (!record.enabled) {
        await this.persist(id, value, revision); this.errors.delete(id); this.manager.changed()
        return this.manager.serialize()
      }
      this.errors.delete(id)
      const pending = { id, token: randomUUID(), value, revision, generation: record.generation }
      this.pending = pending
      pending.timer = setTimeout(() => this.manager.locked(() => this.cancel(pending.token, '页面未在 20 秒内确认应用，原配置已保留')).catch(console.error), 20000)
      this.manager.changed()
      return { ...this.manager.serialize(), preview: { ...this.manager.describe(record), config: value, configRevision: revision } }
    })
  }
  finish(token, success, message = '') {
    return this.manager.locked(async () => {
      const pending = this.pending
      if (!pending || pending.token !== token) throw fail(409, '本次配置变更已结束，请载入最新设置')
      if (typeof success !== 'boolean') throw fail(400, 'success 必须是布尔值')
      if (!success) { this.cancel(token, `配置应用失败：${String(message).slice(0, 500)}。原配置已保留`); return this.manager.serialize() }
      const record = this.manager.records.get(pending.id)
      if (!record.enabled || record.state !== 'enabled' || record.generation !== pending.generation) { this.cancel(token, '插件运行状态已变化，原配置已保留'); throw fail(409, '插件运行状态已变化，配置未保存') }
      try { await this.persist(pending.id, pending.value, pending.revision) }
      catch (error) { this.cancel(token, '写入配置失败，原配置已保留'); throw error }
      clearTimeout(pending.timer); this.pending = null; this.errors.delete(pending.id); this.manager.changed()
      return this.manager.serialize()
    })
  }
  cancel(token, message) {
    if (this.pending?.token !== token) return
    clearTimeout(this.pending.timer); this.errors.set(this.pending.id, message); this.pending = null; this.manager.changed()
  }
}
