import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { createHost } from '../server/server.js'
import { imageFixture, until } from './helpers/studio-wavespeed.js'

test('画布操作立即响应，网络失败可重试，校验拒绝可继续编辑，恢复失败仍可导出', { skip: process.env.CORDIS_BROWSER_TEST !== '1', timeout: 45000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-edit-browser-'))
  let host, browser, page
  t.after(async () => {
    if (page && process.env.CORDIS_BROWSER_ARTIFACT_DIR) {
      const output = resolve(process.env.CORDIS_BROWSER_ARTIFACT_DIR)
      await mkdir(output, { recursive: true })
      await page.screenshot({ path: join(output, 'studio-edit-latency.png') }).catch(() => {})
    }
    await browser?.close(); await host?.close(); await rm(dir, { recursive: true, force: true })
  })
  host = await createHost({ port: 0, dataDir: dir, locationRoot: dir, initialApplication: 'studio' })
  const origin = 'http://127.0.0.1:' + host.server.address().port
  const request = async (path = '', body) => {
    const response = await fetch(origin + '/api/studio' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Application-Session': host.applications.session }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    assert.equal(response.status, 200, await response.clone().text()); return response.json()
  }
  const asset = await request('/upload', { name: '延迟验证.png', base64: (await imageFixture()).toString('base64') })
  const board = (await request()).boards[0]
  await request('/edit', { boardId: board.id, revision: board.revision, operations: [{ type: 'add', node: { id: 'latency-image', type: 'image', assetId: asset.id, x: 80, y: 80 } }] })
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  page = await context.newPage(); page.setDefaultTimeout(8000)
  const errors = [], requests = [], latencies = []
  page.on('pageerror', error => errors.push(error.message))
  let mode = 'delay'
  await page.route('**/api/studio/edit', async route => {
    requests.push(route.request().postDataJSON())
    if (mode === 'offline') return route.abort('failed')
    if (mode === 'reject') {
      mode = 'online'
      const input = route.request().postDataJSON()
      // Exercise a real server-side plugin validation failure, with no write.
      input.operations[0].node.text = 'x'.repeat(12001)
      return route.continue({ postData: JSON.stringify(input) })
    }
    if (mode === 'delay') await new Promise(resolve => setTimeout(resolve, 1000))
    await route.continue()
  })
  await page.goto(origin)
  const card = page.locator('[data-node="latency-image"]')
  await card.locator('.studio-media-frame img').waitFor()
  await until(() => card.locator('img').evaluate(image => image.complete && image.naturalWidth > 0))
  const localX = () => card.evaluate(element => parseFloat(element.style.left))
  const remoteX = async () => (await request()).boards[0].nodes.find(node => node.id === 'latency-image').x
  const move = async dx => {
    let head
    await until(async () => { head = await card.locator('.studio-card-head').boundingBox(); return !!head })
    const before = await localX()
    const started = performance.now()
    await page.mouse.move(head.x + 60, head.y + 12); await page.mouse.down()
    await page.mouse.move(head.x + 60 + dx, head.y + 12, { steps: 3 }); await page.mouse.up()
    await until(async () => await localX() === before + dx, '拖动等待了后台保存', 650)
    latencies.push(Math.round(performance.now() - started))
    assert.ok(latencies.at(-1) < 800, '拖动应先于一秒保存延迟生效')
    return before + dx
  }
  const first = await move(60)
  assert.equal(await remoteX(), 80, '本地已移动时服务端仍未收到保存')
  const second = await move(50)
  const shortcut = async (key, x) => {
    const started = performance.now()
    await page.keyboard.press(key)
    await until(async () => await localX() === x, key + ' 等待了后台保存', 650)
    latencies.push(Math.round(performance.now() - started))
    assert.ok(latencies.at(-1) < 800)
  }
  await shortcut('Control+z', first)
  await shortcut('Control+y', second)
  await until(async () => (await request()).boards[0].revision === 5, '后台未按序保存移动和撤销', 9000)
  assert.equal(await remoteX(), second)
  assert.equal(await localX(), second)
  assert.deepEqual(requests.map(input => input.revision), [1, 2, 3, 4])
  const textCards = page.locator('.studio-card.studio-text')
  const started = performance.now()
  await page.getByRole('button', { name: '＋ 文字', exact: true }).click()
  await until(async () => await textCards.count() === 1, '新建按钮等待了后台保存', 650)
  assert.ok(performance.now() - started < 800)
  assert.equal((await request()).boards[0].nodes.length, 1)
  await page.keyboard.press('Control+z')
  await until(async () => await textCards.count() === 0, '撤销新建应立即生效', 650)
  await page.keyboard.press('Control+y')
  await until(async () => await textCards.count() === 1, '重做新建应立即生效', 650)
  await until(async () => (await request()).boards[0].revision === 8, '新建和撤销未保存', 7000)
  mode = 'offline'
  const failedX = await move(40)
  await page.locator('.studio-retry-save').waitFor({ state: 'visible' })
  assert.equal(await localX(), failedX)
  assert.equal(await remoteX(), second, '网络失败不应覆盖远端或回退本地')
  const lastX = await move(30)
  const other = await context.newPage()
  await other.goto(origin); await other.locator('[data-node="latency-image"]').waitFor()
  assert.equal(await other.locator('[data-node="latency-image"]').evaluate(element => parseFloat(element.style.left)), second, '另一页面不能恢复本页未保存队列')
  assert.equal(await other.locator('.studio-retry-save').isVisible(), false)
  await other.close()
  await page.reload(); await card.waitFor()
  assert.equal(await localX(), lastX, '刷新应恢复两次未保存移动')
  await page.locator('.studio-retry-save').waitFor({ state: 'visible' })
  mode = 'online'
  await page.locator('.studio-retry-save').click()
  await until(async () => await remoteX() === lastX, '重试未保存最终位置')
  await page.locator('.studio-retry-save').waitFor({ state: 'hidden' })
  assert.equal(await localX(), lastX)
  assert.equal((await request()).boards[0].nodes.length, 2)
  mode = 'reject'
  await page.getByRole('button', { name: '＋ 文字', exact: true }).click()
  await until(async () => (await page.locator('#toast').textContent()).includes('已撤销无效修改'))
  assert.equal(await textCards.count(), 1)
  assert.equal((await request()).boards[0].nodes.length, 2)
  await page.getByRole('button', { name: '＋ 文字', exact: true }).click()
  await until(async () => (await request()).boards[0].nodes.length === 3, '校验拒绝后新建仍应保存')
  await page.keyboard.press('Control+z')
  await until(async () => (await request()).boards[0].nodes.length === 2, '校验拒绝后撤销仍应保存')
  await page.keyboard.press('Control+y')
  await until(async () => (await request()).boards[0].nodes.length === 3, '校验拒绝后重做仍应保存')
  await until(() => page.locator('.studio-status').textContent().then(text => text === '已保存'))

  const current = (await request()).boards[0]
  const journal = { version: 1, bases: [current], entries: [{ id: crypto.randomUUID(), boardId: current.id, revision: current.revision, operations: [{ type: 'add', node: { id: 'unavailable', type: 'missing-plugin' } }] }] }
  const key = 'cordis:app:studio:plugin:canvas:canvas-pending-edits-v1', raw = JSON.stringify(journal)
  await page.evaluate(({ key, raw }) => sessionStorage.setItem(key, raw), { key, raw })
  await page.reload(); await card.waitFor()
  await page.locator('.studio-export-pending').waitFor({ state: 'visible' })
  const before = requests.length
  await page.getByRole('button', { name: '＋ 文字', exact: true }).click()
  await until(async () => (await page.locator('#toast').textContent()).includes('恢复失败'))
  assert.equal(requests.length, before, '恢复失败时新操作不能覆盖原日志或发送请求')
  assert.equal(await page.evaluate(key => sessionStorage.getItem(key), key), raw)
  const download = page.waitForEvent('download')
  await page.locator('.studio-export-pending').click()
  const exported = JSON.parse(await readFile(await (await download).path(), 'utf8'))
  assert.deepEqual(exported.entries, journal.entries); assert.deepEqual(exported.bases, journal.bases)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '载入最新', exact: true }).click()
  await page.locator('.studio-export-pending').waitFor({ state: 'hidden' })
  assert.equal(await page.evaluate(key => sessionStorage.getItem(key), key), null)
  await page.getByRole('button', { name: '＋ 文字', exact: true }).click()
  await until(async () => (await request()).boards[0].nodes.length === 4, '明确放弃失败日志后应恢复正常编辑')
  assert.deepEqual(errors, [])
  t.diagnostic('保存人为延迟 1000ms，拖动与撤销重做响应：' + latencies.join(', ') + 'ms')
})
