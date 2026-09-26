export default function (ctx, sdk) {
  sdk.provide('noteAssets', {
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
