import { checkAbort, resourceURL, untilAborted } from './helpers.js'

// An individual model owns its requests. No global fetch/XHR patches, Pixi
// shared loader, shared texture URL, or uncancellable remote image downloads.
export function createResources(signal, base, fetcher = fetch) {
  const cache = new Map(), objectURLs = new Set()
  let disposed = false
  async function read(path, type = 'json') {
    checkAbort(signal)
    const url = resourceURL(path, base)
    const key = `${type}:${url}`
    if (!cache.has(key)) cache.set(key, (async () => {
      const response = await fetcher(url, { signal, mode: 'cors', credentials: 'same-origin' })
      if (!response.ok) throw Error(`Live2D 资源请求失败（HTTP ${response.status}）：${new URL(url).pathname}`)
      const data = await (type === 'arraybuffer' ? response.arrayBuffer() : type === 'blob' ? response.blob() : type === 'text' ? response.text() : response.json())
      checkAbort(signal)
      return data
    })())
    return untilAborted(cache.get(key), signal)
  }
  return {
    read,
    async image(path) {
      const blob = await read(path, 'blob')
      checkAbort(signal)
      if (disposed) throw Error('Live2D 资源已释放')
      const url = URL.createObjectURL(blob); objectURLs.add(url); return url
    },
    dispose() { disposed = true; for (const url of objectURLs) URL.revokeObjectURL(url); objectURLs.clear(); cache.clear() },
  }
}
