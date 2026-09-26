import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../server/server.js'

test('workspace 插件实时启停、依赖保护与重启恢复保留笔记', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-plugin-')); let app
  try {
    app = await createApp({ port: 0, dataDir: dir })
    assert.ok(app.manager.serialize().plugins.filter(p => p.enabled).every(p => p.state === 'enabled'))
    for (const plugin of app.manager.serialize().plugins) {
      assert.equal(plugin.schemaVersion, 1)
      for (const field of ['apiVersion', 'builtin', 'permissions', 'dependencies', 'pid', 'logs']) assert.equal(Object.hasOwn(plugin, field), false, field)
    }
    assert.equal(app.manager.records.get('note-summary').enabled, false)
    await assert.rejects(app.manager.toggle('storage', false), /请先停用/)
    const note = await app.ctx.notes.create()
    await app.ctx.notes.update(note.id, { title: '保留笔记数据' })
    await app.manager.toggle('search', false)
    assert.equal(app.manager.records.get('search').state, 'disabled')
    await app.manager.toggle('search', true)
    assert.equal(app.manager.records.get('search').state, 'enabled')
    await app.manager.toggle('search', false)
    await app.close(); app = null
    app = await createApp({ port: 0, dataDir: dir })
    assert.equal(app.manager.records.get('search').state, 'disabled')
    assert.equal(app.ctx.notes.list().find(p => p.id === note.id).title, '保留笔记数据')
  } finally { if (app) await app.close(); await rm(dir, { recursive: true, force: true }) }
})

test('旧 API v1 安装记录不加载，旧代码和数据原样保留', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-retired-')); let app
  try {
    const codeDir = join(dir, 'plugins', 'legacy-demo'), dataDir = join(dir, 'plugin-data', 'legacy-demo')
    await mkdir(codeDir, { recursive: true }); await mkdir(dataDir, { recursive: true })
    const manifest = { id: 'legacy-demo', name: '旧插件', version: '1.0.0', apiVersion: 1, dependencies: [], server: 'server.js' }
    const code = `throw new Error('旧插件不应执行')`
    const pkg = { manifest, files: { 'server.js': code } }
    await writeFile(join(codeDir, 'plugin.json'), JSON.stringify(pkg))
    await writeFile(join(codeDir, 'package.json'), JSON.stringify({ type: 'module' }))
    await writeFile(join(codeDir, 'server.js'), code)
    await writeFile(join(dataDir, 'saved.txt'), '旧数据')
    await writeFile(join(dir, 'plugins-state.json'), JSON.stringify({ 'legacy-demo': true }))
    app = await createApp({ port: 0, dataDir: dir })
    assert.equal(app.manager.records.has('legacy-demo'), false)
    const base = `http://127.0.0.1:${app.server.address().port}`
    for (const [method, path] of [
      ['POST', '/api/plugins/install'], ['DELETE', '/api/plugins/legacy-demo'],
      ['POST', '/api/plugins/legacy-demo/clear-data'], ['POST', '/api/plugins/legacy-demo/rpc'],
      ['GET', '/plugins/legacy-demo/server.js'], ['GET', '/plugins/legacy-demo/client.js'],
    ]) assert.equal((await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' } })).status, 404, path)
    assert.doesNotMatch(await (await fetch(base)).text(), /install-plugin|install-preview|cordis-plugin[.]json/)
    await app.manager.toggle('search', false)
    await app.close(); app = null
    app = await createApp({ port: 0, dataDir: dir })
    assert.equal(app.manager.records.has('legacy-demo'), false)
    assert.equal(await readFile(join(codeDir, 'server.js'), 'utf8'), code)
    assert.deepEqual(JSON.parse(await readFile(join(codeDir, 'plugin.json'), 'utf8')), pkg)
    assert.equal(await readFile(join(dataDir, 'saved.txt'), 'utf8'), '旧数据')
  } finally { if (app) await app.close(); await rm(dir, { recursive: true, force: true }) }
})

test('空插件目录也能启动管理宿主，不提供笔记业务', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-empty-')); let app
  try {
    const pluginsDir = join(dir, 'workspace'); await mkdir(pluginsDir)
    app = await createApp({ port: 0, dataDir: dir, pluginsDir })
    const base = `http://127.0.0.1:${app.server.address().port}`
    assert.deepEqual((await (await fetch(base + '/api/plugins')).json()).plugins, [])
    assert.equal(app.ctx.get('notes'), undefined)
    assert.equal((await fetch(base + '/api/notes')).status, 404)
    assert.equal((await fetch(base)).status, 200)
  } finally { if (app) await app.close(); await rm(dir, { recursive: true, force: true }) }
})
