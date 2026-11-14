import { mkdir, cp, readFile, writeFile, readdir, lstat } from 'node:fs/promises'
import { join, resolve, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { localProjectMiddleware, revealFolder, JobError } from './compiled/server.js'
import { unpackAvatar, packAvatar, validateAvatarFiles, parseManifest } from './compiled/runtime.js'
import { meshModel } from './document.js'

const fail = (status, message) => { throw Object.assign(Error(message), { status }) }
const safe = value => typeof value === 'string' && /^[a-z0-9-]{1,80}$/i.test(value)
const decode = bytes => JSON.parse(new TextDecoder().decode(bytes))
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
async function body(req) {
  const chunks = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > 90 * 1024 * 1024) fail(413, '角色包请求过大'); chunks.push(chunk) }
  try { return JSON.parse(Buffer.concat(chunks).toString()) } catch { fail(400, '角色包 JSON 无效') }
}
async function readTree(folder, prefix = '', result = Object.create(null)) {
  for (const item of await readdir(folder, { withFileTypes: true })) {
    const name = prefix + item.name, path = join(folder, item.name)
    if (item.isSymbolicLink()) fail(400, '角色工程不能包含重定向文件')
    if (item.name.startsWith('.') || item.name.endsWith('.bak')) continue
    if (item.isDirectory()) await readTree(path, name + '/', result)
    else if (item.isFile() && ['.png', '.json', '.md', '.txt'].includes(extname(item.name))) result[name] = await readFile(path)
  }
  return result
}
function validateFiles(files) {
  const issues = validateAvatarFiles(files)
  if (!files['avatar.json']) issues.push('缺少 avatar.json')
  if (issues.length) fail(400, '角色包无效：' + issues.join('; '))
  if (Object.values(files).reduce((n, b) => n + b.length, 0) > 64 * 1024 * 1024) fail(413, '角色包不能超过 64 MB')
  for (const name of Object.keys(files)) {
    const parts = name.split('/')
    if (parts.some(p => !/^[a-z0-9_.-]+$/i.test(p) || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) fail(400, '角色包文件路径无效')
  }
}

export function registerMeshServer({ route, projectDir, readProject, getModel, writeModel, enqueue, resources }) {
  const vendor = fileURLToPath(new URL('vendor/', resources)), compiled = fileURLToPath(new URL('compiled/', resources))
  const roots = new Map(), middlewares = new Map()
  const root = pid => join(projectDir(pid), 'mesh-studio')
  const folder = (pid, name) => join(root(pid), 'projects', name)
  const snapshotFile = (pid, mid, revision) => join(projectDir(pid), 'models', mid, revision + '.mavatar')
  async function init(pid) {
    if (!roots.has(pid)) roots.set(pid, (async () => {
      await readProject(pid)
      await mkdir(join(root(pid), 'projects'), { recursive: true })
      await cp(join(vendor, 'samples/miko-qipao'), join(root(pid), 'samples/miko-qipao'), { recursive: true, force: false, errorOnExist: false })
    })().catch(error => { roots.delete(pid); throw error }))
    await roots.get(pid)
  }
  async function publish(pid, name, options = {}) {
    if (!safe(name)) fail(400, '游戏内角色工程名称只支持字母、数字和连字符')
    const p = await readProject(pid), summary = (p.models || []).find(m => m.engine === 'mesh-avatar' && m.editorProject === (options.previousName || name))
    if (!summary && (p.models?.length || 0) >= 30) fail(400, '每部作品最多 30 个模型')
    if (options.expectedRevision !== undefined && options.expectedRevision !== summary?.revision) fail(409, '角色已在其他页面修改，请重新载入')
    const files = await readTree(folder(pid, name)); validateFiles(files)
    const archive = packAvatar(files), hash = digest(archive)
    if (summary) {
      const previous = await readFile(snapshotFile(pid, summary.id, summary.revision))
      if (digest(previous) === hash && summary.editorProject === name) return { project: p, model: await getModel(pid, summary.id) }
    }
    const id = summary?.id || crypto.randomUUID(), revision = (summary?.revision || 0) + 1
    const manifest = parseManifest(decode(files['avatar.json']))
    const model = meshModel({ id, name: options.name || summary?.name || manifest.name, revision, editorProject: name, nativeRig: decode(files['rig.json']), manifest })
    await mkdir(join(projectDir(pid), 'models', id), { recursive: true })
    await writeFile(snapshotFile(pid, id, revision), archive, { flag: 'wx' })
    return writeModel(p, model)
  }
  async function importFiles(pid, files, name) {
    validateFiles(files); await init(pid)
    const editorProject = crypto.randomUUID(), path = folder(pid, editorProject)
    await mkdir(path)
    for (const [name, bytes] of Object.entries(files)) {
      const target = resolve(path, name)
      if (relative(path, target).startsWith('..')) fail(400, '角色路径无效')
      await mkdir(resolve(target, '..'), { recursive: true }); await writeFile(target, bytes, { flag: 'wx' })
    }
    return publish(pid, editorProject, { name })
  }
  const createMiko = async pid => importFiles(pid, await readTree(join(vendor, 'samples/miko-qipao')), 'Miko · 旗袍')
  const createShion = async pid => importFiles(pid, await readTree(fileURLToPath(new URL('../assets/avatar/shion/', resources))), '汐音 · 月下听潮')

  route('POST', /^\/api\/novel\/projects\/([a-z0-9-]{1,80})\/mesh-avatars$/, async ({ match, req }) => {
    const input = await body(req)
    if (typeof input.base64 !== 'string' || !/^[a-z0-9+/]*={0,2}$/i.test(input.base64)) fail(400, '角色包编码无效')
    const archive = Buffer.from(input.base64, 'base64'); if (archive.length > 64 * 1024 * 1024) fail(413, '角色包过大')
    let files; try { files = unpackAvatar(archive) } catch (e) { fail(400, e.message) }
    return enqueue(() => importFiles(match[1], files, String(input.name || decode(files['avatar.json']).name).slice(0, 120)))
  })
  route('POST', /^\/api\/novel\/projects\/([a-z0-9-]{1,80})\/mesh-avatars\/adopt$/, async ({ match, req }) => {
    const input = await body(req); return enqueue(() => publish(match[1], input.editorProject, { name: input.name, expectedRevision: input.expectedRevision }))
  })
  route('GET', /^\/api\/novel\/projects\/([a-z0-9-]{1,80})\/models\/([a-z0-9-]{1,80})\/archive\.mavatar$/, async ({ match, req, res }) => {
    const m = await getModel(match[1], match[2], new URL(req.url, 'http://localhost').searchParams.get('revision') || undefined)
    if (m.engine !== 'mesh-avatar') fail(400, '此模型不是 Mesh Avatar')
    const bytes = await readFile(snapshotFile(match[1], m.id, m.revision))
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length, 'Cache-Control': 'private, max-age=3600' }); res.end(bytes)
  })
  const pattern = /^\/api\/novel\/projects\/([a-z0-9-]{1,80})\/mesh-studio\/(.*)$/
  async function studio({ match, req, res }) {
    const pid = match[1], tail = match[2]; await init(pid)
    if (tail === 'editor.html') {
      const html = '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>角色工作室 · Mesh Avatar Studio</title><link rel="stylesheet" href="studio.css"><div id="root"></div><script type="module" src="studio.js"></script></html>'
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); return
    }
    if (tail === 'game-preview') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<script>parent.postMessage({channel:"novel-mesh",play:true},location.origin)</script>'); return
    }
    if (tail === 'studio.js' || tail === 'studio.css') {
      const bytes = await readFile(join(compiled, tail)); res.writeHead(200, { 'Content-Type': tail.endsWith('.js') ? 'text/javascript' : 'text/css' }); res.end(bytes); return
    }
    if (tail.startsWith('miko-qipao/')) {
      const name = tail.slice('miko-qipao/'.length)
      if (name.split('/').some(p => !/^[a-z0-9_.-]+$/i.test(p) || p === '.' || p === '..')) fail(400, '素材路径无效')
      const bytes = await readFile(join(vendor, 'samples/miko-qipao', name)).catch(error => { if (error.code === 'ENOENT') fail(404, '角色素材不存在'); throw error })
      res.writeHead(200, { 'Content-Type': name.endsWith('.png') ? 'image/png' : name.endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8' }); res.end(bytes); return
    }
    if (!tail.startsWith('__studio/')) fail(404, '角色工作室资源不存在')
    if (!middlewares.has(pid)) {
      const runner = (_, project, tool) => new Promise((done, reject) => {
        const args = ['run', '--no-project', '--no-python-downloads', '--python', '>=3.10,<3.14', '--with', 'numpy', '--with', 'pillow', '--with', 'opencv-python-headless', join(vendor, 'tools', tool + '.py'), project]
        execFile('uv', args, { cwd: root(pid), timeout: 120000, maxBuffer: 2 * 1024 * 1024 }, (error, out, err) => { const log = (out + '\n' + err).slice(-12000); if (error) reject(new JobError(error.code === 'ENOENT' ? 'dependencies' : 'toolFailed', log)); else done(log) })
      })
      middlewares.set(pid, localProjectMiddleware(root(pid), revealFolder, runner))
    }
    const operation = async () => {
      const p = await readProject(pid), name = tail.match(/^__studio\/projects\/([^/]+)\//)?.[1]
      let summary = p.models?.find(m => m.engine === 'mesh-avatar' && m.editorProject === name)
      if (req.method !== 'GET' && summary && Number(req.headers['x-mesh-revision']) !== summary.revision) fail(409, '角色已在其他页面修改，请重新载入；当前编辑仍保留')
      const originalUrl = req.url, url = new URL(req.url, 'http://localhost')
      let status = 200, headers = {}, bytes
      const buffered = { writeHead(code, value) { status = code; headers = value; return this }, end(value) { bytes = value } }
      try { req.url = '/' + tail + url.search; await middlewares.get(pid)(req, buffered, () => fail(404, '角色接口不存在')) } finally { req.url = originalUrl }
      if (status < 300 && req.method === 'POST' && summary && /\/(rig|lip-sync|rebuild|import-variants|rename)$/.test(tail)) {
        const nextName = tail.endsWith('/rename') ? JSON.parse(bytes).name : name
        const saved = await publish(pid, nextName, { previousName: name }); summary = saved.project.models.find(m => m.id === summary.id)
      }
      if (summary) headers['X-Mesh-Revision'] = String(summary.revision)
      res.writeHead(status, headers); res.end(bytes)
    }
    if (req.method === 'GET') await operation(); else await enqueue(operation)
  }
  route('GET', pattern, studio); route('POST', pattern, studio)
  return { createMiko, createShion }
}
