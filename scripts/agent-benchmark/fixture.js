import { readFile, writeFile, mkdir, lstat, symlink, readdir, rm } from 'node:fs/promises'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join, dirname, relative, resolve, sep } from 'node:path'
import { createServer } from 'node:net'

export const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
export async function until(check, description, timeout = 15000) {
  const end = Date.now() + timeout
  do { const value = await check(); if (value) return value; await sleep(100) } while (Date.now() < end)
  throw Error('等待超时：' + description)
}
export async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
export async function snapshot(root, excluded = []) {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0').filter(Boolean)
  const sources = new Map(), hashes = {}
  for (const file of [...new Set(files)].sort()) {
    const path = join(root, file), info = await lstat(path).catch(e => { if (e.code !== 'ENOENT') throw e })
    if (!info) continue // Include staged/unstaged deletions as absence.
    if (!info.isFile()) throw Error('评测快照不接受非普通源码文件：' + file)
    const bytes = await readFile(path); hashes[file] = hash(bytes)
    if (!excluded.some(prefix => file.startsWith(prefix))) sources.set(file, bytes)
  }
  return { sources, hashes, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim(), fingerprint: hash(JSON.stringify(hashes)) }
}
export async function materialize(root, project, frozen) {
  await mkdir(project, { recursive: false })
  for (const [file, bytes] of frozen.sources) {
    const target = join(project, file); await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes)
  }
  const dirs = new Set(['', ...[...frozen.sources.keys()].filter(f => f.endsWith('/package.json')).map(dirname)])
  for (const dir of dirs) {
    const target = join(root, dir, 'node_modules')
    if (await lstat(target).catch(() => null)) await symlink(target, join(project, dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  }
  for (const args of [['init', '-q', '-b', 'codex/benchmark'], ['add', '.'], ['-c', 'user.name=Benchmark', '-c', 'user.email=benchmark@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', '完整开发评测隔离基线']])
    execFileSync('git', args, { cwd: project, stdio: 'ignore' })
}
export async function command(args, { root, env = process.env, signal, timeout = 120000, log }) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', timedOut = false
    const capture = chunk => { output = (output + chunk).slice(-16000); log?.(chunk) }
    child.stdout.on('data', capture); child.stderr.on('data', capture)
    const stop = () => {
      timedOut = true
      if (process.platform === 'win32') { const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }); killer.on('error', () => child.kill()) }
      else child.kill('SIGTERM')
    }
    const timer = setTimeout(stop, timeout); signal?.addEventListener('abort', stop, { once: true })
    if (signal?.aborted) stop()
    const clear = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop) }
    child.once('error', error => { clear(); reject(error) })
    child.once('close', code => { clear(); resolve({ exitCode: code ?? 1, timedOut, output, durationMs: Date.now() - start }) })
  })
}
export async function changedOutsidePlugin(project, frozen, task) {
  const allowed = `applications/${task.appId}/plugins/${task.pluginId}/`, changes = []
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: project }).toString().split('\0').filter(Boolean)
  for (const file of new Set([...frozen.sources.keys(), ...files])) {
    if (file.startsWith(allowed)) continue
    const actual = await readFile(join(project, file)).catch(e => { if (e.code !== 'ENOENT') throw e; return null })
    const before = frozen.sources.get(file)
    if (actual === null ? before !== undefined : !before || hash(actual) !== hash(before)) changes.push(file)
  }
  return changes
}
export async function removeCredentials(directory) {
  // Only exact, runner-created files; never delete the source user's configuration.
  for (const name of ['config.json', 'pi/auth.json']) await rm(join(directory, name), { force: true })
}
export async function sourceUnchanged(root, before) {
  const after = await snapshot(root)
  return JSON.stringify(before.hashes) === JSON.stringify(after.hashes)
}
export async function codeState(project, task) {
  const root = join(project, 'applications', task.appId, 'plugins', task.pluginId), files = {}
  async function visit(dir) {
    for (const item of await readdir(dir, { withFileTypes: true }).catch(e => { if (e.code !== 'ENOENT') throw e; return [] })) {
      if (['node_modules', 'dist', 'test', 'tests', '.git'].includes(item.name)) continue
      const path = join(dir, item.name)
      if (item.isDirectory()) await visit(path)
      else if (item.isFile() && /\.(?:[cm]?js|jsx|tsx?|css)$/.test(item.name)) files[relative(root, path).split(sep).join('/')] = hash(await readFile(path))
    }
  }
  await visit(root); return files
}
