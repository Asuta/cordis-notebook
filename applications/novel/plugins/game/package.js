import { strToU8, strFromU8, zipSync, unzipSync } from 'fflate'
import { validateProject, upgradeProject, syncLegacy } from './model.js'
import { validateModel } from './live2d/document.js'

const path = id => '/api/novel/projects/' + encodeURIComponent(id)
const encode = bytes => { let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(binary) }
const filename = title => title.replace(/[<>:"/\|?*\x00-\x1f]/g, '_').slice(0, 70) || '视觉小说'

export async function packageBytes(project, read = async url => { const r = await fetch(url); if (!r.ok) throw Error('无法读取作品文件'); return new Uint8Array(await r.arrayBuffer()) }) {
  const files = { 'project.json': strToU8(JSON.stringify(validateProject(project))) }
  for (const asset of project.assets) {
    const bytes = await read(path(project.id) + '/assets/' + encodeURIComponent(asset.id))
    if (bytes.length !== asset.size) throw Error('素材大小不匹配：' + asset.name)
    files['media/' + asset.id] = bytes
  }
  for (const summary of project.models || []) {
    const bytes = await read(path(project.id) + '/models/' + summary.id + '?revision=' + summary.revision)
    const model = validateModel(JSON.parse(strFromU8(bytes)), new Set(project.assets.filter(a => a.kind === 'image').map(a => a.id)))
    if (model.id !== summary.id || model.revision !== summary.revision) throw Error('角色模型版本不匹配')
    files['models/' + summary.id + '.json'] = bytes
    if (model.engine === 'mesh-avatar') files['models/' + summary.id + '.mavatar'] = await read(path(project.id) + '/models/' + summary.id + '/archive.mavatar?revision=' + summary.revision)
  }
  if (Object.values(files).reduce((n, b) => n + b.length, 0) > 384 * 1024 * 1024) throw Error('作品包内容不能超过 384 MB')
  return zipSync(files, { level: 0 })
}

export async function exportPackage(project) {
  const blob = new Blob([await packageBytes(project)], { type: 'application/zip' }), url = URL.createObjectURL(blob)
  const link = document.createElement('a'); link.href = url; link.download = filename(project.title) + '.novel.zip'; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

export async function importPackage(file, request) {
  if (file.size > 400 * 1024 * 1024) throw Error('作品包不能超过 400 MB')
  let files, expanded = 0, entries = 0
  try { files = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: entry => {
    if (entry.name !== 'project.json' && !/^media\/[a-z0-9-]{1,80}$/i.test(entry.name) && !/^models\/[a-z0-9-]{1,80}\.(json|mavatar)$/i.test(entry.name)) return false
    expanded += entry.originalSize; entries++
    if (expanded > 384 * 1024 * 1024 || entries > 861 || (entry.name === 'project.json' && entry.originalSize > 1024 * 1024) || (entry.name.endsWith('.json') && entry.name.startsWith('models/') && entry.originalSize > 12 * 1024 * 1024) || (entry.name.endsWith('.mavatar') && entry.originalSize > 64 * 1024 * 1024) || (entry.name.startsWith('media/') && entry.originalSize > 8 * 1024 * 1024)) throw Error('作品包解压后过大')
    return true
  } }) }
  catch { throw Error('无法读取作品包，请选择由本应用导出的 .novel.zip 文件') }
  let source
  try { source = validateProject(JSON.parse(strFromU8(files['project.json']))) }
  catch (error) { throw Error('作品数据无效：' + error.message) }
  const bytesTotal = project => project.assets.reduce((n, a) => n + a.size, 0)
  if (bytesTotal(source) > 256 * 1024 * 1024) throw Error('作品素材总量不能超过 256 MB')
  for (const asset of source.assets) if (!files['media/' + asset.id] || files['media/' + asset.id].length !== asset.size) throw Error('作品包缺少素材：' + asset.name)
  const models = new Map(), imageIds = new Set(source.assets.filter(a => a.kind === 'image').map(a => a.id))
  for (const summary of source.models || []) {
    const bytes = files['models/' + summary.id + '.json']; if (!bytes) throw Error('作品包缺少模型：' + summary.name)
    const m = validateModel(JSON.parse(strFromU8(bytes)), imageIds)
    if (m.id !== summary.id || m.revision !== summary.revision) throw Error('角色模型版本不匹配')
    if (m.engine === 'mesh-avatar' && !files['models/' + summary.id + '.mavatar']) throw Error('作品包缺少原生角色包：' + summary.name)
    models.set(m.id, m)
  }
  let created
  try {
    created = await request('/api/novel/projects', 'POST', { title: source.title })
    const mapping = new Map()
    for (const asset of source.assets) {
      const bytes = files['media/' + asset.id]
      created = await request(path(created.id) + '/assets', 'POST', { name: asset.name, mime: asset.mime, base64: encode(bytes) })
      mapping.set(asset.id, created.assets.at(-1).id)
    }
    const map = id => id ? mapping.get(id) || '' : ''
    const modelMapping = new Map()
    for (const [id, m] of models) {
      if (m.engine === 'mesh-avatar') {
        const result = await request(path(created.id) + '/mesh-avatars', 'POST', { name: m.name, base64: encode(files['models/' + id + '.mavatar']) })
        created = result.project; modelMapping.set(id, result.model.id); continue
      }
      m.sourceAssetId = map(m.sourceAssetId)
      for (const a of m.rig.assets) a.src = 'asset:' + map(a.src.slice(6))
      if (m.generation) for (const key of ['sourceAssetId', 'segmentationAssetId', 'repairAssetId', 'featureAssetId']) if (m.generation[key]) m.generation[key] = map(m.generation[key])
      const result = await request(path(created.id) + '/models', 'POST', { model: m })
      created = result.project; modelMapping.set(id, result.model.id)
    }
    const next = upgradeProject(source)
    next.id = created.id; next.revision = created.revision; next.assets = created.assets; next.models = created.models || []
    for (const character of next.cast) { character.portraitId = map(character.portraitId); if (character.modelId) character.modelId = modelMapping.get(character.modelId) || ''; for (const expression of character.expressions || []) expression.portraitId = map(expression.portraitId) }
    for (const scene of next.scenes) {
      scene.backgroundId = map(scene.backgroundId); scene.musicId = map(scene.musicId)
      for (const command of scene.commands) if (['background', 'music', 'sound'].includes(command.type)) command.assetId = map(command.assetId)
      for (const command of scene.commands) if (command.type === 'say' && command.voiceId) command.voiceId = map(command.voiceId)
      syncLegacy(scene)
    }
    return await request(path(created.id), 'PUT', next)
  } catch (error) {
    if (created) await request(path(created.id), 'DELETE').catch(() => {})
    throw error
  }
}
