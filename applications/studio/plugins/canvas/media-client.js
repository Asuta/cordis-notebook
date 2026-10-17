export const mediaKind = asset => asset?.kind === 'video' ? 'video' : 'image'
export const mediaUrl = asset => mediaKind(asset) === 'video' ? `/api/studio/videos/${asset.id}` : `/api/studio/images/${asset.id}.webp`
const base64 = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(Error('无法读取文件')); reader.readAsDataURL(file) })
export async function uploadMedia(file, api, signal, progress = () => {}) {
  const video = /^(video\/)|\.(mp4|webm)$/i.test(file.type || file.name) || /\.(mp4|webm)$/i.test(file.name)
  if (!file.size || file.size > (video ? 200 : 20) * 1024 * 1024) throw Error(video ? '视频需小于 200 MB' : '图片需小于 20 MB')
  const check = () => { if (signal?.aborted) throw Error('上传已停止') }
  check()
  if (!video) { const data = await base64(file); check(); return api('/upload', { name: file.name, base64: data }) }
  const { id } = await api('/media/uploads', { name: file.name, size: file.size })
  try {
    for (let offset = 0; offset < file.size; offset += 1024 * 1024) {
      check(); const part = file.slice(offset, offset + 1024 * 1024)
      await api('/media/uploads/' + id, { offset, base64: await base64(part) }); progress(Math.round(Math.min(file.size, offset + part.size) / file.size * 100))
    }
    check(); return await api('/media/uploads/' + id + '/finish', {})
  } catch (error) { await api('/media/uploads/' + id + '/abort', {}).catch(() => {}); throw error }
}
