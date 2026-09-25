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
      const response = await fetch('/api/note-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      })
      const result = await response.json()
      if (!response.ok) throw Error(result.error)
      return result.src
    },
  })
}
