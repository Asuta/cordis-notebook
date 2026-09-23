import { Service } from 'cordis'
import { mkdir, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises'
import { join, resolve, sep, dirname } from 'node:path'
import { builtins } from './builtins.js'
import { fail } from './http.js'
import { Remote } from './remote.js'

const safePath = value => typeof value === 'string' && /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)*\.(js|css|json|txt|html|svg)$/.test(value) && !value.split('/').some(part => part === '..' || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part))
export function validatePackage(pkg) {
  if (!pkg || typeof pkg !== 'object' || !pkg.manifest || !pkg.files) throw fail(400, '需要 manifest 和 files 的 JSON 插件包')
  const m = pkg.manifest
  if (!/^[a-z][a-z0-9-]{1,49}$/.test(m.id || '') || typeof m.name !== 'string' || !m.name.trim() || m.name.length > 80) throw fail(400, '插件 ID 或名称无效')
  if (m.apiVersion !== 1 || !/^\d+\.\d+\.\d+$/.test(m.version || '')) throw fail(400, '仅支持 apiVersion 1 和 x.y.z 版本号')
  if (!Array.isArray(m.dependencies) || m.dependencies.some(id => typeof id !== 'string' || !/^[a-z][a-z0-9-]{1,49}$/.test(id) || id === m.id) || new Set(m.dependencies).size !== m.dependencies.length) throw fail(400, '依赖列表无效')
  if (!m.server && !m.client) throw fail(400, '至少提供一个 server 或 client 入口')
  if (typeof pkg.files !== 'object' || Array.isArray(pkg.files) || Object.keys(pkg.files).length > 100) throw fail(400, '插件文件列表无效或超过 100 个文件')
  const lower = new Set()
  for (const [path, content] of Object.entries(pkg.files)) {
    if (!safePath(path) || typeof content !== 'string' || lower.has(path.toLowerCase()) || ['package.json', 'plugin.json'].includes(path.toLowerCase())) throw fail(400, `不支持的文件路径：${path}`)
    lower.add(path.toLowerCase())
  }
  for (const key of ['client', 'server']) if (m[key] && (!safePath(m[key]) || !m[key].endsWith('.js') || !Object.hasOwn(pkg.files, m[key]))) throw fail(400, `${key} 入口不存在`)
  return { id: m.id, name: m.name, description: String(m.description || '').slice(0, 500), version: m.version, apiVersion: 1, dependencies: m.dependencies, client: m.client || null, server: m.server || null, permissions: ['trusted'], builtin: false }
}
export class Plugins extends Service {
  static inject = ['http']
  constructor(ctx, { dataDir, file }) {
    super(ctx, 'plugins'); this.dataDir = resolve(dataDir); this.file = file; this.records = new Map(); this.queue = Promise.resolve(); this.revision = 0
    for (const item of builtins) this.records.set(item.manifest.id, { ...item, state: 'disabled', enabled: true, error: '', logs: [] })
  }
  serialize() { return { revision: this.revision, plugins: [...this.records.values()].map(r => ({ ...r.manifest, state: r.state, enabled: r.enabled, error: r.error, logs: r.logs.slice(-12), generation: r.generation || 0, pid: r.remote?.child.pid || null })) } }
  changed() { this.revision++; this.ctx.http.broadcast() }
  locked(fn) { const task = this.queue.then(fn); this.queue = task.catch(() => {}); return task }
  async persist() {
    const path = join(this.dataDir, 'plugins-state.json')
    await writeFile(path + '.tmp', JSON.stringify(Object.fromEntries([...this.records].map(([id, record]) => [id, record.enabled])), null, 2)); await rename(path + '.tmp', path)
  }
  async init() {
    await mkdir(join(this.dataDir, 'plugins'), { recursive: true }); await mkdir(join(this.dataDir, 'plugin-data'), { recursive: true })
    let state = {}
    try { state = JSON.parse(await readFile(join(this.dataDir, 'plugins-state.json'), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
    for (const directory of await readdir(join(this.dataDir, 'plugins'), { withFileTypes: true })) {
      if (!directory.isDirectory() || directory.name.startsWith('.')) continue
      try {
        const root = join(this.dataDir, 'plugins', directory.name), pkg = JSON.parse(await readFile(join(root, 'plugin.json'), 'utf8')), manifest = validatePackage(pkg)
        if (manifest.id !== directory.name || this.records.has(manifest.id)) throw new Error('插件 ID 冲突')
        this.records.set(manifest.id, { manifest, root, enabled: false, state: 'disabled', error: '', logs: [] })
      } catch (error) { console.error(`忽略无效插件 ${directory.name}: ${error.message}`) }
    }
    for (const [id, record] of this.records) if (typeof state[id] === 'boolean') record.enabled = state[id]
    for (const [id, record] of this.records) if (record.enabled) { try { await this.start(id) } catch {} }
  }
  async start(id, chain = []) {
    const record = this.records.get(id)
    if (!record) throw fail(400, `缺少依赖：${id}`)
    if (record.state === 'enabled') return
    if (chain.includes(id)) throw fail(400, `插件循环依赖：${[...chain, id].join(' → ')}`)
    record.state = 'starting'; record.error = ''; this.changed()
    try {
      for (const dependency of record.manifest.dependencies) {
        if (!this.records.get(dependency)?.enabled) throw fail(409, `请先启用依赖：${dependency}`)
        await this.start(dependency, [...chain, id])
      }
      const plugin = record.server || { inject: record.manifest.dependencies.includes('notes') ? ['notes'] : [], apply: async ctx => {
        if (!record.manifest.server) return
        const dataDir = join(this.dataDir, 'plugin-data', id); await mkdir(dataDir, { recursive: true })
        const remote = new Remote({ entry: join(record.root, record.manifest.server), dataDir,
          log: line => { record.logs.push(line.slice(-2000)); if (record.logs.length > 30) record.logs.shift() },
          host: async (method, args = {}) => {
            if (!['enabled', 'starting'].includes(record.state)) throw new Error('插件正在停止')
            if (!record.manifest.dependencies.includes('notes')) throw new Error('调用笔记服务必须声明 notes 依赖')
            if (method === 'notes.list') return ctx.notes.list()
            if (method === 'notes.create') return ctx.notes.create()
            if (method === 'notes.update') return ctx.notes.update(args.id, args.patch)
            if (method === 'notes.remove') return ctx.notes.remove(args.id)
            throw new Error('宿主方法不存在')
          },
          onCrash: error => { record.state = 'failed'; record.error = error; this.changed(); this.locked(async () => {
            for (const dependent of this.dependents(id).reverse()) { await this.stop(dependent); const item = this.records.get(dependent); item.state = 'failed'; item.error = `依赖 ${id} 已退出` }
            this.changed()
          }).catch(console.error) },
        })
        record.remote = remote; ctx.effect(() => () => remote.stop()); await remote.ready
      } }
      if (record.fiber) await record.fiber.dispose()
      const fiber = this.ctx.plugin(plugin, { file: this.file }); record.fiber = fiber; await fiber
      record.state = 'enabled'; record.generation = (record.generation || 0) + 1; this.changed()
    } catch (error) {
      if (record.fiber) { await record.fiber.dispose().catch(() => {}); record.fiber = null }; record.remote = null
      record.state = 'failed'; record.error = error.message; this.changed(); throw error
    }
  }
  dependents(id) {
    const result = [], visit = parent => { for (const [key, record] of this.records) if (record.state === 'enabled' && record.manifest.dependencies.includes(parent) && !result.includes(key)) { result.push(key); visit(key) } }
    visit(id); return result
  }
  async stop(id) {
    const record = this.records.get(id); if (!record) throw fail(404, '插件不存在')
    record.state = 'stopping'; this.changed()
    if (record.fiber) { await record.fiber.dispose(); record.fiber = null }
    record.remote = null; record.state = 'disabled'; this.changed()
  }
  toggle(id, enabled) {
    return this.locked(async () => {
      const record = this.records.get(id); if (!record) throw fail(404, '插件不存在')
      if (typeof enabled !== 'boolean') throw fail(400, 'enabled 必须是布尔值')
      if (!enabled) {
        const deps = this.dependents(id)
        if (deps.length) throw fail(409, `请先停用依赖此插件的功能：${deps.map(key => this.records.get(key).manifest.name).join('、')}`)
        await this.stop(id); record.enabled = false
      } else { record.enabled = true; try { await this.start(id) } catch (error) { await this.persist(); throw error } }
      await this.persist(); return this.serialize()
    })
  }
  install(pkg, trust) {
    return this.locked(async () => {
      if (trust !== true) throw fail(400, '安装需要明确确认完全信任此插件')
      const manifest = validatePackage(pkg)
      if (this.records.has(manifest.id)) throw fail(409, '插件已存在；第一版不支持覆盖升级，请先停用并卸载旧版本')
      for (const dependency of manifest.dependencies) if (!this.records.has(dependency)) throw fail(400, `缺少依赖：${dependency}`)
      const root = join(this.dataDir, 'plugins', manifest.id), staging = join(this.dataDir, 'plugins', '.' + manifest.id + '-' + Date.now())
      await mkdir(staging, { recursive: true })
      try {
        for (const [path, content] of Object.entries(pkg.files)) { const target = resolve(staging, path); if (!target.startsWith(staging + sep)) throw fail(400, '文件路径超出插件目录'); await mkdir(dirname(target), { recursive: true }); await writeFile(target, content) }
        await writeFile(join(staging, 'package.json'), '{"type":"module"}'); await writeFile(join(staging, 'plugin.json'), JSON.stringify({ manifest, files: pkg.files })); await rename(staging, root)
      } finally { await rm(staging, { recursive: true, force: true }) }
      this.records.set(manifest.id, { manifest, root, state: 'disabled', enabled: false, error: '', logs: [] }); await this.persist(); this.changed(); return this.serialize()
    })
  }
  uninstall(id) {
    return this.locked(async () => {
      const record = this.records.get(id)
      if (!record || record.manifest.builtin) throw fail(400, '仅能卸载第三方插件')
      if (record.state !== 'disabled') throw fail(409, '请先停用插件')
      if ([...this.records.values()].some(item => item.manifest.dependencies.includes(id))) throw fail(409, '仍有已安装插件依赖此插件')
      const root = resolve(this.dataDir, 'plugins', id), parent = resolve(this.dataDir, 'plugins')
      if (root !== record.root || !root.startsWith(parent + sep)) throw fail(400, '插件目录无效')
      await rm(root, { recursive: true, force: true }); this.records.delete(id); await this.persist(); this.changed(); return this.serialize()
    })
  }
  clearData(id, confirmation) {
    return this.locked(async () => {
      const record = this.records.get(id)
      if (!record || record.manifest.builtin || record.state !== 'disabled' || confirmation !== id) throw fail(400, '仅能清理已停用第三方插件的数据，且必须确认插件 ID')
      const parent = resolve(this.dataDir, 'plugin-data'), target = resolve(parent, id)
      if (!target.startsWith(parent + sep)) throw fail(400, '数据目录无效')
      await rm(target, { recursive: true, force: true }); return { ok: true }
    })
  }
  async close() { await this.queue; for (const id of [...this.records.keys()].reverse()) await this.stop(id) }
}
