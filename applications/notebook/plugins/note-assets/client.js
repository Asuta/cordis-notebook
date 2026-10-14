export default function (ctx, sdk) {
  sdk.provide('noteAssets', {
    async uploadAttachment(file) {
      if (file.type.startsWith('image/')) return this.upload(file)
      if (!file.size || file.size > 16 * 1024 * 1024) throw Error('附件不能为空或超过 16 MB')
      const known = { 'application/pdf': 'pdf', 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'video/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav' }
      const extension = known[file.type] || 'bin'
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file)
      })
      return (await sdk.request('/api/note-files', 'POST', { data, extension })).src
    },
    async upload(file) {
      if (file.size > 1048576) throw Error('单张图片不能超过 1 MB')
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const result = await sdk.request('/api/note-assets', 'POST', { data })
      return result.src
    },
  })
}
