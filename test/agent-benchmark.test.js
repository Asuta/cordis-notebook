import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { options, runBenchmark } from '../scripts/agent-benchmark/run.js'
import { cases, selectCases } from '../scripts/agent-benchmark/cases.js'
import { metrics, unionMs, aggregate } from '../scripts/agent-benchmark/metrics.js'
import { snapshot, materialize, command, changedOutsidePlugin } from '../scripts/agent-benchmark/fixture.js'
import { acceptPlugin } from '../scripts/agent-benchmark/acceptance.js'
import { referencePlugin } from './fixtures/agent-benchmark-reference.js'

test('评测拒绝未知任务/无效预算；list 不读取密钥或运行模型', async () => {
  for (const args of [['--cases', 'typo'], ['--repeat', '0'], ['--timeout', 'NaN'], ['--repairs', '4'], ['--cases', 'backend,backend'], ['--page', 'chrome']]) assert.throws(() => options(args))
  const messages = []
  await runBenchmark(options(['--list', '--cases', 'backend']), { root: 'not-a-workspace', onProgress: text => messages.push(text) })
  assert.equal(JSON.parse(messages[0])[0].id, 'backend')
  assert.deepEqual(options(['--cases', 'backend content']).cases, ['backend', 'content'])
})

test('重叠耗时不重复累计，首次编辑排除骨架/失败/测试/其他插件', () => {
  assert.equal(unionMs([{ startedAt: 0, endedAt: 10 }, { startedAt: 5, endedAt: 15 }]), 15)
  const task = selectCases(['backend'])[0], file = 'C:/repo/applications/notebook/plugins/note-summary/'
  const events = [
    { name: 'workspace_scaffold_plugin', status: 'done', path: file + 'server.js', startedAt: 3 },
    { name: 'write', status: 'error', path: file + 'server.js', startedAt: 5 },
    { name: 'write', status: 'done', path: file + 'test/main.test.js', startedAt: 7 },
    { name: 'write', status: 'done', path: file.replace('note-summary', 'other') + 'server.js', startedAt: 9 },
    { name: 'edit', status: 'done', path: file + 'server.js', startedAt: 20 },
  ].map(e => ({ ...e, kind: 'tool', input: JSON.stringify({ path: e.path }), endedAt: e.startedAt + 2 }))
  assert.equal(metrics([{ startedAt: 0, endedAt: 30, events }], task).firstEditMs, 20)
  assert.equal(metrics([], task).firstEditMs, null)
})

test('汇总保留失败/超时/环境错误，失败不能被当作快速成功', () => {
  const rows = [{ status: 'passed', completionMs: 100, attempts: [{}] }, { status: 'passed', completionMs: 300, attempts: [{}, {}] },
    { status: 'timeout', completionMs: null, repairTurns: 1, attempts: [] }, { status: 'failed', attempts: [{}] }, { status: 'infrastructure-error', attempts: [] }].map(r => ({ caseId: 'backend', ...r }))
  assert.deepEqual(aggregate(rows)[0], { caseId: 'backend', trials: 5, passed: 2, firstPass: 1, timeouts: 1, failed: 1, infrastructureErrors: 1, medianFirstEditMs: null, medianSuccessfulCompletionMs: 200, repairs: 2 })
})

const integration = process.env.CORDIS_BENCHMARK_TEST === '1'
test('固定验收接受五类参考实现，并拒绝错误业务结果；隔离范围检查发现框架改动', { skip: !integration, timeout: 240000 }, async t => {
  const directory = await mkdtemp(resolve('work/benchmark-judge-test-')), project = join(directory, 'project')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const frozen = await snapshot(resolve('.'), cases.map(item => `applications/${item.appId}/plugins/${item.pluginId}/`))
  await materialize(resolve('.'), project, frozen)
  for (const task of cases) await referencePlugin(project, task)
  for (const app of ['notebook', 'studio']) assert.equal((await command(['scripts/build.js', app], { root: project })).exitCode, 0)
  for (const task of cases) {
    const result = await acceptPlugin({ project, directory: join(directory, task.id), task })
    assert.equal(result.status, 'passed', task.id + ': ' + JSON.stringify(result))
    assert.deepEqual(result.checks.map(c => c.id).sort(), [...task.checks].sort())
  }
  const task = selectCases(['backend'])[0]
  await referencePlugin(project, task, true)
  assert.equal((await command(['scripts/build.js', 'notebook'], { root: project })).exitCode, 0)
  const failed = await acceptPlugin({ project, directory: join(directory, 'broken'), task })
  assert.equal(failed.status, 'failed'); assert.equal(failed.checks.find(c => c.id === 'empty-data').status, 'failed')
  assert.ok(failed.checks.some(c => c.status === 'blocked'))
  await writeFile(join(project, 'agent/ARCHITECTURE.md'), 'unexpected change')
  assert.ok((await changedOutsidePlugin(project, frozen, task)).includes('agent/ARCHITECTURE.md'))
})

test('完整评测真实工作台流程保留首轮失败，反馈后通过并删除临时凭据', { skip: !integration, timeout: 240000 }, async t => {
  const directory = await mkdtemp(resolve('work/benchmark-runner-test-')), config = join(directory, 'config.json')
  await writeFile(config, JSON.stringify({ apiKey: 'benchmark-fixture-not-a-real-key' }))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const result = await runBenchmark(options(['--cases', 'backend', '--config', config, '--timeout', '180']), {
    workerFile: resolve('test/fixtures/agent-benchmark-worker.js'), onProgress: () => {},
  })
  t.after(() => rm(result.directory, { recursive: true, force: true }))
  assert.equal(result.report.status, 'passed', JSON.stringify(result.report.trials))
  const trial = result.report.trials[0]
  assert.deepEqual(trial.attempts.map(a => a.status), ['failed', 'passed'])
  assert.equal(result.report.summary[0].firstPass, 0)
  assert.ok(trial.metrics.firstEditMs >= 0); assert.ok(trial.completionMs > 0)
  assert.equal(result.report.sourceUnchanged, true)
  for (const file of ['config.json', 'pi/auth.json']) await assert.rejects(access(join(result.directory, trial.id, 'workbench-data', file)))
  assert.ok(!(await readFile(join(result.directory, 'report.json'), 'utf8')).includes('benchmark-fixture-not-a-real-key'))
})
