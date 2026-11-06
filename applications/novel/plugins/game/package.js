import { strToU8, strFromU8, zipSync, unzipSync } from 'fflate'
import { validateProject } from './model.js'

const path = id => '/api/novel/projects/' + encodeURIComponent(id)
const encode = bytes => { let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(binary) }
const filename = title => title.replace(/[<>:"/\|?*\x00-\x1f]/g, '_').slice(0, 70) || '视觉小说'

export async function exportPackage(project) {
  const files = { 'project.json': strToU8(JSON.stringify(validateProject(project))) }
  for (const asset of project.assets) {
    const response = await fetch(path(project.id) + '/assets/' + encodeURIComponent(asset.id))
    if (!response.ok) throw Error('无法读取素材：' + asset.name)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length !== asset.size) throw Error('素材大小不匹配：' + asset.name)
    files['media/' + asset.id] = bytes
  }
  const blob = new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }), url = URL.createObjectURL(blob)
  const link = document.createElement('a'); link.href = url; link.download = filename(project.title) + '.novel.zip'; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

export async function importPackage(file, request) {
  if (file.size > 70 * 1024 * 1024) throw Error('作品包不能超过 70 MB')
  let files, expanded = 0, entries = 0
  try { files = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: entry => {
    if (entry.name !== 'project.json' && !/^media\/[a-z0-9-]{1,80}$/i.test(entry.name)) return false
    expanded += entry.originalSize; entries++
    if (expanded > 51 * 1024 * 1024 || entries > 101 || (entry.name === 'project.json' && entry.originalSize > 1024 * 1024)) throw Error('作品包解压后过大')
    return true
  } }) }
  catch { throw Error('无法读取作品包，请选择由本应用导出的 .novel.zip 文件') }
  let source
  try { source = validateProject(JSON.parse(strFromU8(files['project.json']))) }
  catch (error) { throw Error('作品数据无效：' + error.message) }
  const bytesTotal = project => project.assets.reduce((n, a) => n + a.size, 0)
  if (bytesTotal(source) > 50 * 1024 * 1024) throw Error('作品素材总量不能超过 50 MB')
  for (const asset of source.assets) if (!files['media/' + asset.id] || files['media/' + asset.id].length !== asset.size) throw Error('作品包缺少素材：' + asset.name)
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
    const next = structuredClone(source)
    next.id = created.id; next.revision = created.revision; next.assets = created.assets
    for (const character of next.cast) character.portraitId = map(character.portraitId)
    for (const scene of next.scenes) { scene.backgroundId = map(scene.backgroundId); scene.musicId = map(scene.musicId) }
    return await request(path(created.id), 'PUT', next)
  } catch (error) {
    if (created) await request(path(created.id), 'DELETE').catch(() => {})
    throw error
  }
}
