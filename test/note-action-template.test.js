import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, cp, readdir, lstat, symlink, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { applicationScaffold } from '../workbench/development-assets.js'
import { developmentInfo, scaffoldPlugin } from '../workbench/development-tools.js'
import { loadBrowserScenario } from '../workbench/browser-scenarios.js'
import { BrowserVerification } from '../workbench/browser-verification.js'
import { buildPlugins } from '../scripts/plugin-builder.js'
import { assertTarget } from '../workbench/browser-assertions.js'
import { chromium } from 'playwright'
import { Context, Service } from 'cordis'
import { createNotebook } from '../applications/notebook/plugins/notebook/model.js'
import { Notes } from '../applications/notebook/plugins/notes/server.js'
import { noteFormats } from '../applications/notebook/plugins/note-formats/server.js'
import { formatPlain } from '../applications/notebook/plugins/format-plain/server.js'

test('操作路径保留完整资料并返回参数化骨架和公共生命周期场景', async () => {
  const info = await developmentInfo(resolve('.'), 'notebook', { task: 'note-action' })
  assert.equal(info.recommendedScaffold.arguments.template, 'note-action')
  assert.equal(info.recommendedScaffold.parameters.mode.default, 'read')
  assert.ok(info.examples.some(e => e.path.endsWith(join('pin', 'client.js'))))
  assert.ok(info.contracts.some(e => e.path.endsWith(join('notebook', 'types', 'client.d.ts'))))
  const scenario = await loadBrowserScenario(resolve('.'), 'notebook', 'note-action-lifecycle', { pluginId: 'test-action', actionLabel: '操作 "引号"' })
  assert.ok(scenario.steps.some(s => s.target?.name === '操作 "引号"' && s.assertion === 'disabled'))
  assert.ok(scenario.steps.some(s => s.target?.testId === 'plugin-toggle-test-action'))
  assert.ok(!scenario.steps.some(s => s.action === 'click' && s.target?.name === '操作 "引号"'), '公共场景不能执行未知业务效果')
  await assert.rejects(applicationScaffold(resolve('applications/notebook'), 'development/note-action/template.json', { id: 'xx', name: 'x', parameters: { mode: 'other' } }, 'notebook'), /参数无效/)
})

async function runtimeFixture(t, mode = 'edit', options = {}) {
  const root = await mkdtemp(resolve('work/action-unit-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const files = await applicationScaffold(resolve('applications/notebook'), 'development/note-action/template.json', { id: 'test-action', name: '操作', parameters: { mode } }, 'notebook')
  files['action.js'] = `export const label='测试操作', mode=${JSON.stringify(mode)};
    export const starts=[]; export let finish;
    export const supports=note=>note.type==='plain';
    export async function run({note,update,notify}){starts.push(note.id);await new Promise(resolve=>finish=resolve);${options.run || "await update({title:'完成'});notify('已完成')"}}`
  for (const [file, content] of Object.entries(files)) { await mkdir(dirname(join(root, file)), { recursive: true }); await writeFile(join(root, file), content) }
  const action = await import(pathToFileURL(join(root, 'action.js')).href)
  const { default: apply } = await import(pathToFileURL(join(root, 'client.js')).href)
  let selected, render, click
  const disposers = [], edits = [], messages = [], button = { dataset: {}, setAttribute() {} }
  const model = options.model || { busy: false, editable: true, current: () => selected, edit: patch => { edits.push(patch); selected = { ...selected, ...patch } }, flush: async () => {},
    observe: (ctx, fn) => { render = fn; fn() } }
  const sdk = { button: (slot, label, handler) => { click = handler; return button }, toast: value => messages.push(value) }
  if (options.owner) await options.owner.plugin({ inject: ['notebook'], apply: ctx => apply(ctx, sdk) })
  else apply({ notebook: model, effect: fn => disposers.push(fn()) }, sdk)
  return { action, model, edits, messages, button, click: () => click(), dispose: () => disposers.forEach(fn => fn()), select: note => { selected = note; render() }, render: () => render() }
}

test('操作骨架遵守选择/格式/忙碌/可编辑状态并防止异步重复点击', async t => {
  const f = await runtimeFixture(t)
  assert.equal(f.button.disabled, true)
  f.select({ id: 'one', type: 'markdown' }); assert.equal(f.button.disabled, true)
  f.select({ id: 'one', type: 'plain' }); assert.equal(f.button.disabled, false)
  f.model.busy = true; f.render(); assert.equal(f.button.disabled, true); await f.click(); assert.equal(f.action.starts.length, 0)
  f.model.busy = false; f.model.editable = false; f.render(); assert.equal(f.button.disabled, true)
  f.model.editable = true; f.render()
  const pending = f.click(); await f.click(); assert.equal(f.action.starts.length, 1); assert.equal(f.button.disabled, true)
  f.action.finish(); await pending
  assert.deepEqual(f.edits, [{ title: '完成' }]); assert.deepEqual(f.messages, ['已完成']); assert.equal(f.button.disabled, false)
})

test('操作骨架拒绝跨选择、不可编辑、已停用或只读动作的异步写入', async t => {
  for (const change of ['selection', 'editable', 'disposed', 'read']) {
    const f = await runtimeFixture(t, change === 'read' ? 'read' : 'edit')
    f.select({ id: 'one', type: 'plain' })
    const pending = f.click()
    if (change === 'selection') f.select({ id: 'two', type: 'plain' })
    if (change === 'editable') f.model.editable = false
    if (change === 'disposed') f.dispose()
    f.action.finish(); await pending
    assert.deepEqual(f.edits, [], change)
    if (change === 'disposed') assert.deepEqual(f.messages, [])
    else assert.match(f.messages[0], /状态已变化/)
  }
})

async function notebookFixture(t) {
  const root = new Context()
  t.after(() => root.fiber.dispose())
  await root.plugin(ctx => { Object.assign(new Service(ctx, 'storage'), { read: async () => [], write: async () => {} }) })
  await root.plugin(noteFormats); await root.plugin(formatPlain)
  const notes = new Notes(root); await notes.load()
  const first = await notes.create()
  await notes.update(first.id, { title: '原标题', content: '原正文' })
  await root.plugin(ctx => { new Service(ctx, 'notesApi').request = async (path, method, data) => {
    if (!method) return notes.list()
    if (method === 'PATCH') { const { revision, ...fields } = data; return notes.update(path.slice(1), fields, revision) }
    throw Error('未实现的测试接口')
  } })
  let model
  await root.plugin({ inject: ['notesApi', 'noteFormats'], async apply(ctx) {
    model = await createNotebook(ctx, {
      provide(name, value) { const service = new Service(ctx, name); Object.defineProperties(service, Object.getOwnPropertyDescriptors(value)); return service },
      toast: message => assert.fail(message),
    }, { storage: { getItem: () => null, setItem() {}, removeItem() {} }, draftKey: 'test', autosaveMs: 60000 })
  } })
  return { model, notes, owner: root }
}

test('操作骨架拒绝覆盖同篇笔记的新草稿和已保存编辑', async t => {
  for (const saved of [false, true]) {
    const notebook = await notebookFixture(t)
    const f = await runtimeFixture(t, 'edit', { ...notebook, run: "await update({content:note.content+' 插件结果'});notify('已完成')" })
    const pending = f.click()
    notebook.model.edit({ content: '用户继续输入' })
    if (saved) await notebook.model.flush()
    f.action.finish(); await pending
    assert.equal(notebook.model.current().content, '用户继续输入')
    assert.equal(notebook.model.dirty, !saved)
    assert.equal(notebook.notes.list()[0].content, saved ? '用户继续输入' : '原正文')
    assert.match(f.messages[0], /笔记内容已变化/)
    assert.ok(!f.messages.includes('已完成'))
  }
})

test('仅保存原有草稿不误判为新编辑，顺序 update 可正常完成', async t => {
  const notebook = await notebookFixture(t)
  notebook.model.edit({ content: '点击前的草稿' })
  const f = await runtimeFixture(t, 'edit', { ...notebook,
    run: "await update({content:note.content+' 插件结果'});await update({title:'完成'});notify('已完成')" })
  const revision = notebook.model.current().revision, pending = f.click()
  await notebook.model.flush()
  assert.ok(notebook.model.current().revision > revision)
  f.action.finish(); await pending
  assert.equal(notebook.notes.list()[0].content, '点击前的草稿 插件结果')
  assert.equal(notebook.notes.list()[0].title, '完成')
  assert.deepEqual(f.messages, ['已完成'])
})

test('第一次 update 保存期间的新编辑仍阻止后续旧结果写入', async t => {
  const notebook = await notebookFixture(t)
  const f = await runtimeFixture(t, 'edit', { ...notebook,
    run: "await update({title:'第一步'});await update({content:note.content+' 第二步'});notify('已完成')" })
  let release, entered, once = true
  const gate = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  await notebook.owner.plugin(ctx => { ctx.on('notebook/before-save', async () => { if (once) { once = false; entered(); await gate } }) })
  const pending = f.click()
  f.action.finish(); await started
  notebook.model.edit({ content: '保存期间的新编辑' })
  release(); await pending
  assert.equal(notebook.notes.list()[0].content, '保存期间的新编辑')
  assert.match(f.messages[0], /笔记内容已变化/)
})

test('disabled 断言支持原生和菜单控件，缺失或隐藏不能冒充可用', { skip: process.env.CORDIS_BROWSER_TEST !== '1' }, async t => {
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close())
  const page = await browser.newPage()
  await page.setContent('<fieldset disabled><button id="native">原生</button></fieldset><div role="menuitem" aria-disabled="true">操作</div><button id="hidden" hidden>隐藏</button><span>文字</span>')
  const check = (target, expected) => assertTarget({ assertion: 'disabled', expected, timeoutMs: 0 }, target, [])
  await check(page.locator('#native'), true)
  await check(page.getByRole('menuitem'), true)
  await page.getByRole('menuitem').evaluate(node => node.setAttribute('aria-disabled', 'false'))
  await check(page.getByRole('menuitem'), false)
  await page.getByRole('menuitem').evaluate(node => { const parent = document.createElement('div'); parent.setAttribute('aria-disabled', 'true'); node.replaceWith(parent); parent.append(node) })
  await check(page.getByRole('menuitem'), false)
  await assert.rejects(check(page.locator('#missing'), false), /页面断言失败/)
  await assert.rejects(check(page.locator('#hidden'), false), /页面断言失败/)
  await assert.rejects(check(page.locator('span'), false), /调用参数错误/)
})

test('操作模板的读/写模式构建并通过真实公共场景，再独立验证业务效果', { skip: process.env.CORDIS_BROWSER_TEST !== '1', timeout: 120000 }, async t => {
  const root = await mkdtemp(resolve('action-template-test-')), app = join(root, 'applications/notebook')
  let v
  t.after(async () => { if (v?.report?.status === 'failed') t.diagnostic(JSON.stringify(v.report.errors)); await v?.close(); assert.ok(root.startsWith(resolve('action-template-test-'))); await rm(root, { recursive: true, force: true }) })
  await cp(resolve('applications/notebook'), app, { recursive: true, filter: path => !/[\\/](?:node_modules|dist)(?:[\\/]|$)/.test(path) })
  for (const folder of await readdir(join(app, 'plugins'))) {
    const modules = resolve('applications/notebook/plugins', folder, 'node_modules')
    if (await lstat(modules).catch(() => null)) await symlink(modules, join(app, 'plugins', folder, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  }
  for (const mode of ['read', 'edit']) {
    await scaffoldPlugin(root, 'notebook', { id: 'fixture-' + mode, name: '测试操作', template: 'note-action', parameters: { actionLabel: '测试操作', mode } })
    const code = `export const label='测试操作',mode=${JSON.stringify(mode)};export const supports=()=>true;
      export async function run({note,update,notify}){${mode === 'edit' ? "await update({title:note.title+' 已处理'});" : ''}notify('业务已执行：'+note.title)}`
    await writeFile(join(app, 'plugins', 'fixture-' + mode, 'action.js'), code)
  }
  await buildPlugins(join(app, 'plugins'))
  for (const mode of ['read', 'edit']) {
    v = new BrowserVerification({ root, appId: 'notebook', dataDir: join(root, 'reports') })
    await v.run('browser_open'); await v.run('browser_plugin', { id: 'fixture-' + mode, enable: true })
    const checked = await v.run('browser_scenario', { id: 'note-action-lifecycle', parameters: { pluginId: 'fixture-' + mode, actionLabel: '测试操作' } })
    assert.equal(checked.ok, true, JSON.stringify(checked.failure))
    const title = (await v.run('browser_action', { action: 'inspect', target: { role: 'textbox', name: '笔记标题' } })).element.value
    await v.run('browser_action', { action: 'click', target: { role: 'button', name: '更多笔记操作' } })
    await v.run('browser_action', { action: 'click', target: { role: 'menuitem', name: '测试操作' } })
    await v.run('browser_action', { action: 'assert', target: { text: '业务已执行：' + title }, expected: '业务已执行：' + title })
    if (mode === 'edit') {
      await v.run('browser_action', { action: 'reload' })
      await v.run('browser_action', { action: 'assert', target: { role: 'textbox', name: '笔记标题' }, assertion: 'value', expected: title + ' 已处理' })
    }
    assert.equal((await v.run('browser_finish', { result: 'passed', summary: '公共生命周期及独立业务效果' })).status, 'passed')
    await v.close(); v = null
  }
})
