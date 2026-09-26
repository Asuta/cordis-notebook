import { readdir, readFile, realpath } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const defaultApplicationsDir = fileURLToPath(new URL('../applications/', import.meta.url))
const validPath = value => typeof value === 'string' && /^[\w-][\w./-]*$/.test(value) && value.split('/').every(p => p && !p.startsWith('.'))

/** Discover application metadata only. Never inspect or execute inactive plugins. */
export async function discoverApplications(directory = defaultApplicationsDir) {
  const root = await realpath(directory), applications = []
  for (const folder of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!folder.isDirectory() || folder.name.startsWith('.') || folder.name === 'node_modules') continue
    const path = resolve(root, folder.name)
    try {
      const pkg = JSON.parse(await readFile(resolve(path, 'package.json'), 'utf8')), app = pkg.cordisApp
      if (!app || app.id !== folder.name || !/^[a-z][a-z0-9-]{1,49}$/.test(app.id) || typeof app.name !== 'string' || !app.name.trim()) throw Error('应用 ID 必须与目录一致，并提供名称')
      if (app.icon) {
        if (!validPath(app.icon)) throw Error('应用图标路径无效')
        const icon = await realpath(resolve(path, app.icon))
        if (!icon.startsWith(path + sep)) throw Error('应用图标超出目录')
      }
      if (app.legacyData && (!Array.isArray(app.legacyData) || app.legacyData.some(p => !validPath(p) || p.includes('/')))) throw Error('旧数据迁移只支持根目录内的文件或目录')
      applications.push({ ...app, root: path, pluginsDir: resolve(path, 'plugins') })
    } catch (error) {
      applications.push({ id: folder.name, name: folder.name, root: path, error: error.message })
    }
  }
  return applications
}

export async function defaultPluginDirectory() {
  const apps = (await discoverApplications()).filter(app => !app.error)
  const app = apps.find(app => app.default) || apps[0]
  if (!app) throw Error('没有可用的应用目录')
  return app.pluginsDir
}
