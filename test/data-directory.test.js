import { test } from 'node:test'
import assert from 'node:assert/strict'
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { createHost } from '../server/server.js'

async function json(url, options) {
  const response = await fetch(url, options), body = await response.json()
  if (!response.ok) throw Object.assign(Error(body.message || body.error), { status: response.status, body })
  return body
}

test('应用数据目录只迁移和接入当前应用，其他应用与宿主数据保持不变', { timeout: 30000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'cordis-data-location-')), data = join(root, 'data')
  const target = join(root, 'studio-moved'), attached = join(root, 'studio-attached'), notebook = join(data, 'apps', 'notebook'), drawing = join(data, 'apps', 'drawing')
  await mkdir(target); await mkdir(notebook, { recursive: true }); await mkdir(join(drawing, 'plugin-data', 'canvas'), { recursive: true })
  let app
  t.after(async () => { await app?.close(); await rm(root, { recursive: true, force: true }) })
  app = await createHost({ port: 0, dataDir: data, locationRoot: root, initialApplication: 'studio' })
  let base = `http://127.0.0.1:${app.server.address().port}`
  const studio = join(data, 'apps', 'studio')
  await writeFile(join(studio, 'application-marker.txt'), '灵感画布数据')
  await mkdir(join(studio, 'plugin-data', 'canvas', 'images'), { recursive: true })
  await sharp({ create: { width: 3, height: 2, channels: 3, background: '#dce8cf' } }).png().toFile(join(studio, 'plugin-data', 'canvas', 'images', 'migration-image.png'))
  await writeFile(join(notebook, 'notebook-marker.txt'), '笔记数据')
  await writeFile(join(drawing, 'plugins-state.json'), JSON.stringify({ canvas: true }))
  await writeFile(join(drawing, '.cordis-application.json'), JSON.stringify({ version: 1, id: 'drawing' }))
  await writeFile(join(data, 'host-marker.txt'), '宿主数据')

  let applications = await json(base + '/api/applications')
  const headers = { 'Content-Type': 'application/json', 'X-Application-Session': applications.session }
  const initial = await json(base + '/api/application-data-directory', { headers })
  assert.equal(initial.app.id, 'studio')
  assert.equal(initial.path, studio)
  assert.equal(initial.defaultPath, studio)

  const migrated = await json(base + '/api/application-data-directory', { method: 'POST', headers, body: JSON.stringify({ action: 'migrate', path: target }) })
  assert.equal(migrated.path, target)
  assert.equal(await readFile(join(target, 'application-marker.txt'), 'utf8'), '灵感画布数据')
  assert.deepEqual(JSON.parse(await readFile(join(target, '.cordis-application.json'), 'utf8')), { version: 1, id: 'studio' })
  await access(join(target, 'plugin-data', 'canvas', 'images', 'migration-image.png'))
  assert.equal(await readFile(join(studio, 'application-marker.txt'), 'utf8'), '灵感画布数据')
  assert.equal(await readFile(join(notebook, 'notebook-marker.txt'), 'utf8'), '笔记数据')
  assert.equal(await readFile(join(data, 'host-marker.txt'), 'utf8'), '宿主数据')
  assert.ok((await readFile(join(data, 'applications-state.json'), 'utf8')).includes('studio'))
  const pointer = JSON.parse(await readFile(join(root, '.cordis-application-data.json'), 'utf8'))
  assert.deepEqual(pointer, { version: 1, paths: { studio: target } })

  await app.close(); app = undefined
  await cp(target, attached, { recursive: true })
  app = await createHost({ port: 0, dataDir: data, locationRoot: root, initialApplication: 'studio' })
  base = `http://127.0.0.1:${app.server.address().port}`
  applications = await json(base + '/api/applications')
  const restartHeaders = { 'Content-Type': 'application/json', 'X-Application-Session': applications.session }
  assert.equal((await json(base + '/api/application-data-directory', { headers: restartHeaders })).path, target)

  const wrongApplication = await fetch(base + '/api/application-data-directory', { method: 'POST', headers: restartHeaders, body: JSON.stringify({ action: 'attach', path: notebook }) })
  assert.equal(wrongApplication.status, 400)
  assert.match(await wrongApplication.text(), /不是当前应用的数据目录/)

  const sharedPlugin = await fetch(base + '/api/application-data-directory', { method: 'POST', headers: restartHeaders, body: JSON.stringify({ action: 'attach', path: drawing }) })
  assert.equal(sharedPlugin.status, 400)
  assert.match(await sharedPlugin.text(), /不是当前应用的数据目录/)

  const attachedResult = await json(base + '/api/application-data-directory', { method: 'POST', headers: restartHeaders, body: JSON.stringify({ action: 'attach', path: attached }) })
  assert.equal(attachedResult.path, attached)
  assert.equal(await readFile(join(attached, 'application-marker.txt'), 'utf8'), '灵感画布数据')
  assert.equal(await readFile(join(notebook, 'notebook-marker.txt'), 'utf8'), '笔记数据')
  assert.equal(await readFile(join(data, 'host-marker.txt'), 'utf8'), '宿主数据')
  assert.deepEqual(JSON.parse(await readFile(join(root, '.cordis-application-data.json'), 'utf8')), { version: 1, paths: { studio: attached } })
  await access(join(attached, 'plugin-data'))

  const switched = await json(base + '/api/applications/switch', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Application-Session': attachedResult.session }, body: JSON.stringify({ id: 'notebook', session: attachedResult.session }) })
  assert.equal(switched.current.manageData, false)
  const unsupported = await fetch(base + '/api/application-data-directory', { headers: { 'X-Application-Session': switched.session } })
  assert.equal(unsupported.status, 400)
  assert.match(await unsupported.text(), /当前应用不支持单独设置数据目录/)
})

test('自定义应用目录离线时可由宿主恢复默认目录并重新打开应用', { timeout: 30000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'cordis-data-recovery-')), data = join(root, 'data')
  const defaultDirectory = join(data, 'apps', 'studio'), configured = join(root, 'offline-studio')
  await mkdir(defaultDirectory, { recursive: true })
  await writeFile(join(defaultDirectory, 'default-marker.txt'), '默认目录数据')
  await writeFile(join(root, '.cordis-application-data.json'), JSON.stringify({ version: 1, paths: { studio: configured } }))
  let app
  t.after(async () => { await app?.close(); await rm(root, { recursive: true, force: true }) })
  app = await createHost({ port: 0, dataDir: data, locationRoot: root, initialApplication: 'studio' })
  const base = `http://127.0.0.1:${app.server.address().port}`
  const applications = await json(base + '/api/applications')
  assert.equal(applications.current, null)
  assert.match(applications.error, /应用数据目录不存在或不是文件夹/)
  assert.deepEqual(applications.recovery, { appId: 'studio', appName: '灵感画布', configuredPath: configured, defaultPath: defaultDirectory })

  const headers = { 'Content-Type': 'application/json', 'X-Application-Session': applications.session }
  const recovered = await json(base + '/api/application-data-directory/recover', { method: 'POST', headers, body: JSON.stringify({ appId: 'studio', session: applications.session }) })
  assert.equal(recovered.current.id, 'studio')
  assert.equal(recovered.recovery, null)
  assert.equal((await json(base + '/api/application-data-directory', { headers: { 'X-Application-Session': recovered.session } })).path, defaultDirectory)
  assert.deepEqual(JSON.parse(await readFile(join(root, '.cordis-application-data.json'), 'utf8')), { version: 1, paths: {} })
})
