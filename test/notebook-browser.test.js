import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir, cp, readFile, readdir, symlink, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, basename } from 'node:path'
import { chromium } from 'playwright'
import { createApp } from '../server/server.js'
import { startDevelopment } from '../scripts/dev.js'

const enabled = process.env.CORDIS_BROWSER_TEST === '1'
async function until(check, label) {
  const end = Date.now() + 15000
  while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 40)) }
  assert.fail('等待失败：' + label)
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-product-'))
  const app = await createApp({ port: 0, file: join(dir, 'notes.json') }), browser = await chromium.launch({ headless: true })
  t.after(async () => { await browser.close(); await app.close(); await rm(dir, { recursive: true, force: true }) })
  const errors = [], page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') t.diagnostic(message.text().slice(0,1500)) })
  page.on('requestfailed', request => t.diagnostic(request.url() + ': ' + request.failure()?.errorText))
  const url = 'http://127.0.0.1:' + app.server.address().port
  await page.goto(url)
  return { dir, app, browser, page, url, errors }
}
async function create(page, label, title) {
  // The shell can render before all plugins finish loading, especially after
  // a cold Vite optimization/reload. Wait for the host's actual ready signal.
  await page.locator('html[data-cordis-ready="true"]').waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: '新建笔记', exact: true }).click()
  const response = page.waitForResponse(response => response.url().endsWith('/api/notes') && response.request().method() === 'POST')
  await page.getByRole('menuitem', { name: label, exact: true }).click()
  assert.equal((await response).ok(), true)
  await until(async () => (await page.locator('.note-card[aria-current=page]').innerText()).includes('无标题笔记') && await page.getByRole('textbox', { name: '笔记标题', exact: true }).inputValue() === '', '新笔记完成选择')
  await page.getByRole('textbox', { name: '笔记标题', exact: true }).fill(title)
}

test('产品浏览器：四种笔记格式输入、保存和刷新保留原始内容', { skip: !enabled, timeout: 90000 }, async t => {
  const { page, app, errors } = await fixture(t)
  for (const [type, label] of [['plain', '普通笔记'], ['markdown', 'Markdown 笔记'], ['freeform', '自由页面'], ['block', '块页面']]) {
    const text = type === 'markdown' ? '# 标题\n\n第一段\n\n第二段' : type + ' 正文保持'
    await create(page, label, label + '回归')
    if (type === 'plain') await page.getByRole('textbox', { name: '笔记正文' }).fill(text)
    if (type === 'markdown') await page.getByRole('textbox', { name: 'Markdown 源码' }).fill(text)
    if (type === 'freeform') { await page.getByRole('button', { name: '新建容器', exact: true }).click(); await page.locator('.free-page [contenteditable=true]').fill(text) }
    if (type === 'block') { await page.locator('.block-editor [contenteditable=true]').click(); await page.keyboard.insertText(text) }
    await page.keyboard.press('Control+s')
    await until(() => app.ctx.notes.list().some(n => n.type === type && n.content.includes('正文保持') || n.type === 'markdown' && n.markdown === text), label + '写入')
    const saved = app.ctx.notes.list().find(n => n.type === type)
    await page.reload()
    await page.getByRole('textbox', { name: '笔记标题', exact: true }).waitFor()
    if (type === 'plain') assert.equal(await page.getByRole('textbox', { name: '笔记正文' }).inputValue(), text)
    if (type === 'markdown') assert.equal(await page.getByRole('textbox', { name: 'Markdown 源码' }).inputValue(), text)
    if (type === 'freeform') assert.equal(await page.locator('.free-page [contenteditable=true]').innerText(), text)
    if (type === 'block') assert.match(await page.locator('.block-editor [contenteditable=true]').innerText(), /block 正文保持/)
    assert.deepEqual(app.ctx.notes.list().find(n => n.id === saved.id), saved)
  }
  assert.deepEqual(errors, [])
})

test('产品浏览器：普通 409 保存失败保留重试入口，恢复后正常保存', { skip: !enabled, timeout: 45000 }, async t => {
  const { page, app, errors } = await fixture(t)
  await create(page, '普通笔记', '临时错误恢复')
  let unavailable = true
  await page.route('**/api/notes/*', async route => {
    if (unavailable && route.request().method() === 'PATCH') {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: '笔记格式“plain”不可用，请启用对应格式插件' }) })
    } else await route.continue()
  })
  await page.getByRole('textbox', { name: '笔记正文' }).fill('恢复后应保存这份草稿')
  await page.keyboard.press('Control+s')
  await page.getByText('保存失败 · 草稿已保留，点击重试', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '另存为副本', exact: true }).count(), 0)
  assert.equal(await page.getByRole('textbox', { name: '笔记正文' }).inputValue(), '恢复后应保存这份草稿')
  unavailable = false
  await page.getByText('保存失败 · 草稿已保留，点击重试', { exact: true }).click()
  await until(() => app.ctx.notes.list()[0]?.content === '恢复后应保存这份草稿', '错误恢复后的重试写入')
  await page.reload()
  await page.getByRole('textbox', { name: '笔记正文' }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '笔记正文' }).inputValue(), '恢复后应保存这份草稿')
  assert.deepEqual(errors, [])
})

test('产品浏览器：两页冲突有提示、刷新保留草稿、另存副本不覆盖原笔记', { skip: !enabled, timeout: 60000 }, async t => {
  const { page: a, app, browser, url, errors } = await fixture(t)
  await create(a, '普通笔记', '两页冲突')
  await a.getByRole('textbox', { name: '笔记正文' }).fill('原正文'); await a.keyboard.press('Control+s')
  await until(() => app.ctx.notes.list()[0]?.content === '原正文', '原正文保存')
  const b = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); await b.goto(url)
  await b.getByRole('textbox', { name: '笔记标题', exact: true }).waitFor()
  await a.getByRole('textbox', { name: '笔记正文' }).fill('A 页新正文'); await a.keyboard.press('Control+s')
  await until(() => app.ctx.notes.list()[0]?.content === 'A 页新正文', 'A 保存')
  await b.getByRole('textbox', { name: '笔记标题', exact: true }).fill('B 页草稿'); await b.keyboard.press('Control+s')
  await b.getByRole('button', { name: '另存为副本', exact: true }).waitFor()
  await b.reload()
  await b.getByRole('button', { name: '另存为副本', exact: true }).waitFor()
  assert.equal(await b.getByRole('textbox', { name: '笔记正文' }).inputValue(), '原正文')
  await b.getByRole('button', { name: '另存为副本', exact: true }).click()
  await until(() => app.ctx.notes.list().length === 2, '副本保存')
  assert.ok(app.ctx.notes.list().some(n => n.title === '两页冲突' && n.content === 'A 页新正文'))
  assert.ok(app.ctx.notes.list().some(n => n.title === 'B 页草稿（副本）' && n.content === '原正文'))
  assert.deepEqual(errors, [])
})

test('产品浏览器：块页面图片上传、HTML 粘贴和撤销后保存刷新', { skip: !enabled, timeout: 60000 }, async t => {
  const { page, app, errors } = await fixture(t)
  await create(page, '块页面', '图片粘贴回归')
  const editor = page.locator('.block-editor [contenteditable=true]')
  await editor.click(); await page.keyboard.insertText('图片父块')
  // Exercise a real browser ClipboardEvent with a local image payload.
  await editor.evaluate(element => {
    const clipboard = new DataTransfer(), bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII='), c => c.charCodeAt(0))
    clipboard.items.add(new File([bytes], 'pixel.png', { type: 'image/png' }))
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }))
  })
  const image = editor.locator('img'); await image.waitFor()
  const source = await image.getAttribute('src')
  assert.match(source, /^\/api\/note-assets\//)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await editor.press('Control+a'); await editor.press('Control+c')
  await editor.locator('p').first().click(); await page.keyboard.press('End'); await page.keyboard.insertText('粘贴位置'); await page.keyboard.press('Control+v')
  await until(async () => await editor.locator('img').count() === 2, 'HTML 图片粘贴')
  await page.keyboard.press('Control+z'); await until(async () => await editor.locator('img').count() === 1, '撤销')
  await page.keyboard.press('Control+Shift+z'); await until(async () => await editor.locator('img').count() === 2, '重做')
  await page.keyboard.press('Control+s')
  await until(() => (JSON.stringify(app.ctx.notes.list()[0]?.document).match(/"kind":"image"/g) || []).length === 2, '图片落盘')
  await page.reload(); await page.locator('.block-editor [contenteditable=true] img').first().waitFor()
  assert.equal(await page.locator('.block-editor [contenteditable=true] img').count(), 2)
  assert.deepEqual(errors, [])
})

test('产品浏览器：笔记开发模式热更新保存草稿，插件停用/启用后数据仍可编辑', { skip: !enabled, timeout: 90000 }, async t => {
  // Copy sources only into an isolated fixture; never edit the user's active checkout.
  const dir = await mkdtemp(resolve('product-dev-test-')), apps = join(dir, 'applications')
  let dev, browser
  const cacheDir = resolve('node_modules/.vite', basename(dir))
  t.after(async () => { await browser?.close(); await dev?.close(); await rm(dir, { recursive: true, force: true }); await rm(cacheDir, { recursive: true, force: true }) })
  await mkdir(apps)
  await cp(resolve('applications/notebook'), join(apps, 'notebook'), { recursive: true, filter: path => !path.split(/[\\/]/).some(part => ['node_modules', 'dist'].includes(part)) })
  for (const plugin of await readdir(join(apps, 'notebook/plugins'))) {
    const dependencies = resolve('applications/notebook/plugins', plugin, 'node_modules')
    if (await stat(dependencies).then(() => true, () => false)) await symlink(dependencies, join(apps, 'notebook/plugins', plugin, 'node_modules'), 'junction')
  }
  dev = await startDevelopment({ port: 0, applicationsDir: apps, initialApplication: 'notebook', dataDir: join(dir, 'data'), cacheDir })
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') t.diagnostic(message.text().slice(0,1500)) })
  page.on('requestfailed', request => t.diagnostic(request.url() + ': ' + request.failure()?.errorText))
  const url = 'http://127.0.0.1:' + dev.vite.httpServer.address().port
  await page.goto(url); await create(page, '普通笔记', '热更新回归')
  await page.getByRole('textbox', { name: '笔记正文' }).fill('热更新前未保存的内容')
  const source = join(apps, 'notebook/plugins/editor/view.jsx')
  await writeFile(source, (await readFile(source, 'utf8')).replace('写下此刻的想法…', '热更新已生效'))
  await page.getByPlaceholder('热更新已生效').waitFor({ timeout: 30000 })
  assert.equal(await page.getByRole('textbox', { name: '笔记正文' }).inputValue(), '热更新前未保存的内容')
  const state = await (await fetch(url + '/api/plugins')).json()
  async function toggle(enabled) {
    const response = await fetch(url + '/api/plugins/editor/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Application-Session': state.application.session }, body: JSON.stringify({ enabled }) })
    assert.equal(response.ok, true)
  }
  await toggle(false); await page.getByRole('textbox', { name: '笔记正文' }).waitFor({ state: 'detached' })
  await toggle(true); await page.getByRole('textbox', { name: '笔记正文' }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '笔记正文' }).inputValue(), '热更新前未保存的内容')
  assert.deepEqual(errors, [])
})
