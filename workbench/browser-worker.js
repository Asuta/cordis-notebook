import { chromium } from 'playwright'
import { startDevelopment } from '../scripts/dev.js'
import { join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rm } from 'node:fs/promises'
import { assertTarget } from './browser-assertions.js'

let browser, context, page, app, origin, cacheDir, boundAppId, closing = false, active = false
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
  if ([target.role, target.label, target.text, target.css, target.testId].filter(value => typeof value === 'string' && value).length !== 1) throw Error('请选择一种唯一定位方式')
  if (target.testId) return page.getByTestId(target.testId)
  if (target.role) return page.getByRole(target.role, { ...(target.name !== undefined ? { name: target.name, exact: true } : {}) })
  if (target.label) return page.getByLabel(target.label, { exact: true })
  if (target.text) return page.getByText(target.text, { exact: true })
  return page.locator(target.css)
}
async function snapshot(withImage = false, withStructure = true) {
  if (closing || !page) throw Error('浏览器验收已停止')
  return { url: page.url(), title: await page.title(),
    ...(withStructure ? { snapshot: (await page.locator('body').ariaSnapshot({ timeout: 5000 })).slice(0, 20000),
      targets: await page.locator('[data-testid]').evaluateAll(elements => elements.filter(element => {
        const rect = element.getBoundingClientRect(); return !!(rect.width && rect.height) && getComputedStyle(element).visibility !== 'hidden'
      }).slice(0, 80).map(element => ({ target: { testId: element.getAttribute('data-testid') }, text: (element.innerText || '').slice(0, 120) }))) } : {}),
    ...(withImage ? { image: { type: 'image', mimeType: 'image/jpeg', data: (await page.screenshot({ type: 'jpeg', quality: 75, timeout: 10000 })).toString('base64') } } : {}) }
}
async function open({ root, appId, directory, width = 1280, height = 900 }) {
  if (page) return snapshot(true)
  boundAppId = appId
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
  return { ...await snapshot(true), instance: { scope: 'verification', appId,
    note: '独立空数据实例；工作台的启用状态不共享。用 browser_plugin 按 ID 查询，enable:true 启用并核对双端运行状态。',
    pluginTool: { name: 'browser_plugin', arguments: { id: '<plugin-id>', enable: true } } } }
}
async function inspect(target) {
  const visible = await target.isVisible()
  // Fixed, read-only DOM projection. No caller-provided JavaScript or properties.
  return { ...await target.evaluate(element => {
    const style = getComputedStyle(element), rect = element.getBoundingClientRect()
    const styles = Object.fromEntries(['color', 'background-color', 'background-image', 'font-size', 'font-weight',
      'line-height', 'opacity', 'display', 'visibility'].map(key => [key, style.getPropertyValue(key)]))
    const backgrounds = []
    for (let ancestor = element.parentElement; ancestor && backgrounds.length < 6; ancestor = ancestor.parentElement) {
      const css = getComputedStyle(ancestor)
      backgrounds.push({ tag: ancestor.tagName.toLowerCase(), id: ancestor.id,
        color: css.backgroundColor, image: css.backgroundImage, opacity: css.opacity })
    }
    return { tag: element.tagName.toLowerCase(), text: (element.innerText || '').slice(0, 3000),
      value: /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName) ? element.value.slice(0, 3000) : null,
      placeholder: element.getAttribute('placeholder')?.slice(0, 3000) ?? null,
      checked: element.tagName === 'INPUT' && /^(checkbox|radio)$/.test(element.type) ? element.checked : null,
      disabled: 'disabled' in element ? element.disabled : null,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, styles, backgrounds }
  }), visible }
}
function checkPage() {
  if (!page || closing) throw Error('请先 browser_open')
  if (page.url().split('/').slice(0, 3).join('/') !== origin) throw Error('验收页面已离开测试实例')
}
async function plugin(input) {
  checkPage()
  // Import only the already-loaded host entry. The caller supplies no script,
  // URL, session or filesystem path; operations stay in this isolated page.
  const result = await page.evaluate(async args => {
    const entry = [...document.querySelectorAll('script[type="module"][src]')].find(script => new URL(script.src).pathname.endsWith('/client/host/runtime.js'))
    if (!entry) throw Error('验收实例的宿主入口未就绪')
    const host = await import(entry.src)
    return host.verificationPlugin(args)
  }, { ...input, appId: boundAppId })
  if (input.enable && (result.running !== true || result.operationError)) throw Object.assign(Error('验收插件启用未通过：' + (result.operationError || result.error || result.waitingFor?.join('、') || result.clientState)), { diagnostics: result })
  return { scope: 'verification', ...result }
}
async function action(input) {
  checkPage()
  if (input.action === 'snapshot' || input.action === 'screenshot') return snapshot(input.action === 'screenshot', input.action === 'snapshot')
  const result = { action: input.action, ok: true }
  if (input.action === 'scroll') { await page.mouse.wheel(0, input.direction === 'up' ? -600 : 600); return result }
  const target = locator(input.target)
  if (input.action === 'assert') { await assertTarget(input, target, checks); return result }
  let count = await target.count()
  if (!count) { await target.waitFor({ state: 'visible' }).catch(() => {}); count = await target.count() }
  if (count !== 1) {
    const candidates = await (count ? target : input.target.role ? page.getByRole(input.target.role)
      : page.locator('button,input,textarea,select,[role],[aria-label]')).evaluateAll(elements => elements.slice(0, 6).map(element => ({
        tag: element.tagName.toLowerCase(), id: element.id, role: element.getAttribute('role'),
        label: element.getAttribute('aria-label'), text: (element.innerText || '').slice(0, 160),
        placeholder: element.getAttribute('placeholder'), title: element.getAttribute('title'),
        visible: !!(element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden'),
      }))).catch(() => [])
    const diagnostics = { target: input.target, matchCount: count, candidates,
      snapshot: await page.locator('body').ariaSnapshot({ timeout: 3000 }).then(text => text.slice(0, 4000)).catch(() => ''),
      hint: count ? '从候选与页面结构选择唯一 role/name、label 或精确 css；不要直接选第一个。'
        : '核对页面结构中的实际名称；若界面尚未就绪先 snapshot，必要时检查前置操作。' }
    throw Object.assign(Error(`定位需要唯一元素，实际匹配 ${count} 个；目标：${JSON.stringify(input.target)}；${diagnostics.hint}`), { diagnostics })
  }
  switch (input.action) {
    case 'click': await target.click(); break
    case 'fill': await target.fill(input.value); break
    case 'press': await target.press(input.value); break
    case 'select': await target.selectOption(input.value); break
    case 'check': await target.setChecked(input.checked); break
    case 'inspect': result.element = await inspect(target); break
    default: throw Error('未知浏览器操作')
  }
  return result
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
        : message.method === 'finish' ? await finish() : message.method === 'plugin' ? await plugin(message.input) : await action(message.input)
      send({ id: message.id, result: { ...result, errors: [...errors], checks: [...checks] } })
    } catch (error) { send({ id: message.id, error: error.message, errorKind: error.kind || 'operation', diagnostics: error.diagnostics, errors: [...errors], checks: [...checks] }) }
    finally { active = false }
  })()
})
process.once('disconnect', () => { void close().finally(() => process.exit(0)) })
process.once('SIGTERM', () => { void close().finally(() => process.exit(0)) })
