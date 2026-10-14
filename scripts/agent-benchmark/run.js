import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { chromium } from 'playwright'
import { cases, selectCases } from './cases.js'
import { metrics, aggregate, markdown } from './metrics.js'
import { acceptPlugin } from './acceptance.js'
import { hash, snapshot, materialize, command, changedOutsidePlugin, sourceUnchanged, removeCredentials, freePort, until, sleep, codeState } from './fixture.js'
import { verifyPlugin } from '../test-plugin.js'
import { MODELS } from '../../workbench/config.js'

export function options(argv) {
  const result = { repeat: 1, timeoutSeconds: 600, repairs: 1, model: 'deepseek-flash', effort: 'high', page: 'headless', cases: cases.map(t => t.id) }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (key === '--') continue
    if (key === '--list') { result.list = true; continue }
    if (!['--cases', '--repeat', '--timeout', '--repairs', '--config', '--model', '--effort', '--page'].includes(key) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw Error('未知或缺值参数：' + key)
    const value = argv[++i]
    if (key === '--cases') result.cases = value.trim().split(/[,\s]+/)
    else if (key === '--timeout') result.timeoutSeconds = Number(value)
    else if (['--repeat', '--repairs'].includes(key)) result[key.slice(2)] = Number(value)
    else result[key.slice(2)] = value
  }
  for (const [key, min, max] of [['repeat', 1, 20], ['timeoutSeconds', 30, 3600], ['repairs', 0, 3]])
    if (!Number.isInteger(result[key]) || result[key] < min || result[key] > max) throw Error(`参数 ${key} 须为 ${min}–${max} 的整数`)
  if (!['headless', 'external'].includes(result.page) || !['low', 'high', 'max'].includes(result.effort)) throw Error('page 或 effort 无效')
  if (!MODELS.some(model => model.id === result.model)) throw Error('工作台不支持该模型：' + result.model)
  selectCases(result.cases)
  return result
}
async function save(directory, report) {
  report.summary = aggregate(report.trials)
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2))
  await writeFile(join(directory, 'report.md'), markdown(report))
}
export async function runBenchmark(config, { root = resolve('.'), onProgress = console.log, signal, workerFile } = {}) {
  const selected = selectCases(config.cases)
  // Nothing starts or reads credentials when listing the fixed task catalog.
  if (config.list) { onProgress(JSON.stringify(selected, null, 2)); return }
  const directory = join(root, 'work/agent-benchmark', new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8))
  await mkdir(directory, { recursive: true })
  const exclusions = [...cases.map(t => `applications/${t.appId}/plugins/${t.pluginId}/`), 'scripts/agent-benchmark/', 'test/agent-benchmark.test.js', 'test/fixtures/agent-benchmark']
  const frozen = await snapshot(root, exclusions)
  const configBytes = await readFile(resolve(root, config.config || '.workbench/config.json'))
  const settings = JSON.parse(configBytes.toString())
  if (!settings.apiKey && !process.env.DEEPSEEK_API_KEY) throw Error('未配置工作台模型密钥；可用 --config 指定已有配置文件')
  const redact = value => { let result = String(value); for (const key of [settings.apiKey, process.env.DEEPSEEK_API_KEY].filter(Boolean)) result = result.split(key).join('[密钥已隐藏]'); return result }
  const harness = await Promise.all(['acceptance.js', 'run.js', 'metrics.js', 'fixture.js'].map(async name => [name, hash(await readFile(new URL(name, import.meta.url)))]))
  const suiteHash = hash(JSON.stringify({ cases, harness }))
  const report = { version: 1, startedAt: new Date().toISOString(), status: 'running', source: { commit: frozen.commit, fingerprint: frozen.fingerprint, hashes: frozen.hashes },
    suiteHash, harness: Object.fromEntries(harness), cases: selected, model: config.model, effort: config.effort, timeoutSeconds: config.timeoutSeconds, repairs: config.repairs, repeat: config.repeat,
    environment: { node: process.version, platform: process.platform, page: config.page, provider: new URL(settings.baseUrl || 'https://api.deepseek.com/v1').origin, compaction: settings.compaction },
    exclusions, plannedTrials: selected.length * config.repeat, trials: [] }
  await save(directory, report)
  onProgress('REPORT ' + join(directory, 'report.md'))
  try {
    for (let round = 0; round < config.repeat; round++) {
      // Rotate task order across repetitions instead of always measuring one task first.
      const tasks = [...selected.slice(round % selected.length), ...selected.slice(0, round % selected.length)]
      for (const task of tasks) {
        if (signal?.aborted) throw Error('评测已取消')
        const trial = { id: `${String(report.trials.length + 1).padStart(2, '0')}-${task.id}`, caseId: task.id, round: round + 1, status: 'preparing', repairTurns: 0, attempts: [] }
        report.trials.push(trial); await save(directory, report)
        const trialDir = join(directory, trial.id), project = join(trialDir, 'project'), dataDir = join(trialDir, 'workbench-data')
        await mkdir(trialDir); await materialize(root, project, frozen); await mkdir(dataDir)
        const log = createWriteStream(join(trialDir, 'commands.log'))
        const run = (args, opts = {}) => command(args, { root: project, ...opts, log: chunk => log.write(redact(chunk)) })
        let wb, browser, timer, start, thread, firstObservedCodeChangeAt, scaffoldState, lastEventId, deadline
        const controller = new AbortController(), abort = () => controller.abort()
        signal?.addEventListener('abort', abort, { once: true })
        const request = async (path, body) => {
          const url = `http://127.0.0.1:${wb.server.address().port}/api/${path}`
          const response = await fetch(url, { ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) })
          const data = await response.json(); if (!response.ok) throw Error(data.error || '工作台请求失败'); return data
        }
        try {
          // Warm-up build/start is outside the task timer, identical for every trial.
          const build = await run(['scripts/build.js', task.appId], { signal })
          if (build.exitCode !== 0) throw Error('评测基线构建失败，见 commands.log')
          const workbenchBuild = await run(['workbench/build.js'], { signal })
          if (workbenchBuild.exitCode !== 0) throw Error('工作台页面构建失败')
          await writeFile(join(dataDir, 'config.json'), configBytes, { mode: 0o600 })
          const { createWorkbench } = await import(pathToFileURL(join(project, 'workbench/server.js')).href)
          wb = await createWorkbench({ root: project, port: 0, appPort: await freePort(), dataDir, appDataDir: join(trialDir, 'app-data'), appMode: 'development', autoStart: false, ...(workerFile ? { workerFile } : {}) })
          wb.application.env.APP = task.appId
          await wb.application.start()
          const url = `http://127.0.0.1:${wb.server.address().port}`
          onProgress(`READY ${trial.id} ${url}`)
          if (config.page === 'headless') { browser = await chromium.launch({ headless: true }); const page = await browser.newPage(); await page.goto(url) }
          const binding = await until(() => { if (signal?.aborted) throw Error('评测已取消'); return [...wb.clients.entries()].find(([, value]) => value.appId === task.appId && Date.now() - value.seen < 10000) }, '评测工作台页面连接：' + url, 180000)
          const clientId = binding[0]
          let prompt = task.prompt + '\n本次只允许修改该新插件目录，不修改已有插件或框架；不要安装依赖、提交或推送。只使用当前项目的开发资料，不读取或执行项目外的评测脚本、参考实现或其他轮次产物。完成实现和自测后结束回复，评测程序会独立验收并反馈。'
          start = Date.now(); deadline = start + config.timeoutSeconds * 1000
          timer = setTimeout(abort, config.timeoutSeconds * 1000)
          trial.status = 'running'; trial.startedAt = start
          onProgress('START ' + trial.id)
          for (let attempt = 0; attempt <= config.repairs && !controller.signal.aborted; attempt++) {
            const created = await request('run', { appId: task.appId, clientId, threadId: thread?.id, prompt, model: config.model, reasoningEffort: config.effort, thinking: true, browserVerificationEnabled: true })
            trial.threadId = created.id
            trial.repairTurns = attempt
            do {
              thread = await request('threads/' + created.id + '?limit=100')
              const turn = thread.turns.at(-1), events = turn.events.filter(e => e.kind === 'tool')
              // A file comparison also observes exec_command writes; its timestamp is an upper bound.
              const scaffold = events.find(e => e.name === 'workspace_scaffold_plugin')
              if (scaffold?.status === 'done' && !scaffoldState) {
                let output; try { output = JSON.parse(scaffold.output) } catch {}
                if (output?.sources) scaffoldState = Object.fromEntries(output.sources.filter(s => /\.(?:[cm]?js|jsx|tsx?|css)$/.test(s.path)).map(s => [s.path.replaceAll('\\', '/').split(`/${task.pluginId}/`).at(-1), hash(s.content)]))
              }
              if (!firstObservedCodeChangeAt) {
                const state = await codeState(project, task)
                const different = Object.keys(state).length !== Object.keys(scaffoldState || {}).length || Object.entries(state).some(([key, value]) => scaffoldState?.[key] !== value)
                if (Object.keys(state).length && (!scaffold || scaffoldState) && different) firstObservedCodeChangeAt = Date.now()
              }
              const last = events.at(-1)
              if (last && last.id + last.status !== lastEventId) { lastEventId = last.id + last.status; onProgress(`PROGRESS ${trial.id} ${Math.round((Date.now() - start) / 1000)}s ${last.name} ${last.status}`) }
              if (!thread.running) break
              if (controller.signal.aborted) {
                await request('interrupt', {})
                thread = await until(async () => { const value = await request('threads/' + created.id + '?limit=100'); return !value.running && value }, 'Agent 中断', 30000)
                break
              }
              await sleep(300)
            } while (true)
            await writeFile(join(trialDir, 'thread.json'), redact(JSON.stringify(thread, null, 2)))
            if (controller.signal.aborted) break
            const attemptDir = join(trialDir, 'attempt-' + (attempt + 1)); await mkdir(attemptDir)
            const outcome = { number: attempt + 1, startedAt: Date.now(), status: 'failed', source: await codeState(project, task) }
            trial.attempts.push(outcome)
            const outside = await changedOutsidePlugin(project, frozen, task)
            if (outside.length) outcome.error = '修改了允许范围之外的源码：' + outside.join(', ')
            else {
              try {
                const test = await verifyPlugin({ appId: task.appId, pluginIds: [task.pluginId] }, {
                  root: project, run: (args, opts) => run(args, { ...opts, signal: controller.signal, timeout: Math.max(1, deadline - Date.now()) }), log: text => log.write(redact(text) + '\n'),
                })
                outcome.pluginTest = test
                if (test.exitCode !== 0) outcome.error = '插件检查失败：' + test.stages.filter(s => s.exitCode !== 0).map(s => s.name + '\n' + (s.output || s.error || '')).join('\n').slice(-6000)
                else if (!controller.signal.aborted) {
                  outcome.acceptance = await acceptPlugin({ project, directory: attemptDir, task, signal: controller.signal })
                  outcome.status = outcome.acceptance.status
                }
              } catch (error) { outcome.error = redact(error.message) }
            }
            outcome.endedAt = Date.now()
            await writeFile(join(attemptDir, 'result.json'), redact(JSON.stringify(outcome, null, 2)))
            await save(directory, report)
            onProgress(`ACCEPT ${trial.id} ${attempt + 1} ${outcome.status}`)
            if (outcome.status === 'passed') { trial.status = 'passed'; trial.completionMs = Date.now() - start; break }
            if (outcome.status === 'infrastructure-error') { trial.status = outcome.status; break }
            prompt = '固定验收未通过，请仅修复该插件并完成自测。不能修改评测、已有插件或框架。失败与未执行项目：\n' + JSON.stringify({ error: outcome.error, checks: outcome.acceptance?.checks.filter(c => c.status !== 'passed'), setupError: outcome.acceptance?.error })
          }
          if (controller.signal.aborted) trial.status = signal?.aborted ? 'cancelled' : 'timeout'
          else if (trial.status === 'running') trial.status = 'failed'
        } catch (error) { trial.status = controller.signal.aborted ? (signal?.aborted ? 'cancelled' : 'timeout') : 'infrastructure-error'; trial.error = redact(error.message) }
        finally {
          clearTimeout(timer); signal?.removeEventListener('abort', abort)
          trial.endedAt = Date.now(); trial.elapsedMs = start ? trial.endedAt - start : null
          trial.completionMs ??= null
          trial.metrics = { ...metrics(thread?.turns || [], task), firstObservedCodeChangeMs: firstObservedCodeChangeAt && start ? firstObservedCodeChangeAt - start : null,
            acceptanceMs: trial.attempts.reduce((sum, a) => sum + ((a.endedAt || Date.now()) - a.startedAt), 0),
            fixedBrowserMs: trial.attempts.reduce((sum, a) => sum + (a.acceptance ? a.acceptance.endedAt - a.acceptance.startedAt : 0), 0) }
          await browser?.close().catch(() => {})
          try { await wb?.close() } catch (error) { trial.cleanupError = redact(error.message); trial.status = 'infrastructure-error' }
          await removeCredentials(dataDir); log.end()
          await save(directory, report); onProgress(`RESULT ${trial.id} ${trial.status} ${trial.elapsedMs}ms`)
        }
      }
    }
    report.status = report.trials.every(t => t.status === 'passed') ? 'passed' : 'completed-with-failures'
  } catch (error) { report.status = signal?.aborted ? 'cancelled' : 'infrastructure-error'; report.error = redact(error.message) }
  finally { report.finishedAt = new Date().toISOString(); report.sourceUnchanged = await sourceUnchanged(root, frozen); if (!report.sourceUnchanged) { report.status = 'invalid'; report.error = '评测期间原始工作区源码发生变化，不能用于对比' }; await save(directory, report) }
  return { directory, report }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort()); process.once('SIGTERM', () => controller.abort())
  try { const result = await runBenchmark(options(process.argv.slice(2)), { signal: controller.signal }); if (result && result.report.status !== 'passed') process.exitCode = 1 }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
