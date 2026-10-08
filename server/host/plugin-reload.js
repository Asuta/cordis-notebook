import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeConfig } from '../../shared/config-schema.js'

/** Replace only changed declarations/fibers. Unrelated services keep their identity. */
export function reconcilePlugins(manager, entries, replace) {
  return manager.locked(async () => {
    manager.settings.assertIdle()
    if (manager.pendingSwitch) throw Error('正在确认插件切换，请完成后再更新源码')
    const previous = new Map(manager.records), values = new Map(manager.settings.values)
    const next = new Map(), configs = new Map(values), touched = new Set(replace)
    const saved = JSON.parse(await readFile(join(manager.dataDir, 'plugins-config.json'), 'utf8').catch(error => { if (error.code === 'ENOENT') return '{}'; throw error }))
    for (const entry of entries) {
      const id = entry.manifest.id, old = previous.get(id)
      if (old && !touched.has(id)) { next.set(id, old); continue }
      touched.add(id)
      const config = values.get(id) || saved[id]
      if (entry.manifest.settings && config) configs.set(id, { ...config, value: normalizeConfig(entry.manifest.settings, config.value) })
      next.set(id, { ...entry, state: 'disabled', error: '', generation: old?.generation || 0,
        enabled: old?.enabled ?? manager.savedFlags[id] ?? entry.defaultEnabled !== false })
    }
    for (const id of previous.keys()) if (!next.has(id)) touched.add(id)
    // A new theme cannot silently replace the user's current choice.
    const groups = new Set()
    for (const record of [...next.values()].sort((a, b) => Number(previous.has(b.manifest.id)) - Number(previous.has(a.manifest.id)))) {
      const group = record.manifest.exclusiveGroup
      if (!group || !record.enabled) continue
      if (groups.has(group)) {
        if (previous.get(record.manifest.id) === record) throw Error('插件更新产生了重复的单选组，请先停用其中一个插件')
        record.enabled = false
      } else groups.add(group)
    }
    const healthy = [...previous].filter(([, r]) => r.state === 'enabled').map(([id]) => id)
    try {
      for (const id of [...touched].reverse()) if (previous.has(id)) await manager.stop(id)
      manager.records = next; manager.settings.values = configs
      for (const [id, record] of next) if (touched.has(id) && record.enabled) await manager.start(id)
      // Cordis reactivates consumers when their provider returns. Surface activation failures.
      for (const record of next.values()) {
        if (!touched.has(record.manifest.id) && !healthy.includes(record.manifest.id)) continue
        await record.fiber?.await(); manager.refreshState(record)
        if (record.enabled && record.state === 'failed') throw Error(record.error || `${record.manifest.name} 启动失败`)
      }
      await manager.persist()
      manager.changed()
      return [...touched]
    } catch (error) {
      const recovery = []
      for (const id of [...touched].reverse()) if (manager.records.has(id)) {
        try { await manager.stop(id) } catch (cause) { recovery.push(cause.message) }
      }
      // Generations must never go backwards, even when restoring the old implementation.
      for (const [id, old] of previous) if (touched.has(id)) old.generation = Math.max(old.generation || 0, next.get(id)?.generation || 0)
      manager.records = previous; manager.settings.values = values
      for (const [id, record] of previous) if (touched.has(id) && record.enabled) {
        try { await manager.start(id) } catch (cause) { recovery.push(cause.message) }
      }
      for (const id of healthy) {
        try { await previous.get(id).fiber?.await() } catch (cause) { recovery.push(cause.message) }
      }
      manager.changed()
      error.message += recovery.length ? '；恢复旧插件失败：' + recovery.join('；') : '；已保留或恢复旧插件'
      throw error
    }
  })
}
