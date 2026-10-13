export const maxBackupBytes = 32 * 1024 * 1024
const assetPattern = /^\/api\/note-assets\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/
export function assetReferences(value, markdownImages = () => []) {
  const refs = new Set(), stack = [value]
  let count = 0
  while (stack.length) {
    const value = stack.pop()
    if (!value || typeof value !== 'object') continue
    if (++count > 2000000) throw Object.assign(Error('备份结构过大'), { status: 400 })
    for (const [key, item] of Object.entries(value)) {
      if (['src', 'url'].includes(key) && typeof item === 'string' && item.startsWith('/api/note-assets/')) {
        if (!assetPattern.test(item)) throw Object.assign(Error('笔记包含无效的本地图片地址'), { status: 400 })
        refs.add(item)
      } else if (key === 'markdown' && typeof item === 'string') {
        for (const src of markdownImages(item)) if (src.startsWith('/api/note-assets/')) {
          if (!assetPattern.test(src)) throw Object.assign(Error('笔记包含无效的本地图片地址'), { status: 400 })
          refs.add(src)
        }
      } else if (item && typeof item === 'object') stack.push(item)
    }
  }
  if (refs.size > 2000) throw Object.assign(Error('一次最多备份 2000 张本地图片'), { status: 400 })
  return [...refs]
}
export function readBackup(value) {
  if (!value || typeof value !== 'object' || value.version !== 1) throw Error('备份格式或版本无效')
  if (value.format === 'cordis-note' && value.note) return { notes: [{ ...value.note, parentId: null }], assets: [], legacy: true }
  if (value.format !== 'cordis-notebook-backup' || !Array.isArray(value.notes) || !Array.isArray(value.assets)) throw Error('请选择 Cordis 笔记备份文件')
  if (!value.notes.length || value.notes.length > 1000 || value.assets.length > 2000) throw Error('备份为空或内容过多')
  return { notes: value.notes, assets: value.assets, legacy: false }
}
