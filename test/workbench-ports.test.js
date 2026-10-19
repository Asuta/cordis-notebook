import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { findAvailablePort, isPortAvailable, listenOnAvailablePort } from '../workbench/ports.js'
import { createWorkbench } from '../workbench/server.js'

async function occupy(port) {
  const server = createServer((req, res) => res.end('busy'))
  await new Promise((accept, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', accept)
  })
  return server
}
async function close(server) {
  if (!server?.listening) return
  await new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve) })
}
async function consecutiveFreePorts() {
  for (let port = 20000; port < 40000; port++) {
    if (await isPortAvailable(port) && await isPortAvailable(port + 1)) return port
  }
  throw Error('找不到连续两个空闲端口')
}

test('端口探测跳过被占用的端口，并保持端口 0 由系统分配', async t => {
  const start = await consecutiveFreePorts()
  const blocked = await occupy(start)
  t.after(() => close(blocked))
  assert.equal(await isPortAvailable(start), false)
  assert.equal(await isPortAvailable(start + 1), true)
  const found = await findAvailablePort(start)
  assert.ok(found >= start + 1, `应从 ${start} 之后找到端口，实际 ${found}`)
  const ephemeral = await findAvailablePort(0)
  assert.ok(ephemeral > 0)
})

test('监听端口被占用时复用同一个 server 继续向上尝试', async t => {
  const start = await consecutiveFreePorts()
  const blocked = await occupy(start)
  t.after(() => close(blocked))
  const server = createServer((req, res) => res.end('workbench'))
  t.after(() => close(server))
  const port = await listenOnAvailablePort(server, start)
  assert.ok(port > start, `应跳过被占用的 ${start}，实际 ${port}`)
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'workbench')
})

test('工作台启动命令自动跳过被占用的端口且页面可访问', async t => {
  const start = await consecutiveFreePorts()
  const blocked = await occupy(start)
  const dir = await mkdtemp(join(tmpdir(), 'cordis-workbench-port-'))
  let wb
  t.after(async () => {
    await wb?.close().catch(() => {})
    await close(blocked)
    await rm(dir, { recursive: true, force: true })
  })
  wb = await createWorkbench({ root: resolve('.'), port: start, appPort: 0, autoStart: false, dataDir: dir })
  const port = wb.server.address().port
  assert.ok(port > start, `工作台应从 ${start} 之后监听，实际 ${port}`)
  const response = await fetch(`http://127.0.0.1:${port}/api/config`)
  assert.equal(response.status, 200); assert.ok((await response.json()).models.length > 0)
})

test('同一个数据目录只允许一个工作台同时运行', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-workbench-lock-'))
  let first = await createWorkbench({ root: resolve('.'), port: 0, appPort: 0, autoStart: false, dataDir: dir })
  t.after(async () => {
    await first?.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  })
  await assert.rejects(createWorkbench({ root: resolve('.'), port: 0, appPort: 0, autoStart: false, dataDir: dir }),
    error => /已有工作台运行/.test(error.message) && error.message.includes('http://127.0.0.1:'))
  await first.close(); first = null
  const second = await createWorkbench({ root: resolve('.'), port: 0, appPort: 0, autoStart: false, dataDir: dir })
  await second.close()
  // A crashed instance leaves a dead pid; the next start reclaims the lock.
  await writeFile(join(dir, 'workbench.lock'), JSON.stringify({ pid: 999999, port: 1 }))
  const third = await createWorkbench({ root: resolve('.'), port: 0, appPort: 0, autoStart: false, dataDir: dir })
  await third.close()
})
