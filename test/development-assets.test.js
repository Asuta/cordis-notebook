import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, cp, rm, readdir, lstat, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { developmentParameters, renderDevelopmentAsset, applicationScaffold } from '../workbench/development-assets.js'
import { developmentInfo, scaffoldPlugin } from '../workbench/development-tools.js'
import { loadBrowserScenario } from '../workbench/browser-scenarios.js'
import { BrowserVerification } from '../workbench/browser-verification.js'
import { buildPlugins } from '../scripts/plugin-builder.js'
import { assertTarget } from '../workbench/browser-assertions.js'

test('应用模板参数转义、保留字段、未知参数与输出路径边界', async t => {
  const app = resolve('applications/notebook')
  const args = { id: 'test-page', name: '名称 "引号"\n换行', parameters: { editorLabel: '正文 "标签"', field: 'body' } }
  const files = await applicationScaffold(app, 'development/note-editor/template.json', args, 'notebook')
  assert.equal(JSON.parse(files['package.json']).cordis.name, args.name)
  assert.equal(JSON.parse(files['package.json']).cordis.defaultEnabled, false)
  assert.match(files['client.js'], /editorHost.register/)
  assert.ok(files['test/format.test.js'])
  for (const field of ['id', 'type', 'title', 'constructor', '__proto__'])
    await assert.rejects(applicationScaffold(app, 'development/note-editor/template.json', { ...args, parameters: { field } }, 'notebook'), /参数无效/)
  assert.throws(() => developmentParameters({}, { surprise: 'x' }), /未知/)
  assert.throws(() => developmentParameters({ name: {} }, {}, { name: 'x' }), /名称无效/)
  assert.throws(() => renderDevelopmentAsset('{{name}}', { name: 'x";bad()' }), /原样插入/)
  const temp = await mkdtemp(resolve('asset-test-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  for (const target of ['../escape.js', 'folder/../../escape.js', '/absolute.js']) {
    await writeFile(join(temp, 'template.json'), JSON.stringify({ files: { [target]: 'template.json' } }))
    await assert.rejects(applicationScaffold(temp, 'template.json', { id: 'xx', name: 'x' }, 'sample'), /输出路径无效/)
  }
  await writeFile(join(temp, 'template.json'), JSON.stringify({ files: { 'package.json': '../outside.json' } }))
  await assert.rejects(applicationScaffold(temp, 'template.json', { id: 'xx', name: 'x' }, 'sample'), /非法文件路径/)
})

test('完整编辑器资料指向可执行骨架和公共场景，场景只接受应用声明的参数', async () => {
  const info = await developmentInfo(resolve('.'), 'notebook', { task: 'note-editor' })
  assert.equal(info.recommendedScaffold.arguments.template, 'note-editor')
  assert.equal(info.recommendedScaffold.parameters.field.default, 'body')
  assert.ok(info.examples.length >= 7, '原完整资料保留')
  assert.ok(info.browserScenarios[0].parameters.editorLabel)
  const scenario = await loadBrowserScenario(resolve('.'), 'notebook', 'note-editor-lifecycle', { pluginId: 'test-page', formatName: '便签 "页面"', editorLabel: '正文' })
  assert.ok(scenario.steps.some(step => step.target?.testId === 'plugin-toggle-test-page'))
  assert.ok(scenario.steps.some(step => step.target?.name === '便签 "页面"'))
  assert.ok(scenario.steps.some(step => step.action === 'reload'))
  assert.ok(scenario.coverage.includes('清空后刷新'))
  assert.equal(scenario.metadata.scenarioHash.length, 64)
  await assert.rejects(loadBrowserScenario(resolve('.'), 'studio', 'note-editor-lifecycle', {}), /没有此/)
  await assert.rejects(loadBrowserScenario(resolve('.'), 'notebook', 'note-editor-lifecycle', {}), /参数无效/)
})

test('文字已匹配但容器无尺寸时明确报告可见性条件，不把实际文字当失败原因', async () => {
  const checks = [], target = { evaluateAll: async () => ({ count: 1, visible: false, supported: true, actual: '快速便签', rect: { width: 0, height: 0 }, display: 'block', visibility: 'visible' }) }
  await assert.rejects(assertTarget({ target: { css: '.cards' }, expected: '快速便签', timeoutMs: 0 }, target, checks), error => {
    assert.equal(error.kind, 'assertion'); assert.equal(error.diagnostics.failedCondition, 'visibility')
    assert.deepEqual(error.diagnostics.rect, { width: 0, height: 0 }); assert.match(error.message, /可见=false/)
    return true
  })
  assert.equal(checks.length, 1); assert.equal(checks[0].passed, false)
})

test('应用公共场景沿用逐步失败留证，后续步骤不执行', async t => {
  const root = await mkdtemp(resolve('scenario-test-')), app = join(root, 'applications/sample')
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(app, { recursive: true })
  await writeFile(join(app, 'development.json'), JSON.stringify({ verification: { example: { file: 'scenario.json' } } }))
  await writeFile(join(app, 'scenario.json'), JSON.stringify({ steps: [
    { action: 'assert', target: { css: '#bad' }, expected: '成功' }, { action: 'click', target: { css: '#must-not-run' } },
  ] }))
  const v = new BrowserVerification({ root, appId: 'sample', dataDir: root })
  t.after(() => { v.child = null; return v.close() })
  let calls = 0
  v.child = { connected: true }; v.start = async () => {}
  v.rpc = async () => { calls++; throw Object.assign(Error('断言未通过'), { kind: 'assertion', diagnostics: { snapshot: '失败现场' } }) }
  const result = await v.run('browser_scenario', { id: 'example' })
  assert.equal(result.ok, false); assert.equal(calls, 1); assert.equal(v.report.status, 'failed')
  assert.equal(v.report.steps[0].scenarioId, 'example'); assert.equal(v.report.steps[0].scenarioHash.length, 64)
  v.child = null
})

test('应用编辑器骨架构建后在真实隔离浏览器中通过公共场景', { skip: process.env.CORDIS_BROWSER_TEST !== '1', timeout: 120000 }, async t => {
  const root = await mkdtemp(resolve('editor-template-test-')), app = join(root, 'applications/notebook')
  let v
  t.after(async () => {
    await v?.close()
    assert.ok(root.startsWith(resolve('editor-template-test-')))
    await rm(root, { recursive: true, force: true })
  })
  await cp(resolve('applications/notebook'), app, { recursive: true, filter: path => !/[\\/](?:node_modules|dist)(?:[\\/]|$)/.test(path) })
  for (const folder of await readdir(join(app, 'plugins'))) {
    const modules = resolve('applications/notebook/plugins', folder, 'node_modules')
    if (await lstat(modules).catch(() => null)) await symlink(modules, join(app, 'plugins', folder, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  }
  const result = await scaffoldPlugin(root, 'notebook', { id: 'fixture-page', name: '测试编辑格式', template: 'note-editor', parameters: { field: 'body', editorLabel: '测试正文' } })
  assert.ok(result.sources.some(source => source.path.endsWith(join('test', 'format.test.js'))))
  await buildPlugins(join(app, 'plugins'))
  v = new BrowserVerification({ root, appId: 'notebook', dataDir: join(root, 'reports') })
  await v.run('browser_open')
  await v.run('browser_plugin', { id: 'fixture-page', enable: true })
  const checked = await v.run('browser_scenario', { id: 'note-editor-lifecycle', parameters: { pluginId: 'fixture-page', formatName: '测试编辑格式', editorLabel: '测试正文' } })
  assert.equal(checked.ok, true, JSON.stringify(checked.failure))
  const report = await v.run('browser_finish', { result: 'passed', summary: '公共文本格式生命周期场景' })
  assert.equal(report.status, 'passed'); assert.ok(report.checks.length >= 12)
  const persisted = JSON.parse(await readFile(join(v.directory, 'report.json'), 'utf8'))
  assert.ok(persisted.steps.every(step => step.name !== 'browser_action' || step.scenarioHash))
})
