import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { createWorkbench } from '../workbench/server.js'

test('工作台真实页面先接收 SSE 再加载历史仍按时间排序，逐页加载和更新偏好不丢失消息', {
  skip: process.env.CORDIS_BROWSER_TEST !== '1', timeout: 45000,
}, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-history-ui-'))
  let wb, browser
  t.after(async () => { await browser?.close(); await wb?.close(); await rm(dir, { recursive: true, force: true }) })
  const thread = { id: 'history', appId: 'notebook', title: '55轮历史', revision: 1, messages: [], turns: [] }
  for (let i = 0; i < 55; i++) {
    thread.messages.push({ id: 'm' + i, turnId: 't' + i, role: 'user', text: '第' + i + '条消息' })
    thread.turns.push({ id: 't' + i, status: 'done', startedAt: 1000 + i, endedAt: 1100 + i, events: [], finalAnswer: { text: '完成' } })
  }
  await writeFile(join(dir, 'conversations.json'), JSON.stringify([thread]))
  wb = await createWorkbench({ root: resolve('.'), dataDir: dir, port: 0, appPort: 0, autoStart: false })
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage(), errors = [], requests = []
  page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push(request.url()))
  const base = 'http://127.0.0.1:' + wb.server.address().port
  let release, requested
  const gate = new Promise(resolve => { release = resolve }), pending = new Promise(resolve => { requested = resolve })
  t.after(() => release())
  await page.route('**/api/threads/history?*', async route => { requested(); await gate; await route.continue() })
  const connected = page.waitForResponse(response => response.url().endsWith('/api/events'))
  await page.goto(base + '/chat')
  await connected
  await page.locator('#app-select').selectOption('notebook')
  await page.locator('#threads').selectOption('history')
  await pending
  // A real server event arrives while the first detail fetch is still pending.
  const preference = await fetch(base + '/api/thread-preferences', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ threadId: 'history', browserVerificationEnabled: false }) })
  assert.equal(preference.ok, true)
  await page.waitForFunction(() => document.querySelectorAll('.message.user').length === 1)
  assert.match(await page.locator('.message.user').first().innerText(), /第54条消息/)
  release()
  await page.waitForFunction(() => document.querySelectorAll('.message.user').length === 20)
  for (const [index, text] of (await page.locator('.message.user').allInnerTexts()).entries()) assert.ok(text.includes('第' + (35 + index) + '条消息'), text)
  const response = await fetch(base + '/api/threads/history?since=2')
  assert.deepEqual(await response.json(), { id: 'history', revision: 2, unchanged: true })
  await page.getByRole('button', { name: '加载更早的对话' }).click()
  await page.waitForFunction(() => document.querySelectorAll('.message.user').length === 40)
  await page.getByRole('button', { name: '加载更早的对话' }).click()
  await page.waitForFunction(() => document.querySelectorAll('.message.user').length === 55)
  assert.match(await page.locator('.message.user').first().innerText(), /第0条消息/)
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/thread-preferences') && response.ok()),
    page.getByRole('checkbox', { name: '浏览器验收' }).check()])
  assert.equal(await page.locator('.message.user').count(), 55)
  assert.equal(await page.getByRole('button', { name: '加载更早的对话' }).isVisible(), false)
  assert.ok(requests.some(url => url.endsWith('/api/state?summary=1')))
  assert.equal(requests.some(url => url.endsWith('/api/state')), false)
  assert.deepEqual(errors, [])
})
