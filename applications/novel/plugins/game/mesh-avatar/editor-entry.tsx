import { createRoot } from 'react-dom/client'
import { App } from './vendor/src/editor/App'

const originalFetch = window.fetch.bind(window), revisions = new Map<string, string>()
const session = new URLSearchParams(location.search).get('appSession') || ''
const storagePrefix = 'novel-mesh:' + location.pathname + ':'
const getItem = Storage.prototype.getItem, setItem = Storage.prototype.setItem, removeItem = Storage.prototype.removeItem
Storage.prototype.getItem = function (key) { return getItem.call(this, storagePrefix + key) }
Storage.prototype.setItem = function (key, value) { return setItem.call(this, storagePrefix + key, value) }
Storage.prototype.removeItem = function (key) { return removeItem.call(this, storagePrefix + key) }
if (!localStorage.getItem('mesh-avatar-language')) localStorage.setItem('mesh-avatar-language', 'zh')
document.addEventListener('click', event => { const anchor = (event.target as Element)?.closest?.('a[href="./game-preview"]'); if (anchor) { event.preventDefault(); parent.postMessage({ channel: 'novel-mesh', play: true }, location.origin) } })
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href)
  if (url.origin !== location.origin) return originalFetch(input, init)
  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
  if (session) headers.set('X-Application-Session', session)
  const project = url.pathname.match(/\/__studio\/projects\/([^/]+)/)?.[1]
  if (project && revisions.has(project)) headers.set('X-Mesh-Revision', revisions.get(project)!)
  const result = await originalFetch(input, { ...init, headers })
  const revision = result.headers.get('X-Mesh-Revision')
  if (project && revision) revisions.set(project, revision)
  return result
}
createRoot(document.getElementById('root')!).render(<App />)
