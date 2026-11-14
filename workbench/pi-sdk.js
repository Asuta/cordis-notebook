import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

let sdk
export function loadPi() {
  return sdk ||= load()
}

// Reuse Pi's published bundle to avoid hundreds of Windows filesystem stats.
async function load() {
  try {
    const entry = import.meta.resolve('@earendil-works/pi-coding-agent')
    if (entry.startsWith('file:')) {
      const module = await import(pathToFileURL(join(dirname(fileURLToPath(entry)), 'bundle', 'index.js')).href)
      if (['createAgentSession', 'ModelRuntime', 'SessionManager', 'SettingsManager', 'DefaultResourceLoader', 'loadSkills']
        .every(name => typeof module[name] === 'function')) return module
    }
  } catch {}
  return import('@earendil-works/pi-coding-agent')
}
