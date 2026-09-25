import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../server/server.js'

test('主题切换需要前端确认，互斥、持久化、停用和重启恢复', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-theme-')), file = join(dir, 'notes.json')
  let app
  const flags = async () => JSON.parse(await readFile(join(dir, 'plugins-state.json'), 'utf8'))
  try {
    app = await createApp({ port: 0, file })
    const manager = app.manager
    assert.equal(app.ctx.theme.id, 'theme')
    assert.equal(manager.serialize().plugins.filter(p => p.exclusiveGroup && p.state === 'enabled').length, 1)
    const { pendingSwitch: pending } = await manager.toggle('theme-blue', true)
    assert.equal(app.ctx.theme.id, 'theme-blue')
    assert.equal(manager.records.get('theme').state, 'disabled')
    assert.equal((await flags()).theme, true)
    assert.equal((await flags())['theme-blue'], false)
    await assert.rejects(manager.toggle('theme-night', true), /正在确认/)
    await assert.rejects(manager.finishExclusive('wrong-token', true), /已结束/)
    const base = `http://127.0.0.1:${app.server.address().port}`
    const response = await fetch(base + '/api/plugins/exclusive/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: pending.token, success: true }) })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).pendingSwitch, null)
    assert.equal((await flags())['theme-blue'], true)
    assert.equal((await flags()).theme, false)
    await assert.rejects(manager.finishExclusive(pending.token, true), /已结束/)
    await app.close(); app = await createApp({ port: 0, file })
    assert.equal(app.ctx.theme.id, 'theme-blue')
    const off = await app.manager.toggle('theme-blue', false)
    assert.equal(app.ctx.theme, undefined)
    await app.manager.finishExclusive(off.pendingSwitch.token, true)
    await app.close(); app = await createApp({ port: 0, file })
    assert.equal(app.ctx.theme, undefined)
    assert.equal(app.manager.serialize().plugins.filter(p => p.exclusiveGroup && p.enabled).length, 0)
  } finally { if (app) await app.close(); await rm(dir, { recursive: true, force: true }) }
})

test('前端或后端失败、确认超时均恢复旧主题，退出不保存未确认选择', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-theme-fail-')), file = join(dir, 'notes.json')
  let app
  try {
    app = await createApp({ port: 0, file }); const manager = app.manager
    let pending = (await manager.toggle('theme-blue', true)).pendingSwitch
    const failed = await manager.finishExclusive(pending.token, false, '模拟前端导入失败')
    assert.match(failed.message, /模拟前端导入失败.*已恢复原插件/)
    assert.equal(app.ctx.theme.id, 'theme')
    assert.equal(manager.records.get('theme-blue').state, 'failed')
    const night = manager.records.get('theme-night'), original = night.server
    night.server = { apply() { throw new Error('模拟后端失败') } }
    await assert.rejects(manager.toggle('theme-night', true), /模拟后端失败/)
    night.server = original
    assert.equal(app.ctx.theme.id, 'theme')
    pending = (await manager.toggle('theme-night', true)).pendingSwitch
    // Invoke the same rollback path used by the confirmation deadline.
    await manager.locked(() => manager.rollbackExclusive(pending.token, '页面确认超时'))
    assert.equal(app.ctx.theme.id, 'theme')
    pending = (await manager.toggle('theme-blue', true)).pendingSwitch
    const persist = manager.persist
    manager.persist = async () => { throw new Error('磁盘写入失败') }
    await assert.rejects(manager.finishExclusive(pending.token, true), /保存插件选择失败.*磁盘写入失败/)
    manager.persist = persist
    assert.equal(app.ctx.theme.id, 'theme')
    assert.equal(manager.pendingSwitch, null)
    await manager.toggle('theme-blue', true)
    await app.close(); app = await createApp({ port: 0, file })
    assert.equal(app.ctx.theme.id, 'theme')
    assert.equal(app.manager.pendingSwitch, null)
  } finally { if (app) await app.close(); await rm(dir, { recursive: true, force: true }) }
})

test('启动修复互斥冲突；依赖保护和 Cordis 服务唯一性阻止不合法切换', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-theme-conflict-'))
  let app
  try {
    await writeFile(join(dir, 'plugins-state.json'), JSON.stringify({ theme: true, 'theme-blue': true, 'theme-night': true }))
    app = await createApp({ port: 0, file: join(dir, 'notes.json') })
    assert.equal(app.ctx.theme.id, 'theme-night')
    assert.equal(app.manager.serialize().plugins.filter(p => p.exclusiveGroup && p.enabled).length, 1)
    await assert.rejects(app.manager.start('theme-blue'), /theme|registered/i)
    assert.equal(app.ctx.theme.id, 'theme-night')
    app.manager.records.set('theme-dependent', { manifest: { id: 'theme-dependent', name: '主题依赖测试', dependencies: ['theme-night'] }, state: 'enabled', enabled: true, logs: [] })
    await assert.rejects(app.manager.toggle('theme', true), /仍有插件依赖/)
    assert.equal(app.ctx.theme.id, 'theme-night')
    assert.equal(app.manager.pendingSwitch, null)
    app.manager.records.delete('theme-dependent')
  } finally { if (app) await app.close(); await rm(dir, { recursive: true, force: true }) }
})
