import { mkdir, readFile, readdir, writeFile, cp, realpath } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { Readable } from 'node:stream'
import { localProjectMiddleware, revealFolder, JobError } from './compiled/server.js'
import { unpackAvatar, packAvatar, validateAvatarFiles, parseManifest } from './compiled/runtime.js'

const fail = (status, message) => { throw Object.assign(Error(message), { status }) }
const idOK = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const inside = (base, path) => { const r = relative(base, path); return r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r) }
async function readBody(req) {
  let size = 0; const chunks = []
  for await (const chunk of req) { size += chunk.length; if (size > 90 * 1024 * 1024) fail(413, '角色包不能超过 64 MB'); chunks.push(chunk) }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}') } catch { fail(400, '角色请求 JSON 无效') }
}
export default async function meshServer(ctx, _config, runtime) {
  const resources = fileURLToPath(new URL('./', import.meta.url)), vendor = join(resources, 'vendor'), compiled = join(resources, 'compiled')
  const archives = join(runtime.dataDir, 'archives'), roots = new Map(), middlewares = new Map(), versions = new Map()
  await mkdir(archives, { recursive: true })
  let queue = Promise.resolve(), stopped = false
  const enqueue = fn => { const next = queue.then(() => { if (stopped) fail(503, '角色工作室已停用'); return fn() }); queue = next.catch(() => {}); return next }
  const route = (method, pattern, fn) => ctx.http.route(ctx, method, pattern, fn)
  const root = pid => join(runtime.dataDir, 'projects', pid)
  async function init(pid) {
    if (!idOK(pid)) fail(400, '作品标识无效')
    if (!roots.has(pid)) roots.set(pid, (async () => {
      await mkdir(join(root(pid), 'projects'), { recursive: true })
      await cp(join(vendor, 'samples/miko-qipao'), join(root(pid), 'samples/miko-qipao'), { recursive: true, force: false })
      await cp(join(vendor, 'tools'), join(root(pid), 'tools'), { recursive: true })
      await cp(join(resources, 'docs'), join(root(pid), 'docs'), { recursive: true })
    })().catch(e => { roots.delete(pid); throw e }))
    await roots.get(pid)
  }
  const archiveFile = id => { if (!/^[a-f0-9]{64}$/.test(id || '')) fail(400, '角色包标识无效'); return join(archives, id + '.mavatar') }
  async function store(bytes) {
    let files
    try { files = unpackAvatar(bytes); const issues = validateAvatarFiles(files); if (!files['avatar.json']) issues.push('缺少 avatar.json'); if (issues.length) throw Error(issues.join('; ')) } catch (e) { fail(400, '角色包无效：' + e.message) }
    const manifest = parseManifest(JSON.parse(new TextDecoder().decode(files['avatar.json'])))
    if (typeof manifest.name !== 'string' || manifest.name.length > 120 || bytes.length > 64*1024*1024) fail(400, '角色包名称或大小超出范围')
    const archiveId = hash(bytes), path = archiveFile(archiveId)
    try { await writeFile(path, bytes, { flag: 'wx' }) } catch (e) { if (e.code !== 'EEXIST') throw e }
    return { archiveId, name: manifest.name, size: bytes.length }
  }
  async function readEditable(folder, prefix = '', files = Object.create(null), limits = { size: 0, count: 0 }) {
    for (const item of await readdir(folder, { withFileTypes: true })) {
      if (item.isSymbolicLink()) fail(400, '角色工程不能包含重定向文件')
      if (item.name.startsWith('.')) continue
      const path = join(folder, item.name), name = prefix + item.name
      if (item.isDirectory()) await readEditable(path, name + '/', files, limits)
      else if (item.isFile() && /[.](png|json|md|txt)$/i.test(item.name)) {
        if (!inside(folder, await realpath(path))) fail(400, '角色资源不能重定向')
        files[name] = await readFile(path); limits.size += files[name].length; limits.count++
        if (limits.size > 64*1024*1024 || limits.count > 200) fail(413, '角色工程大小或文件数量超出范围')
      }
    }
    return files
  }
  async function publish(pid, name) {
    if (!idOK(name)) fail(400, '角色工程名称无效')
    const folder = join(root(pid), 'projects', name)
    return store(packAvatar(await readEditable(folder)))
  }
  route('POST', /^\/api\/narrative\/mesh\/archives$/, async ({ req }) => {
    const input = await readBody(req)
    if (typeof input.base64 !== 'string' || input.base64.length > 90 * 1024 * 1024 || !/^[a-zA-Z0-9+/]+={0,2}$/.test(input.base64)) fail(400, '角色包编码无效')
    const bytes = Buffer.from(input.base64, 'base64'); if (bytes.length > 64 * 1024 * 1024) fail(413, '角色包过大')
    return enqueue(() => store(bytes))
  })
  route('GET', /^\/api\/narrative\/mesh\/archives\/([a-f0-9]{64})\.mavatar$/, async ({ match, res }) => {
    const bytes = await readFile(archiveFile(match[1])).catch(e => { if (e.code === 'ENOENT') fail(404, '角色包不存在，请重新导入含模型资源的作品包'); throw e })
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, max-age=31536000, immutable' }); res.end(bytes)
  })
  route('GET', /^\/api\/narrative\/mesh\/archives\/([a-f0-9]{64})\/export$/, async ({ match }) => ({ base64: (await readFile(archiveFile(match[1]))).toString('base64') }))
  route('POST', /^\/api\/narrative\/mesh\/projects\/([a-zA-Z0-9_-]{1,80})\/open$/, async ({ match, req }) => {
    const input = await readBody(req), pid = match[1]
    return enqueue(async () => {
      await init(pid)
      const name = 'avatar-' + randomUUID(), folder = join(root(pid), 'projects', name)
      if (input.archiveId) {
        const files = unpackAvatar(await readFile(archiveFile(input.archiveId)))
        await mkdir(folder)
        for (const [name, bytes] of Object.entries(files)) {
          if (name.endsWith('/')) continue
          const target = resolve(folder, name)
          if (!inside(folder, target) || name.split('/').some(p => !/^[a-zA-Z0-9_.-]+$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) fail(400, '角色包文件名无效')
          await mkdir(resolve(target, '..'), { recursive: true }); await writeFile(target, bytes, { flag: 'wx' })
        }
      } else await cp(join(vendor, 'samples/miko-qipao'), folder, { recursive: true, errorOnExist: true })
      return { editorProject: name, model: await publish(pid, name), session: req.headers['x-application-session'] || '' }
    })
  })
  route('POST', /^\/api\/narrative\/mesh\/projects\/([a-zA-Z0-9_-]{1,80})\/publish$/, async ({ match, req }) => { const input = await readBody(req); return enqueue(() => publish(match[1], input.editorProject)) })
  const pattern = /^\/api\/narrative\/mesh\/projects\/([a-zA-Z0-9_-]{1,80})\/studio\/(.*)$/
  async function studio({ match, req, res }) {
    const pid = match[1], tail = match[2]; await init(pid)
    if (tail === 'editor.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>角色工作室</title><link rel="stylesheet" href="studio.css"><div id="root"></div><script type="module" src="studio.js"></script></html>'); return }
    if (['studio.js', 'studio.css'].includes(tail)) { const bytes = await readFile(join(compiled, tail)); res.writeHead(200, { 'Content-Type': tail.endsWith('.js') ? 'text/javascript' : 'text/css' }); res.end(bytes); return }
    if (tail.startsWith('miko-qipao/')) {
      const name = tail.slice('miko-qipao/'.length), path = resolve(vendor, 'samples/miko-qipao', name)
      if (!inside(join(vendor, 'samples/miko-qipao'), path)) fail(400, '素材路径无效')
      const bytes = await readFile(path).catch(e => { if (e.code === 'ENOENT') fail(404, '角色素材不存在'); throw e }); res.writeHead(200, { 'Content-Type': name.endsWith('.png') ? 'image/png' : 'application/json' }); res.end(bytes); return
    }
    if (!tail.startsWith('__studio/')) fail(404, '角色编辑器资源不存在')
    if (!middlewares.has(pid)) {
      const runner = (_, project, tool) => new Promise((done, reject) => {
        const args = ['run', '--no-project', '--no-python-downloads', '--python', '>=3.10,<3.14', '--with', 'numpy', '--with', 'pillow', '--with', 'opencv-python-headless', join(root(pid), 'tools', tool + '.py'), project]
        execFile('uv', args, { cwd: root(pid), timeout: 120000, maxBuffer: 2 * 1024 * 1024, windowsHide: true }, (error, out, err) => { const log = (out + '\n' + err).slice(-12000); error ? reject(new JobError(error.code === 'ENOENT' ? 'dependencies' : 'toolFailed', log)) : done(log) })
      })
      middlewares.set(pid, localProjectMiddleware(root(pid), revealFolder, runner))
    }
    const operation = async () => {
      if (req.method === 'POST' && tail === '__studio/export') {
        const input = await readBody(req)
        if (!idOK(input.project) || input.includeSource !== undefined && typeof input.includeSource !== 'boolean') fail(400, '角色导出参数无效')
        const folder = input.project === 'sample-miko-qipao' ? join(root(pid), 'samples/miko-qipao') : join(root(pid), 'projects', input.project)
        const files = await readEditable(folder)
        if (input.includeSource === false) for (const name of Object.keys(files)) if (!name.startsWith('built/') && !['avatar.json', 'rig.json', 'thumbnail.png'].includes(name) && !/[.](md|txt)$/i.test(name)) delete files[name]
        if (input.lipSync !== undefined || input.includeSource === false) {
          const manifest = JSON.parse(new TextDecoder().decode(files['avatar.json']))
          if (input.lipSync !== undefined) manifest.lipSync = input.lipSync
          if (input.includeSource === false) delete manifest.source
          files['avatar.json'] = new TextEncoder().encode(JSON.stringify(parseManifest(manifest)))
        }
        const bytes = packAvatar(files)
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="' + input.project + '.mavatar"', 'Cache-Control': 'no-store' }); res.end(bytes); return
      }
      const name = tail.match(/^__studio\/projects\/([^/]+)\//)?.[1], versionKey = pid + ':' + name, version = versions.get(versionKey) || 0
      if (name && req.method === 'POST' && Number(req.headers['x-mesh-revision']) !== version) fail(409, '角色工程已在其他页面修改，请重新打开；当前修改仍保留')
      let request = req
      if (req.method === 'POST' && tail === '__studio/import') {
        const input = await readBody(req)
        if (typeof input.base64 !== 'string' || !/^[a-zA-Z0-9+/]+={0,2}$/.test(input.base64)) fail(400, '角色包编码无效')
        request = Readable.from([Buffer.from(input.base64, 'base64')]); request.method = 'POST'; request.headers = { ...req.headers, 'content-type': 'application/octet-stream' }; delete request.headers['content-length']
      }
      const originalUrl = request.url
      let status = 200, headers = {}, bytes
      const buffered = { writeHead(code, value) { status = code; headers = value; return this }, end(value) { bytes = value } }
      try { request.url = '/' + tail + new URL(req.url, 'http://localhost').search; await middlewares.get(pid)(request, buffered, () => fail(404, '角色接口不存在')) } finally { request.url = originalUrl }
      if (name) { if (status < 300 && req.method === 'POST') versions.set(versionKey, version + 1); headers['X-Mesh-Revision'] = String(versions.get(versionKey) || 0) }
      res.writeHead(status, headers); res.end(bytes)
    }
    if (req.method === 'GET') await operation(); else await enqueue(operation)
  }
  route('GET', pattern, studio); route('POST', pattern, studio)
  ctx.effect(() => async () => { stopped = true; await queue; roots.clear(); middlewares.clear() })
}
