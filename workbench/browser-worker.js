import { chromium } from 'playwright'
import { startDevelopment } from '../scripts/dev.js'
import { join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rm } from 'node:fs/promises'

let browser, context, page, app, origin, cacheDir, closing = false, active = false
const cacheRoot = fileURLToPath(new URL('../node_modules/.vite/', import.meta.url))
const errors = [], checks = []
const send = message => { if (process.connected) process.send(message, () => {}) }
const recordError = message => { errors.push(String(message).slice(0, 2000)); if (errors.length > 30) errors.shift() }
async function close() {
  if (closing) return
  closing = true
  await browser?.close().catch(() => {})
  await app?.close().catch(() => {})
  if (cacheDir?.startsWith(join(cacheRoot, 'cordis-browser-'))) await rm(cacheDir, { recursive: true, force: true }).catch(() => {})
}
const locator = target => {
  if (!target) return page.locator('body')
  if ([target.role, target.label, target.text, target.css].filter(value => typeof value === 'string' && value).length !== 1) throw Error('请选择一种唯一定位方式')
  if (target.role) return page.getByRole(target.role, { ...(target.name !== undefined ? { name: target.name, exact: true } : {}) })
  if (target.label) return page.getByLabel(target.label, { exact: true })
  if (target.text) return page.getByText(target.text, { exact: true })
  return page.locator(target.css)
}
async function snapshot(withImage = false) {
  if (closing || !page) throw Error('浏览器验收已停止')
  return { url: page.url(), title: await page.title(), snapshot: (await page.locator('body').ariaSnapshot({ timeout: 5000 })).slice(0, 20000),
    errors: [...errors], checks: [...checks], ...(withImage ? { image: { type: 'image', mimeType: 'image/jpeg', data: (await page.screenshot({ type: 'jpeg', quality: 75, timeout: 10000 })).toString('base64') } } : {}) }
}
async function open({ root, appId, directory, width = 1280, height = 900 }) {
  if (page) return snapshot(true)
  browser = await chromium.launch({ headless: true, timeout: 20000 }).catch(error => {
    throw Error(`浏览器启动失败；首次使用请运行 pnpm browser:install。${error.message.slice(0, 1200)}`)
  })
  if (closing) throw Error('浏览器验收已停止')
  cacheDir = join(cacheRoot, 'cordis-browser-' + basename(directory))
  app = await startDevelopment({ port: 0, dataDir: join(directory, 'data'), initialApplication: appId,
    applicationsDir: join(root, 'applications'), cacheDir, dependencyFiles: [],
    onEvent: event => { if (event.type === 'error') recordError(event.message) },
  })
  if (closing) throw Error('浏览器验收已停止')
  origin = `http://127.0.0.1:${app.vite.httpServer.address().port}`
  context = await browser.newContext({ viewport: { width, height }, acceptDownloads: false, serviceWorkers: 'block' })
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.origin === origin ? route.continue() : route.abort('blockedbyclient')
  })
  await context.routeWebSocket('**/*', socket => {
    if (new URL(socket.url()).host === new URL(origin).host) socket.connectToServer()
    else socket.close()
  })
  context.on('page', extra => { if (page && extra !== page) void extra.close() })
  page = await context.newPage()
  page.setDefaultTimeout(7000)
  page.on('pageerror', error => recordError(error.message))
  page.on('console', message => { if (message.type() === 'error') recordError(message.text()) })
  page.on('response', response => { if (response.status() >= 400 && new URL(response.url()).pathname !== '/favicon.ico') recordError(`${response.status()} ${response.url()}`) })
  page.on('dialog', dialog => { recordError(`页面弹窗已取消：${dialog.message()}`); void dialog.dismiss() })
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 20000 })
  // Vite's first dependency optimization can invalidate its initial module graph.
  // Retry navigation once, preserving any captured errors in the report.
  try { await page.locator('html[data-cordis-ready="true"]').waitFor({ timeout: 10000 }) }
  catch { await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('html[data-cordis-ready="true"]').waitFor({ timeout: 15000 }) }
  return snapshot(true)
}
async function action(input) {
  if (!page || closing) throw Error('请先 browser_open')
  if (page.url().split('/').slice(0, 3).join('/') !== origin) throw Error('验收页面已离开测试实例')
  if (input.action === 'snapshot' || input.action === 'screenshot') return snapshot(input.action === 'screenshot')
  if (input.action === 'scroll') { await page.mouse.wheel(0, input.direction === 'up' ? -600 : 600); return snapshot() }
  if (!input.target) throw Error('此操作需要 target')
  const target = locator(input.target)
  if (await target.count() !== 1) throw Error('定位必须唯一，请先读取页面结构再操作')
  if (['fill', 'press', 'select'].includes(input.action) && typeof input.value !== 'string') throw Error('此操作需要 value')
  switch (input.action) {
    case 'click': await target.click(); break
    case 'fill': await target.fill(input.value); break
    case 'press': await target.press(input.value); break
    case 'select': await target.selectOption(input.value); break
    case 'check': if (typeof input.checked !== 'boolean') throw Error('需要 checked'); await target.setChecked(input.checked); break
    case 'assert': {
      if (typeof input.expected !== 'string' || !input.expected.trim()) throw Error('断言需要非空 expected')
      await target.waitFor({ state: 'visible' })
      const actual = await target.innerText(), ok = actual.includes(input.expected)
      checks.push({ label: input.label || input.expected, expected: input.expected, actual: actual.slice(0, 3000), passed: ok })
      if (!ok) throw Error(`页面断言失败：${input.label || input.expected}；实际文本：${actual.slice(0, 500)}`)
      break
    }
    default: throw Error('未知浏览器操作')
  }
  return snapshot()
}
async function finish() {
  if (!page || closing) throw Error('浏览器验收已停止')
  // Stop page activity before taking the final diagnostic snapshot, so errors
  // arriving after the last action (including during close) are not lost.
  await browser.close()
  return { errors: [...errors], checks: [...checks] }
}
process.on('message', message => {
  if (message.type === 'close') { void close().finally(() => process.exit(0)); return }
  if (message.type !== 'call') return
  if (active || closing) { send({ id: message.id, error: '浏览器正在操作或已停止' }); return }
  active = true
  void (async () => {
    try {
      const result = message.method === 'open' ? await open(message.input)
        : message.method === 'finish' ? await finish() : await action(message.input)
      send({ id: message.id, result })
    } catch (error) { send({ id: message.id, error: error.message, errors: [...errors], checks: [...checks] }) }
    finally { active = false }
  })()
})
process.once('disconnect', () => { void close().finally(() => process.exit(0)) })
process.once('SIGTERM', () => { void close().finally(() => process.exit(0)) })
