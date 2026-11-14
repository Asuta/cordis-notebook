import { createRoot } from 'react-dom/client'
import { App } from './vendor/src/editor/App'

const originalFetch = window.fetch.bind(window), revisions = new Map<string, string>()
const session = new URLSearchParams(location.search).get('appSession') || ''
const storagePrefix = 'narrative-mesh:' + location.pathname + ':'
const getItem = Storage.prototype.getItem, setItem = Storage.prototype.setItem, removeItem = Storage.prototype.removeItem
Storage.prototype.getItem = function (key) { return getItem.call(this, storagePrefix + key) }
Storage.prototype.setItem = function (key, value) { return setItem.call(this, storagePrefix + key, value) }
Storage.prototype.removeItem = function (key) { return removeItem.call(this, storagePrefix + key) }
if (!localStorage.getItem('mesh-avatar-language')) localStorage.setItem('mesh-avatar-language', 'zh')
document.addEventListener('click', event => { const anchor = (event.target as Element)?.closest?.('a[href="./game-preview"]'); if (anchor) { event.preventDefault(); parent.postMessage({ channel: 'narrative-mesh', play: true }, location.origin) } })
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href)
  if (url.origin !== location.origin) return originalFetch(input, init)
  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
  if (url.pathname.endsWith('/__studio/import') && init?.body instanceof Blob) {
    const bytes = new Uint8Array(await init.body.arrayBuffer()); let binary = ''
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
    init = { ...init, body: JSON.stringify({ base64: btoa(binary) }) }; headers.set('Content-Type', 'application/json')
  }
  if (session) headers.set('X-Application-Session', session)
  const project = url.pathname.match(/\/__studio\/projects\/([^/]+)/)?.[1]
  if (project && revisions.has(project)) headers.set('X-Mesh-Revision', revisions.get(project)!)
  const result = await originalFetch(input, { ...init, headers })
  const revision = result.headers.get('X-Mesh-Revision')
  if (project && revision) revisions.set(project, revision)
  return result
}
createRoot(document.getElementById('root')!).render(<App />)
