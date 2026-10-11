import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { resolve, join, sep } from 'node:path'
import { planPluginTests, parsePluginTestArgs, verifyPlugin } from '../scripts/test-plugin.js'
import { ApplicationProcess } from '../workbench/processes.js'

async function fixture(t) {
  await mkdir(resolve('work'), { recursive: true })
  const root = await mkdtemp(resolve('work/verification-test-'))
  t.after(async () => { assert.ok(root.startsWith(resolve('work') + sep)); await rm(root, { recursive: true, force: true }) })
  const plugin = join(root, 'applications/sample/plugins/exporter')
  await mkdir(join(plugin, 'test/nested'), { recursive: true }); await mkdir(join(root, 'test'))
  await mkdir(join(plugin, 'types'))
  await writeFile(join(root, 'package.json'), '{"type":"module"}')
  await writeFile(join(root, 'applications/sample/package.json'), JSON.stringify({ cordisApp: { id: 'sample', name: '验证测试' } }))
  await writeFile(join(plugin, 'package.json'), JSON.stringify({ name: '@test/exporter', version: '1.0.0', type: 'module',
    cordis: { schemaVersion: 1, id: 'exporter', name: '导出', client: 'client.js', requires: { server: [], client: ['documents'] }, provides: { server: [], client: [] }, public: ['client.js'],
      build: [{ type: 'bundle', platform: 'browser', input: 'client.js', output: 'client.js' }] } }))
  await writeFile(join(plugin, 'client.js'), 'export default () => {}')
  await writeFile(join(plugin, 'types/client.d.ts'), 'export {}')
  await writeFile(join(plugin, 'test/export.types.ts'), 'export {}')
  await writeFile(join(plugin, 'test/nested/ignored.types.ts'), 'export {}')
  await writeFile(join(plugin, 'test/nested/export.test.js'), 'throw Error("选择测试时不能执行代码")')
  await writeFile(join(root, 'test/documents.test.js'), 'throw Error("选择测试时不能执行代码")')
  await writeFile(join(root, 'test/unrelated.test.js'), '')
  const metadata = { version: 1, tests: [
    { file: 'test/documents.test.js', application: 'sample', services: { client: ['documents'] } },
    { file: 'test/unrelated.test.js', application: 'other', services: { client: ['documents'] } },
  ] }
  await writeFile(join(root, 'test/coverage.json'), JSON.stringify(metadata))
  return { root, plugin, metadata, options: { appId: 'sample', pluginIds: ['exporter'] } }
}

test('任意插件测试自动发现，关联按应用和服务分端选择，不执行测试代码', async t => {
  const f = await fixture(t), plan = await planPluginTests({ root: f.root, ...f.options })
  assert.deepEqual(plan.tests.map(item => item.file), ['applications/sample/plugins/exporter/test/nested/export.test.js', 'test/documents.test.js'])
  assert.match(plan.tests[1].reasons[0], /client:documents/)
  assert.equal(plan.coverage.typecheck.config, 'tsconfig.contracts.json')
  assert.equal(plan.coverage.typecheck.runtimeImplementation, '未纳入自动检查；需要单独的类型测试、构建或运行时测试验证。')
  assert.deepEqual(plan.coverage.typecheck.pluginTypeFiles.exporter, [
    'applications/sample/plugins/exporter/test/export.types.ts',
    'applications/sample/plugins/exporter/types/client.d.ts',
  ])
  assert.equal(plan.coverage.tests.count, 2)
  assert.equal(plan.coverage.browser.status, 'not-run')
  await rm(join(f.plugin, 'test/nested/export.test.js'))
  const gap = await planPluginTests({ root: f.root, ...f.options })
  assert.ok(gap.warnings.some(message => message.includes('没有插件内业务测试')))
  assert.ok(gap.warnings.some(message => message.includes('浏览器验收')))
  f.metadata.tests[0].services = { server: ['documents'] }
  await writeFile(join(f.root, 'test/coverage.json'), JSON.stringify(f.metadata))
  assert.equal((await planPluginTests({ root: f.root, ...f.options })).tests.length, 0)
  await assert.rejects(planPluginTests({ root: f.root, appId: 'sample', pluginIds: ['missing'] }), /未找到插件/)
})

test('构建失败时停止测试，重跑保留首次报告，各阶段使用独立数据和端口', async t => {
  const f = await fixture(t), calls = []
  const first = await verifyPlugin(f.options, { root: f.root, log() {}, run: async (args, context) => {
    calls.push({ args, ...context }); return { exitCode: calls.length === 2 ? 1 : 0, output: '构建失败证据' }
  } })
  assert.equal(first.status, 'failed'); assert.equal(calls.length, 2)
  assert.equal(calls[1].args[0], 'scripts/build.js'); assert.equal(calls[1].args[1], 'sample')
  assert.equal(calls[0].env.PORT, '0'); assert.ok(calls[0].env.DATA_DIR.startsWith(join(f.root, 'work/verification')))
  const second = await verifyPlugin(f.options, { root: f.root, log() {}, run: async args => {
    if (args[0] === 'scripts/build.js') { await mkdir(join(f.plugin, 'dist')); await writeFile(join(f.plugin, 'dist/client.js'), 'export default () => {}') }
    if (args[0] === '--test') assert.ok(args.includes('test/documents.test.js'))
    return { exitCode: 0 }
  } })
  assert.equal(second.status, 'passed-with-gaps'); assert.equal(second.stages.length, 4)
  assert.notEqual(second.reportFile, first.reportFile)
  assert.equal(JSON.parse(await readFile(first.reportFile)).status, 'failed')
  assert.equal(JSON.parse(await readFile(first.reportFile)).stages[1].output, '构建失败证据')
})

test('覆盖声明不能越界，参数不能吞掉未知选项，工作台复用命令会话', async t => {
  const f = await fixture(t)
  await writeFile(join(f.root, 'outside.test.js'), '')
  f.metadata.tests[0].file = 'test/../outside.test.js'
  await writeFile(join(f.root, 'test/coverage.json'), JSON.stringify(f.metadata))
  await assert.rejects(planPluginTests({ root: f.root, ...f.options }), /超出 test/)
  assert.throws(() => parsePluginTestArgs(['--plugin']), /用法/)
  let invocation
  const process = new ApplicationProcess({ root: f.root, commands: { async start(owner, input, options) {
    invocation = { owner, input, options }; options.onStart(); return { status: 'running', session_id: 'test-session' }
  } } })
  const result = await process.test('sample', 'owner', { plugins: ['exporter'] })
  assert.equal(result.session_id, 'test-session'); assert.equal(process.busy, true)
  assert.deepEqual(invocation.options.args.slice(1), ['--app', 'sample', '--plugin', 'exporter'])
  invocation.options.onExit(); assert.equal(process.busy, false)
  await assert.rejects(process.test('sample', 'owner', { plugins: ['../escape'] }), /有效插件/)
})
