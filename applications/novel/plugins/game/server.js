import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { blankProject, validateProject } from './model.js'
import { demoProject } from './demo.js'
import { registerModelServer } from './live2d/server.js'
import { avatarDemo } from './live2d/demo.js'
import { registerMeshServer } from './mesh-avatar/server.js'
import { mikoDemo, shionDemo } from './mesh-avatar/demo.js'

const fail = (status, message) => { throw Object.assign(Error(message), { status }) }
const idOK = id => typeof id === 'string' && /^[a-z0-9-]{1,80}$/i.test(id)
const media = [
  ['observatory', 'observatory.png'], ['station', 'station.png'], ['lin', 'lin.png'],
  ['yao', 'yao.png'], ['rain-theme', 'rain-theme.wav'], ['signal-cue', 'signal-cue.wav'],
]
function checkMedia(bytes, mime) {
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) fail(413, '单个素材不能超过 8 MB')
  const head = bytes.subarray(0, 12).toString('ascii')
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (mime === 'image/webp') return head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP'
  if (mime === 'audio/wav') return head.startsWith('RIFF') && head.slice(8, 12) === 'WAVE'
  if (mime === 'audio/mpeg') return head.startsWith('ID3') || (bytes[0] === 255 && (bytes[1] & 224) === 224)
  if (mime === 'audio/ogg') return head.startsWith('OggS')
  return false
}
async function uploadBody(req) {
  let size = 0; const chunks = []
  for await (const chunk of req) { size += chunk.length; if (size > 11 * 1024 * 1024) fail(413, '上传请求不能超过 11 MB'); chunks.push(chunk) }
  try { return JSON.parse(Buffer.concat(chunks).toString()) } catch { fail(400, '上传 JSON 格式无效') }
}

export default async function (ctx, config, runtime) {
  const root = runtime.dataDir, indexFile = join(root, 'projects.json'), projectDir = id => join(root, 'projects', id), projectFile = id => join(projectDir(id), 'project.json')
  await mkdir(join(root, 'projects'), { recursive: true })
  let index, queue = Promise.resolve()
  const enqueue = task => { const run = queue.then(task); queue = run.catch(() => {}); return run }
  const saveIndex = () => runtime.writeSnapshot(indexFile, JSON.stringify(index))
  const read = async id => {
    if (!idOK(id) || !index.projects.some(p => p.id === id)) fail(404, '作品不存在')
    return validateProject(JSON.parse(await readFile(projectFile(id), 'utf8')))
  }
  const save = async project => { validateProject(project); await runtime.writeSnapshot(projectFile(project.id), JSON.stringify(project)); return structuredClone(project) }
  const summary = p => ({ id: p.id, title: p.title, description: p.description, scenes: p.scenes.length, coverId: p.scenes.find(s => s.id === p.startSceneId)?.backgroundId || '', updatedAt: new Date().toISOString() })
  async function createDemo(id) {
    const sizes = {}, folder = projectDir(id)
    await mkdir(join(folder, 'media'), { recursive: true })
    for (const [assetId, filename] of media) {
      const bytes = await readFile(fileURLToPath(new URL('./assets/' + filename, import.meta.url)))
      sizes[assetId] = bytes.length; await writeFile(join(folder, 'media', assetId), bytes)
    }
    const demo = demoProject(sizes); demo.id = id; await save(demo); return demo
  }
  try { index = JSON.parse(await readFile(indexFile, 'utf8')); if (!Array.isArray(index.projects)) throw Error('作品索引无效') }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    const demo = await createDemo('rain-afterglow')
    index = { schemaVersion: 1, projects: [summary(demo)] }; await saveIndex()
  }
  ctx.effect(() => () => queue)
  const route = (method, pattern, handler) => ctx.http.route(ctx, method, pattern, handler)
  const modelServer = registerModelServer({ ctx, runtime, route, readProject: read, saveProject: save, projectDir, enqueue, saveIndexProject: async p => { index.projects = [summary(p), ...index.projects.filter(x => x.id !== p.id)]; await saveIndex() } })
  const meshServer = registerMeshServer({ route, projectDir, readProject: read, ...modelServer, enqueue, resources: new URL('./mesh-avatar/', import.meta.url) })
  route('POST', /^\/api\/novel\/miko-demo$/, () => enqueue(async () => {
    if (index.projects.length >= 50) fail(400, '最多创建 50 部作品')
    const id = crypto.randomUUID(), original = await createDemo(id)
    index.projects.unshift(summary(original)); await saveIndex()
    const result = await meshServer.createMiko(id)
    const p = mikoDemo(result.project, result.model); p.revision = result.project.revision + 1
    await save(p); index.projects = [summary(p), ...index.projects.filter(x => x.id !== p.id)]; await saveIndex(); return p
  }))
  route('POST', /^\/api\/novel\/shion-demo$/, () => enqueue(async () => {
    if (index.projects.length >= 50) fail(400, '最多创建 50 部作品')
    const id = crypto.randomUUID(), original = await createDemo(id)
    index.projects.unshift(summary(original)); await saveIndex()
    const result = await meshServer.createShion(id)
    const p = shionDemo(result.project, result.model); p.revision = result.project.revision + 1
    await save(p); index.projects = [summary(p), ...index.projects.filter(x => x.id !== p.id)]; await saveIndex(); return p
  }))
  route('GET', /^\/api\/novel\/projects$/, () => structuredClone(index.projects))
  route('POST', /^\/api\/novel\/avatar-demo$/, () => enqueue(async () => {
    if (index.projects.length >= 50) fail(400, '最多创建 50 部作品')
    const id = crypto.randomUUID(), folder = projectDir(id), original = await createDemo(id)
    const base = new URL('./assets/avatar/', import.meta.url), assets = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8')), model = JSON.parse(await readFile(new URL('model.json', base), 'utf8'))
    for (const a of assets) { const bytes = await readFile(new URL(a.id + '.png', base)); await writeFile(join(folder, 'media', a.id), bytes) }
    await mkdir(join(folder, 'models', model.id), { recursive: true }); await runtime.writeSnapshot(join(folder, 'models', model.id, '1.json'), JSON.stringify(model))
    const p = avatarDemo(id, [...original.assets, ...assets], model); await save(p); index.projects.unshift(summary(p)); await saveIndex(); return p
  }))
  route('POST', /^\/api\/novel\/demo$/, () => enqueue(async () => {
    if (index.projects.length >= 50) fail(400, '最多创建 50 部作品')
    const p = await createDemo(crypto.randomUUID()); index.projects.unshift(summary(p)); await saveIndex(); return p
  }))
  route('POST', /^\/api\/novel\/projects$/, async ({ req }) => enqueue(async () => {
    const input = await ctx.http.body(req)
    if (index.projects.length >= 50) fail(400, '最多创建 50 部作品')
    const title = String(input.title || '').trim().slice(0, 120)
    if (!title) fail(400, '请输入作品名称')
    const p = blankProject(title)
    await mkdir(join(projectDir(p.id), 'media'), { recursive: true }); await save(p)
    index.projects.unshift(summary(p)); await saveIndex(); return p
  }))
  route('GET', /^\/api\/novel\/projects\/([a-z0-9-]{1,80})$/, ({ match }) => read(match[1]))
  route('PUT', /^\/api\/novel\/projects\/([a-z0-9-]{1,80})$/, async ({ match, req }) => enqueue(async () => {
    const current = await read(match[1]), next = validateProject(await ctx.http.body(req))
    if (next.id !== current.id || next.revision !== current.revision) fail(409, '作品已被其他页面修改，请重新载入')
    if (JSON.stringify(next.assets) !== JSON.stringify(current.assets)) fail(400, '素材清单只能通过上传接口修改')
    if (JSON.stringify(next.models || []) !== JSON.stringify(current.models || [])) fail(400, '模型清单只能通过角色工作室修改')
    next.revision++; await save(next)
    index.projects = [summary(next), ...index.projects.filter(p => p.id !== next.id)]; await saveIndex(); return next
  }))
  route('DELETE', /^\/api\/novel\/projects\/([a-z0-9-]{1,80})$/, ({ match }) => enqueue(async () => {
    const id = match[1]; await read(id)
    index.projects = index.projects.filter(p => p.id !== id); await saveIndex()
    await rm(projectDir(id), { recursive: true, force: true }); return { deleted: id }
  }))
  route('POST', /^\/api\/novel\/projects\/([a-z0-9-]{1,80})\/assets$/, async ({ match, req }) => {
    const input = await uploadBody(req)
    return enqueue(async () => {
      const p = await read(match[1]); if (p.assets.length >= 800) fail(400, '最多上传 800 个素材')
      if (!input || typeof input.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)) fail(400, '素材编码无效')
      const bytes = Buffer.from(input.base64, 'base64'), name = String(input.name || '').trim().slice(0, 120), mime = input.mime
      if (!name || !checkMedia(bytes, mime)) fail(400, '素材格式或内容无效')
      const id = crypto.randomUUID(), kind = mime.startsWith('image/') ? 'image' : 'audio'
      await writeFile(join(projectDir(p.id), 'media', id), bytes, { flag: 'wx' })
      p.assets.push({ id, name, kind, mime, size: bytes.length }); p.revision++
      try { await save(p) } catch (error) { await rm(join(projectDir(p.id), 'media', id), { force: true }); throw error }
      index.projects = [summary(p), ...index.projects.filter(item => item.id !== p.id)]; await saveIndex(); return p
    })
  })
  route('GET', /^\/api\/novel\/projects\/([a-z0-9-]{1,80})\/assets\/([a-z0-9-]{1,80})$/, async ({ match, res }) => {
    const p = await read(match[1]), a = p.assets.find(a => a.id === match[2])
    if (!a) fail(404, '素材不存在')
    const file = join(projectDir(p.id), 'media', a.id), info = await stat(file)
    if (info.size !== a.size) fail(500, '素材文件已损坏')
    res.writeHead(200, { 'Content-Type': a.mime, 'Content-Length': info.size, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' })
    res.end(await readFile(file))
  })
}
