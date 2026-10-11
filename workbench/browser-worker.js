import { chromium } from 'playwright'
import { startDevelopment } from '../scripts/dev.js'
import { join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rm } from 'node:fs/promises'
import { usageError } from './browser-contract.js'

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
async function snapshot(withImage = false, withStructure = true) {
  if (closing || !page) throw Error('浏览器验收已停止')
  return { url: page.url(), title: await page.title(),
    ...(withStructure ? { snapshot: (await page.locator('body').ariaSnapshot({ timeout: 5000 })).slice(0, 20000) } : {}),
    ...(withImage ? { image: { type: 'image', mimeType: 'image/jpeg', data: (await page.screenshot({ type: 'jpeg', quality: 75, timeout: 10000 })).toString('base64') } } : {}) }
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
async function assertTarget(input, target, count) {
  const assertion = input.assertion || 'text'
  if (['value', 'placeholder'].includes(assertion) && count === 1) {
    const supported = await target.evaluate((element, kind) => kind === 'value'
      ? /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName) : /^(INPUT|TEXTAREA)$/.test(element.tagName), assertion)
    if (!supported) throw usageError(`${assertion} 断言需要对应的输入控件；普通文字请用 text`)
  }
  const check = { assertion, target: input.target, label: input.label || `${assertion}: ${input.expected}`, expected: input.expected, passed: false }
  try {
    let actual
    if (assertion === 'visible') actual = count === 1 && await target.isVisible()
    else {
      await target.waitFor({ state: 'visible' })
      actual = assertion === 'value' ? await target.inputValue()
        : assertion === 'placeholder' ? await target.getAttribute('placeholder') : await target.innerText()
    }
    check.actual = typeof actual === 'string' ? actual.slice(0, 3000) : actual
    check.passed = assertion === 'text' ? actual.includes(input.expected) : actual === input.expected
    if (!check.passed) throw Error(`页面断言失败：${check.label}；实际：${JSON.stringify(check.actual)}`)
  } catch (error) {
    check.error = error.message
    throw Object.assign(error, { kind: 'assertion' })
  } finally { checks.push(check) }
}
async function action(input) {
  if (!page || closing) throw Error('请先 browser_open')
  if (page.url().split('/').slice(0, 3).join('/') !== origin) throw Error('验收页面已离开测试实例')
  if (input.action === 'snapshot' || input.action === 'screenshot') return snapshot(input.action === 'screenshot', input.action === 'snapshot')
  const result = { action: input.action, ok: true }
  if (input.action === 'scroll') { await page.mouse.wheel(0, input.direction === 'up' ? -600 : 600); return result }
  const target = locator(input.target), count = await target.count()
  // A missing element satisfies "not visible". Other missing/ambiguous targets
  // remain failures, since they may indicate a real application regression.
  if (count !== 1 && !(count === 0 && input.action === 'assert' && input.assertion === 'visible' && input.expected === false)) {
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
    case 'assert': await assertTarget(input, target, count); break
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
        : message.method === 'finish' ? await finish() : await action(message.input)
      send({ id: message.id, result: { ...result, errors: [...errors], checks: [...checks] } })
    } catch (error) { send({ id: message.id, error: error.message, errorKind: error.kind || 'operation', diagnostics: error.diagnostics, errors: [...errors], checks: [...checks] }) }
    finally { active = false }
  })()
})
process.once('disconnect', () => { void close().finally(() => process.exit(0)) })
process.once('SIGTERM', () => { void close().finally(() => process.exit(0)) })
