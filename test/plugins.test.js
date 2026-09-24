import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/server.js'
import { validatePackage } from '../src/host/plugins.js'
const pkg = (id, server = 'export default function() {}', dependencies = []) => ({ manifest: { id, name: id, version: '1.0.0', apiVersion: 1, dependencies, server: 'server.js' }, files: { 'server.js': server } })
async function eventually(check) { const until = Date.now() + 6000; while (Date.now() < until) { if (await check()) return; await new Promise(r => setTimeout(r, 50)) }; assert.fail('状态没有按预期变化') }
test('插件安装校验拒绝路径逃逸、不兼容接口及覆盖元数据', () => {
  for (const path of ['../escape.js', 'C:/bad.js', 'package.json', 'plugin.json', 'nul.js']) { const input = pkg('invalid'); input.files[path] = ''; assert.throws(() => validatePackage(input)) }
  const input = pkg('invalid'); input.manifest.apiVersion = 999; assert.throws(() => validatePackage(input))
})
test('实时启停、依赖保护、外部文件与命令、重启恢复、数据保留和崩溃恢复', { timeout: 30000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-plugin-')); let app
  try {
    const file = join(dir, 'notes.json'); app = await createApp({ port: 0, file })
    assert.ok(app.manager.serialize().plugins.filter(p => p.enabled).every(p => p.state === 'enabled'))
    assert.equal(app.manager.records.get('note-summary').enabled, false)
    await assert.rejects(app.manager.toggle('storage', false), /请先停用/)
    await app.manager.toggle('search', false); assert.equal(app.manager.records.get('search').state, 'disabled')
    await app.manager.toggle('search', true)
    await assert.rejects(app.manager.install(pkg('test-one'), false), /信任/)
    const demo = { manifest: JSON.parse(await readFile('examples/local-lab/manifest.json', 'utf8')), files: { 'server.js': await readFile('examples/local-lab/server.js', 'utf8'), 'client.js': await readFile('examples/local-lab/client.js', 'utf8') } }
    await app.manager.install(demo, true); assert.equal(app.manager.records.get('local-lab').state, 'disabled')
    await app.manager.toggle('local-lab', true)
    const record = app.manager.records.get('local-lab'), result = await record.remote.call('inspect')
    assert.match(result.command, /^v\d+/); assert.equal(result.noteCount, 0); assert.equal(result.text, await readFile(result.file, 'utf8')); assert.notEqual(result.pid, process.pid)
    await app.manager.toggle('local-lab', false); assert.throws(() => process.kill(result.pid, 0))
    await app.manager.toggle('search', false); await app.close()
    app = await createApp({ port: 0, file }); assert.equal(app.manager.records.get('search').state, 'disabled'); assert.equal(app.manager.records.get('local-lab').state, 'disabled')
    await app.manager.toggle('local-lab', true); assert.equal((await app.manager.records.get('local-lab').remote.call('inspect')).text, result.text)
    await app.manager.toggle('local-lab', false); await app.manager.uninstall('local-lab'); assert.equal(await readFile(result.file, 'utf8'), result.text)
    await app.manager.install(demo, true)
    await assert.rejects(app.manager.clearData('local-lab', 'wrong-id'), /确认插件 ID/)
    await app.manager.clearData('local-lab', 'local-lab'); await assert.rejects(readFile(result.file), { code: 'ENOENT' })
    await app.manager.install(pkg('crasher', `export default function(ctx, api) { api.handle('crash', () => process.exit(7)) }`), true)
    await app.manager.toggle('crasher', true)
    await app.manager.install(pkg('crash-dependent', 'export default function() {}', ['crasher']), true); await app.manager.toggle('crash-dependent', true)
    await assert.rejects(app.manager.records.get('crasher').remote.call('crash'))
    await eventually(() => app.manager.records.get('crasher').state === 'failed')
    await eventually(() => app.manager.records.get('crash-dependent').state === 'failed')
    assert.equal((await fetch(`http://127.0.0.1:${app.server.address().port}/api/plugins`)).status, 200)
    await app.manager.toggle('crasher', true); assert.equal(app.manager.records.get('crasher').state, 'enabled'); await app.manager.toggle('crasher', false)
    await app.manager.install(pkg('bad-start', `export default function() { throw new Error('预期启动失败') }`), true)
    await assert.rejects(app.manager.toggle('bad-start', true), /预期启动失败/); assert.equal(app.manager.records.get('bad-start').state, 'failed')
  } finally { if (app) await app.close(); await rm(dir, { recursive: true, force: true }) }
})
test('停用时清理通过 SDK 登记的命令进程', { timeout: 15000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-process-')); const app = await createApp({ port: 0, file: join(dir, 'notes.json') })
  try {
    await app.manager.install(pkg('process-test', `export default function(ctx, api) { api.handle('spawn', () => { const child = api.spawn(process.execPath, ['-e','setInterval(()=>{},1000)']); return child.pid }) }`), true)
    await app.manager.toggle('process-test', true); const pid = await app.manager.records.get('process-test').remote.call('spawn'); process.kill(pid, 0)
    await app.manager.toggle('process-test', false); await eventually(() => { try { process.kill(pid, 0); return false } catch { return true } })
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }) }
})
