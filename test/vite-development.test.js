import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { resolve, join, sep } from 'node:path'
import { startDevelopment } from '../scripts/dev.js'

test('Vite 开发服务限制源码公开、编译失败保留后端，并等待页面保存后原地更新插件', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(resolve('vite-test-')), apps = join(directory, 'applications')
  const folder = join(apps, 'sample/plugins/sample'), source = join(folder, 'server.js')
  let dev, socket, stalledSocket, prepareHook, savePage = true, saveStalledPage = false, sequence = 0
  const confirm = (client, token) => client.send(JSON.stringify({ type: 'custom', event: 'cordis:prepared', data: { token, success: true } }))
  const listeners = new Set(), messages = []
  const message = (predicate, label, after = 0) => new Promise((accept, reject) => {
    const matches = value => value.sequence > after && predicate(value)
    const found = messages.find(matches)
    if (found) { messages.splice(messages.indexOf(found), 1); accept(found); return }
    const timer = setTimeout(() => { listeners.delete(receive); reject(Error('等待开发事件超时：' + label + '，收到 ' + JSON.stringify(messages))) }, 12000)
    const receive = value => { if (!matches(value)) return false; clearTimeout(timer); listeners.delete(receive); accept(value); return true }
    listeners.add(receive)
  })
  try {
    await mkdir(folder, { recursive: true })
    await writeFile(join(apps, 'sample/package.json'), JSON.stringify({ cordisApp: { id: 'sample', name: '测试应用' } }))
    await writeFile(join(folder, 'package.json'), JSON.stringify({
      name: '@test/sample', version: '1.0.0', type: 'module', dependencies: {},
      cordis: { schemaVersion: 1, id: 'sample', name: '测试插件', defaultEnabled: true,
        client: 'client.js', server: { entry: 'server.js', export: 'default' }, public: ['client.js', 'style.css'], styles: ['style.css'],
        requires: { server: ['http'], client: [] }, provides: { server: [], client: [] },
        build: [{ type: 'bundle', input: 'client.js', output: 'client.js', platform: 'browser' },
          { type: 'bundle', input: 'server.js', output: 'server.js', platform: 'node' },
          { type: 'copy', input: 'style.css', output: 'style.css' }],
      },
    }))
    await writeFile(join(folder, 'client.js'), 'export default () => {}')
    await writeFile(join(folder, 'style.css'), '.sample { color: red }')
    await writeFile(join(folder, 'helper.js'), 'export const value = (')
    const backend = version => `export default ctx => { ctx.http.route(ctx, 'GET', new RegExp('^/api/sample$'), () => ({version:${version}})) }`
    await writeFile(source, backend(1))
    dev = await startDevelopment({ port: 0, dataDir: join(directory, 'data'), cacheDir: join(directory, 'cache'), applicationsDir: apps, initialApplication: 'sample', saveTimeout: 1500 })
    const base = `http://127.0.0.1:${dev.vite.httpServer.address().port}`
    const get = async () => (await fetch(base + '/api/sample')).json()
    assert.deepEqual(await get(), { version: 1 })
    assert.ok((await (await fetch(base)).text()).includes('/@vite/client'))
    const viteClient = await (await fetch(base + '/@vite/client')).text()
    const environmentImport = viteClient.match(/\bimport\s+["']([^"']+\/env\.mjs)["']/)
    assert.ok(environmentImport, 'Vite 客户端声明环境运行库')
    const environmentResponse = await fetch(new URL(environmentImport[1], base))
    assert.equal(environmentResponse.status, 200, 'Vite 环境运行库不能被源码白名单拦截')
    assert.match(environmentResponse.headers.get('content-type'), /javascript/)
    for (const path of ['/server/server.js', '/package.json', '/@fs/' + source.replaceAll('\\', '/')]) {
      assert.equal((await fetch(base + path)).status, 404, path)
    }
    socket = new WebSocket(base.replace('http:', 'ws:') + '/?token=' + dev.vite.config.webSocketToken, 'vite-hmr')
    socket.addEventListener('message', event => {
      const value = { ...JSON.parse(event.data), sequence: ++sequence }
      // A real page answers every save request, including Vite's automatic reloads.
      if (value.event === 'cordis:prepare') {
        prepareHook?.(value)
        if (savePage) confirm(socket, value.data.token)
      }
      if (![...listeners].some(receive => receive(value))) messages.push(value)
    })
    await message(value => value.type === 'connected', '连接')
    socket.send(JSON.stringify({ type: 'custom', event: 'cordis:ready', data: {} }))
    const resources = (await (await fetch(base + '/__cordis/dev')).json()).plugins.sample.sample
    assert.equal((await fetch(base + resources.client)).status, 200)
    assert.ok((await (await fetch(base + resources.styles['style.css'])).text()).includes('color: red'))
    await writeFile(join(folder, 'style.css'), '.sample { color: blue }')
    await message(value => value.type === 'update' && value.updates.some(update => update.type === 'css-update'), '样式更新')
    assert.ok((await (await fetch(base + resources.styles['style.css'])).text()).includes('color: blue'))
    await writeFile(join(folder, 'client.js'), 'export default (')
    await message(value => value.type === 'error', '前端编译错误')
    await writeFile(join(folder, 'client.js'), 'export default () => 42')
    const updated = await message(value => value.event === 'cordis:plugins', '前端恢复')
    assert.deepEqual(updated.data.targets, { sample: ['sample'] })
    assert.ok((await (await fetch(base + resources.client + '?t=' + updated.data.version)).text()).includes('42'))
    const htmlAfter = sequence
    dev.vite.ws.send({ type: 'full-reload', path: '*' })
    const html = await message(value => value.event === 'cordis:prepare', '整页刷新保存保护', htmlAfter)
    await message(value => value.event === 'cordis:restart', '保存后整页刷新', html.sequence)
    const sibling = join(folder, 'helper.js')
    await writeFile(join(folder, 'client.js'), "import { value } from './helper.js'; export default () => value")
    await message(value => value.type === 'error', '新增相对模块编译错误')
    await writeFile(sibling, 'export const value = 43')
    const nested = await message(value => value.event === 'cordis:plugins', '相对模块恢复')
    assert.deepEqual(nested.data.targets, { sample: ['sample'] })
    await rm(sibling)
    await message(value => value.type === 'error', '删除正在引用的模块')
    await writeFile(join(folder, 'client.js'), 'export default () => 44')
    const removed = await message(value => value.event === 'cordis:plugins', '移除相对导入后恢复')
    assert.deepEqual(removed.data.targets, { sample: ['sample'] })
    const port = dev.backendPort, pid = dev.backendPid
    await assert.rejects(readFile(join(folder, 'dist/server.js')), { code: 'ENOENT' })
    await writeFile(source, 'export default (')
    await message(value => value.type === 'error', '编译错误')
    assert.equal(dev.backendPort, port)
    await assert.rejects(readFile(join(folder, 'dist/server.js')), { code: 'ENOENT' })
    assert.deepEqual(await get(), { version: 1 })
    savePage = false
    const failedAfter = sequence
    await writeFile(source, backend(2))
    const preparation = await message(value => value.event === 'cordis:prepare', '保存准备', failedAfter)
    assert.deepEqual(await get(), { version: 1 })
    socket.send(JSON.stringify({ type: 'custom', event: 'cordis:prepared', data: { token: preparation.data.token, success: false, error: '测试保存失败' } }))
    await message(value => value.type === 'error', '保存失败')
    assert.equal(dev.backendPort, port)
    await assert.rejects(readFile(join(folder, 'dist/server.js')), { code: 'ENOENT' })
    const retryAfter = sequence
    await writeFile(source, backend(3))
    const retry = await message(value => value.event === 'cordis:prepare', '再次保存准备', retryAfter)
    socket.send(JSON.stringify({ type: 'custom', event: 'cordis:prepared', data: { token: retry.data.token, success: true } }))
    await message(value => value.event === 'cordis:catalog', '原地更新', retry.sequence)
    savePage = true
    assert.equal(dev.backendPort, port); assert.equal(dev.backendPid, pid)
    assert.deepEqual(await get(), { version: 3 })
    stalledSocket = new WebSocket(base.replace('http:', 'ws:') + '/?token=' + dev.vite.config.webSocketToken, 'vite-hmr')
    stalledSocket.addEventListener('message', event => {
      const value = JSON.parse(event.data)
      if (saveStalledPage && value.event === 'cordis:prepare') confirm(stalledSocket, value.data.token)
    })
    await new Promise(resolve => stalledSocket.addEventListener('open', resolve, { once: true }))
    stalledSocket.send(JSON.stringify({ type: 'custom', event: 'cordis:ready', data: { application: '未响应的页面' } }))
    const delayedAfter = sequence
    await writeFile(source, backend(4))
    const delayed = await message(value => value.event === 'cordis:prepare', '等待第二个页面', delayedAfter)
    const blocked = await message(value => value.event === 'cordis:blocked', '页面超时状态', delayed.sequence)
    assert.deepEqual(blocked.data.clients.map(client => client.application), ['未响应的页面'])
    assert.deepEqual(await get(), { version: 3 })
    await message(value => value.event === 'cordis:resume' && value.data.token === delayed.data.token, '超时解除保护')
    confirm(stalledSocket, delayed.data.token)
    const recovered = await message(value => value.event === 'cordis:prepare', '页面恢复后无需再保存源码即可重试', delayed.sequence)
    assert.notEqual(recovered.data.token, delayed.data.token)
    confirm(stalledSocket, delayed.data.token)
    assert.deepEqual(await get(), { version: 3 })
    confirm(stalledSocket, recovered.data.token)
    await message(value => value.event === 'cordis:catalog', '重新确认后原地更新', recovered.sequence)
    assert.deepEqual(await get(), { version: 4 })

    const pendingAfter = sequence
    await writeFile(source, backend(5))
    const pending = await message(value => value.event === 'cordis:prepare', '待处理后端修改', pendingAfter)
    await message(value => value.event === 'cordis:blocked', '后端修改暂缓', pending.sequence)
    saveStalledPage = true
    // A host-only refresh must not drop the deferred backend update.
    // Queue another refresh during preparation to exercise separate update batches.
    prepareHook = () => {
      prepareHook = undefined
      dev.vite.ws.send({ type: 'full-reload', path: '*' })
    }
    const hostAfter = sequence
    dev.vite.ws.send({ type: 'full-reload', path: '*' })
    const host = await message(value => value.event === 'cordis:prepare', '整页刷新再次检查后端', hostAfter)
    await message(value => value.event === 'cordis:catalog', '宿主刷新前先更新待处理插件', host.sequence)
    await message(value => value.event === 'cordis:restart', '宿主刷新包含待处理后端', host.sequence)
    const extra = await message(value => value.event === 'cordis:prepare' && value.data.token !== host.data.token, '额外刷新重新确认保存', host.sequence)
    await message(value => value.event === 'cordis:restart', '额外刷新完成', extra.sequence)
    assert.deepEqual(await get(), { version: 5 })

    saveStalledPage = false
    const closingAfter = sequence
    await writeFile(source, backend(6))
    const closing = await message(value => value.event === 'cordis:prepare', '关闭页面之前的准备', closingAfter)
    await message(value => value.event === 'cordis:blocked', '关闭前暂缓', closing.sequence)
    const closedAfter = sequence
    stalledSocket.close()
    const closed = await message(value => value.event === 'cordis:prepare', '关闭失去响应页面后自动重试', closedAfter)
    await message(value => value.event === 'cordis:catalog', '关闭失去响应页面后原地更新', closed.sequence)
    assert.deepEqual(await get(), { version: 6 })
  } finally {
    socket?.close(); stalledSocket?.close()
    await dev?.close()
    assert.ok(directory.startsWith(resolve('.') + sep))
    await rm(directory, { recursive: true, force: true })
  }
})
