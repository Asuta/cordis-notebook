import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { until, command } from './fixture.js'
import { selectCases } from './cases.js'

// These fixed checks run outside the Agent's project and survive all repair turns.
export async function acceptPlugin({ project, directory, task, signal }) {
  await mkdir(directory, { recursive: true })
  const startedAt = Date.now()
  const result = await command([fileURLToPath(import.meta.url), '--worker', project, directory, task.id], { root: project, signal, timeout: 120000 })
  if (result.exitCode !== 0) return { startedAt, endedAt: Date.now(), status: 'infrastructure-error', error: result.timedOut ? '固定验收进程被中断或超时' : result.output, checks: task.checks.map(id => ({ id, status: 'blocked' })) }
  return JSON.parse(await readFile(join(directory, 'acceptance.json'), 'utf8'))
}
async function inspectPlugin({ project, directory, task, signal }) {
  const startedAt = Date.now(), checks = [], errors = []
  let host, browser, page, setupError, setupStage = 'plugin-runtime', blocked = false
  async function check(id, action) {
    if (blocked || signal?.aborted) { checks.push({ id, status: 'blocked' }); return }
    const startedAt = Date.now()
    try { await action(); checks.push({ id, status: 'passed', startedAt, endedAt: Date.now() }) }
    catch (error) { checks.push({ id, status: 'failed', error: error.message, startedAt, endedAt: Date.now() }); blocked = true }
  }
  const abort = () => { void browser?.close().catch(() => {}) }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    await mkdir(directory, { recursive: true })
    const { createHost } = await import(pathToFileURL(join(project, 'server/server.js')).href)
    host = await createHost({ port: 0, applicationsDir: join(project, 'applications'), initialApplication: task.appId, dataDir: join(directory, 'data') })
    const origin = `http://127.0.0.1:${host.server.address().port}`
    const request = async (path, body, method = 'POST') => {
      const state = await (await fetch(origin + '/api/plugins', { signal })).json()
      const response = await fetch(origin + path, body === undefined ? { signal } : { method, signal,
        headers: { 'Content-Type': 'application/json', 'X-Application-Session': state.application.session }, body: JSON.stringify(body) })
      const value = await response.json(); assert.ok(response.ok, path + ': ' + JSON.stringify(value)); return value
    }
    setupStage = 'browser-launch'
    browser = await chromium.launch({ headless: true })
    setupStage = 'plugin-runtime'
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] })
    page = await context.newPage(); page.setDefaultTimeout(8000)
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(origin)
    await page.locator('html[data-cordis-ready="true"]').waitFor()
    const toggle = enabled => request(`/api/plugins/${task.pluginId}/toggle`, { enabled })
    await toggle(true)
    async function create(label, title) {
      await page.getByRole('button', { name: '新建笔记', exact: true }).click()
      await page.getByRole('menuitem', { name: label, exact: true }).click()
      await until(async () => await page.locator('.note-card[aria-current=page]').count() === 1 &&
        (await page.locator('.note-card[aria-current=page]').innerText()).includes('无标题笔记') &&
        await page.getByRole('textbox', { name: '笔记标题', exact: true }).inputValue() === '', '新笔记完成选择')
      await page.getByRole('textbox', { name: '笔记标题', exact: true }).fill(title)
    }
    const notes = () => request('/api/notes')
    const clickNote = title => page.getByText(title, { exact: true }).click()
    const summary = () => request('/api/plugins/note-summary/summary')
    const count = page.getByTestId('paragraph-count'), copy = page.getByRole('menuitem', { name: '复制标题', exact: true }), editor = page.getByRole('textbox', { name: '便签正文', exact: true })
    const openActions = () => page.getByRole('button', { name: '更多笔记操作', exact: true }).click()
    const copyTitle = async () => { await openActions(); await copy.click(); return page.evaluate(() => navigator.clipboard.readText()) }
    const studio = () => request('/api/studio'), action = page.getByRole('button', { name: '创建便签', exact: true })
    if (task.id === 'content') {
      await check('empty-selection', async () => { await count.waitFor(); assert.equal(await count.innerText(), '未选择笔记') })
      await check('plain-live', async () => { await create('普通笔记', '评测普通笔记'); await page.getByRole('textbox', { name: '笔记正文', exact: true }).fill('第一行\n仍是第一段\n \n第二段'); await until(async () => await count.innerText() === '2 段', '普通笔记两段') })
      await check('empty-body', async () => { await page.getByRole('textbox', { name: '笔记正文', exact: true }).fill(' \n\n '); await until(async () => await count.innerText() === '0 段', '空正文') })
      await check('markdown-source', async () => { await create('Markdown 笔记', '评测 Markdown'); await page.getByRole('textbox', { name: 'Markdown 源码', exact: true }).fill('# 标题\n\n正文\n\n结尾'); await until(async () => await count.innerText() === '3 段', 'Markdown 源码三段') })
      await check('switch-note', async () => { await clickNote('评测普通笔记'); await until(async () => await count.innerText() === '0 段', '切回普通笔记') })
    } else if (task.id === 'action') {
      await check('empty-selection', async () => { await openActions(); await copy.waitFor(); assert.ok(await copy.isDisabled()); await page.keyboard.press('Escape') })
      await check('copy-current', async () => { await create('普通笔记', '复制目标一'); assert.equal(await copyTitle(), '复制目标一') })
      await check('success-feedback', () => page.getByText('标题已复制', { exact: true }).waitFor())
      await check('switch-note', async () => { await create('Markdown 笔记', '复制目标二'); assert.equal(await copyTitle(), '复制目标二'); await clickNote('复制目标一'); assert.equal(await copyTitle(), '复制目标一') })
    } else if (task.id === 'editor') {
      await check('create-format', async () => { await create('便签页面', '评测便签'); await editor.waitFor() })
      await check('autosave', async () => { await editor.fill('第一行\n第二行'); await until(async () => (await notes()).some(n => n.type === 'simple-page' && n.body === '第一行\n第二行'), 'body 自动保存') })
      await check('switch-note', async () => { await create('普通笔记', '切换用普通笔记'); await clickNote('评测便签'); assert.equal(await editor.inputValue(), '第一行\n第二行') })
      await check('reload', async () => { await page.reload(); await editor.waitFor(); assert.equal(await editor.inputValue(), '第一行\n第二行') })
      await check('empty-body', async () => { await editor.fill(''); await until(async () => (await notes()).some(n => n.type === 'simple-page' && n.body === ''), '空 body 保存'); await page.reload(); await editor.waitFor(); assert.equal(await editor.inputValue(), '') })
      // Select an unaffected format so stopping the editor exercises disposal without discarding a draft.
      if (!blocked) await clickNote('切换用普通笔记')
    } else if (task.id === 'canvas') {
      await check('add-card', async () => { await action.click(); await until(async () => (await studio()).boards[0].nodes.some(n => n.type === 'text' && n.title === '快速便签' && n.text === '从插件创建'), '新卡片持久化') })
      await check('second-card', async () => { await action.click(); await until(async () => (await studio()).boards[0].nodes.length === 2, '两个独立卡片') })
      await check('undo', async () => { await page.getByTitle('撤销 Ctrl+Z', { exact: true }).click(); await until(async () => (await studio()).boards[0].nodes.length === 1, '撤销第二张卡片') })
      await check('reload', async () => { await page.reload(); await action.waitFor(); assert.equal((await studio()).boards[0].nodes.length, 1) })
    } else if (task.id === 'backend') {
      let first, second
      await check('empty-data', async () => assert.deepEqual(await summary(), { total: 0, pinned: 0, byType: {} }))
      await check('mixed-types', async () => { first = await request('/api/notes', { type: 'plain' }); second = await request('/api/notes', { type: 'markdown' }); assert.deepEqual(await summary(), { total: 2, pinned: 0, byType: { plain: 1, markdown: 1 } }) })
      await check('pin-update', async () => { await request('/api/notes/' + first.id, { revision: first.revision, pinned: true }, 'PATCH'); assert.equal((await summary()).pinned, 1) })
      await check('delete-note', async () => { await request('/api/notes/' + second.id, { revision: second.revision }, 'DELETE'); assert.deepEqual(await summary(), { total: 1, pinned: 1, byType: { plain: 1 } }) })
      await check('read-only', async () => { const before = await notes(); await summary(); await summary(); assert.deepEqual(await notes(), before) })
    } else throw Error('没有固定验收实现：' + task.id)
    const target = task.id === 'content' ? count : task.id === 'action' ? copy : task.id === 'canvas' ? action : null
    await check('disable', async () => {
      await toggle(false)
      if (task.id === 'action') await openActions()
      if (target) await until(async () => await target.count() === 0, '停用后移除 UI')
      else if (task.id === 'backend') assert.equal((await fetch(origin + '/api/plugins/note-summary/summary', { signal })).status, 404)
      else { await page.getByRole('button', { name: '新建笔记', exact: true }).click(); assert.equal(await page.getByRole('menuitem', { name: '便签页面', exact: true }).count(), 0); await page.keyboard.press('Escape') }
      if (task.id === 'action') await page.keyboard.press('Escape')
    })
    await check('reenable-once', async () => {
      await toggle(true)
      if (task.id === 'action') await openActions()
      if (target) { await target.waitFor(); assert.equal(await target.count(), 1) }
      else if (task.id === 'backend') assert.deepEqual(await summary(), { total: 1, pinned: 1, byType: { plain: 1 } })
      else { await create('便签页面', '重新启用的便签'); await editor.waitFor(); assert.equal(await editor.count(), 1); await editor.fill('恢复后可编辑'); await until(async () => (await notes()).some(n => n.body === '恢复后可编辑'), '重新启用后保存') }
      if (task.id === 'action') await page.keyboard.press('Escape')
    })
    // Page errors are checked even after an earlier assertion failed.
    checks.push({ id: 'page-errors', status: errors.length ? 'failed' : 'passed', errors })
    await page.screenshot({ path: join(directory, 'page.png') }).catch(() => {})
  } catch (error) { setupError = error.message }
  finally { signal?.removeEventListener('abort', abort); await browser?.close().catch(() => {}); await host?.close().catch(() => {}) }
  for (const id of task.checks) if (!checks.some(check => check.id === id)) checks.push({ id, status: 'blocked' })
  return { startedAt, endedAt: Date.now(), status: setupError && setupStage === 'browser-launch' ? 'infrastructure-error' : !setupError && checks.every(c => c.status === 'passed') ? 'passed' : 'failed', checks, ...(setupError ? { error: setupError, setupStage } : {}) }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === '--worker') {
  try {
    const [, , , project, directory, id] = process.argv
    const result = await inspectPlugin({ project, directory, task: selectCases([id])[0] })
    await writeFile(join(directory, 'acceptance.json'), JSON.stringify(result, null, 2))
    process.exit(0)
  } catch (error) { console.error(error.message); process.exit(1) }
}
