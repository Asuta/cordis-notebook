import { readdir, readFile, realpath, mkdir, writeFile } from 'node:fs/promises'
import { resolve, relative, sep, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { discoverApplications } from '../server/application-discovery.js'
import { discoverBuiltins, inside } from '../server/plugin-discovery.js'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const slash = file => file.split(sep).join('/')
const ids = value => Array.isArray(value) && value.every(id => typeof id === 'string' && id.length > 0)
export async function testFiles(directory, boundary) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
  const found = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || ['node_modules', 'dist'].includes(entry.name)) continue
    const file = resolve(directory, entry.name)
    if (!inside(boundary, await realpath(file))) throw Error('测试路径超出目录：' + file)
    if (entry.isDirectory()) found.push(...await testFiles(file, boundary))
    else if (entry.isFile() && /\.test\.[cm]?js$/.test(entry.name)) found.push(file)
  }
  return found
}

/** Metadata selection only: never import tests or execute plugin implementations. */
export async function planPluginTests({ root = projectRoot, appId, pluginIds }) {
  root = await realpath(root)
  if (!appId || !ids(pluginIds) || !pluginIds.length) throw Error('请指定 --app <应用ID> 和 --plugin <插件ID>（可重复）')
  const app = (await discoverApplications(resolve(root, 'applications'))).find(item => item.id === appId)
  if (!app || app.error) throw Error(app?.error || '未找到应用：' + appId)
  const entries = await discoverBuiltins(app.pluginsDir)
  const selected = [...new Set(pluginIds)].map(id => {
    const entry = entries.find(item => item.manifest.id === id)
    if (!entry) throw Error('未找到插件：' + id)
    return entry
  })
  const own = new Map(), related = new Map(), warnings = []
  for (const entry of selected) {
    const files = await testFiles(resolve(entry.sourceRoot, 'test'), entry.sourceRoot)
    own.set(entry.manifest.id, files)
    if (!files.length) warnings.push(`${entry.manifest.id} 没有插件内业务测试；关联回归不能证明其全部业务行为。`)
    if (entry.manifest.client) warnings.push(`${entry.manifest.id} 的实际页面效果需要浏览器验收，本命令不宣称视觉验证通过。`)
  }
  const metadata = await readFile(resolve(root, 'test/coverage.json'), 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return { version: 1, tests: [] }
    throw error
  })
  if (metadata.version !== 1 || !Array.isArray(metadata.tests)) throw Error('test/coverage.json 格式无效')
  for (const rule of metadata.tests) {
    if (typeof rule.file !== 'string' || !rule.file.startsWith('test/') || !/\.test\.[cm]?js$/.test(rule.file)
      || typeof rule.application !== 'string' || !ids(rule.plugins || [])
      || !ids(rule.services?.server || []) || !ids(rule.services?.client || [])
      || ![...(rule.plugins || []), ...(rule.services?.server || []), ...(rule.services?.client || [])].length) throw Error('测试覆盖声明无效：' + JSON.stringify(rule))
    const file = await realpath(resolve(root, rule.file))
    if (!inside(resolve(root, 'test'), file)) throw Error('关联测试路径超出 test 目录：' + rule.file)
    if (rule.application !== appId) continue
    const reasons = []
    for (const entry of selected) {
      const m = entry.manifest
      if (rule.plugins?.includes(m.id)) reasons.push(`直接覆盖插件 ${m.id}`)
      for (const side of ['server', 'client']) for (const service of rule.services?.[side] || []) {
        if ([...m.requires[side], ...m.provides[side]].includes(service)) reasons.push(`${m.id} 使用或提供 ${side}:${service}`)
      }
    }
    if (reasons.length) related.set(file, [...new Set([...(related.get(file) || []), ...reasons])])
  }
  if (!related.size) warnings.push('未找到明确声明的关联回归；涉及宿主、公共协议或全局依赖时应扩大验证范围。')
  const tests = new Map([...own].flatMap(([id, files]) => files.map(file => [file, [`插件 ${id} 自带测试`]])))
  for (const [file, reasons] of related) tests.set(file, [...(tests.get(file) || []), ...reasons])
  return { appId, pluginIds: selected.map(entry => entry.manifest.id),
    buildScope: `应用 ${appId} 及通用宿主（运行时回归需要完整应用产物）`,
    tests: [...tests].map(([file, reasons]) => ({ file: slash(relative(root, file)), reasons })), warnings }
}

export function parsePluginTestArgs(args) {
  const options = { pluginIds: [] }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--') continue
    if (args[i] === '--list') { options.list = true; continue }
    if (!['--app', '--plugin'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('用法：pnpm test:plugin --app <应用ID> --plugin <插件ID> [--plugin <ID>] [--list]')
    const flag = args[i], value = args[++i]
    if (flag === '--app') options.appId = value
    else options.pluginIds.push(value)
  }
  return options
}

async function command(args, { root, env }) {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let tail = ''
    const capture = (chunk, stream) => { stream.write(chunk); tail = (tail + chunk).slice(-16000) }
    child.stdout.on('data', chunk => capture(chunk, process.stdout)); child.stderr.on('data', chunk => capture(chunk, process.stderr))
    child.once('error', reject)
    child.once('close', (code, signal) => accept({ exitCode: code ?? 1, signal, output: tail }))
  })
}

export async function verifyPlugin(options, { root = projectRoot, run = command, log = console.log } = {}) {
  const plan = await planPluginTests({ root, ...options })
  log(JSON.stringify(plan, null, 2))
  if (options.list) return { ...plan, status: 'planned', exitCode: 0 }
  const directory = resolve(root, 'work/verification', randomUUID()), reportFile = resolve(directory, 'report.json')
  await mkdir(directory, { recursive: true })
  const report = { ...plan, startedAt: new Date().toISOString(), status: 'running', stages: [], reportFile }
  const save = () => writeFile(reportFile, JSON.stringify(report, null, 2))
  const env = { ...process.env, DATA_DIR: resolve(directory, 'data'), PORT: '0', WORKBENCH_PORT: '0', WORKBENCH_APP_PORT: '0',
    APPLICATIONS_DIR: resolve(root, 'applications'), APP: plan.appId, CORDIS_TEST_APP: plan.appId, CORDIS_TEST_PLUGINS: JSON.stringify(plan.pluginIds) }
  delete env.PLUGINS_DIR
  await save()
  try {
    const require = createRequire(resolve(root, 'package.json'))
    const stages = [
      ['类型检查', [resolve(dirname(require.resolve('typescript/package.json')), 'bin/tsc'), '-p', 'tsconfig.contracts.json']],
      ['正式构建', ['scripts/build.js', plan.appId]],
      ['产物检查', null],
      ...(plan.tests.length ? [['插件及关联测试', ['--test', ...plan.tests.map(item => item.file)]]] : []),
    ]
    for (const [name, args] of stages) {
      const stage = { name, args, startedAt: new Date().toISOString() }, start = Date.now()
      report.stages.push(stage); await save(); log(`开始：${name}`)
      let result
      try {
        if (args) result = await run(args, { root, env })
        else { await discoverBuiltins(resolve(root, 'applications', plan.appId, 'plugins'), { mode: 'runtime' }); result = { exitCode: 0 } }
      }
      catch (error) { result = { exitCode: 1, error: error.message } }
      Object.assign(stage, result, { durationMs: Date.now() - start })
      await save()
      if (result.exitCode !== 0) { report.status = 'failed'; report.exitCode = result.exitCode; break }
    }
    if (report.status === 'running') {
      // A green command means the selected checks passed, not complete business/visual coverage.
      report.status = report.warnings.length ? 'passed-with-gaps' : 'passed'; report.exitCode = 0
    }
  } catch (error) { report.status = 'failed'; report.exitCode = 1; report.error = error.message }
  finally { report.finishedAt = new Date().toISOString(); await save(); log(`验证结果：${report.status}；报告：${reportFile}`) }
  return report
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = (await verifyPlugin(parsePluginTestArgs(process.argv.slice(2)))).exitCode }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
