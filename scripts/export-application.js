import { mkdir, cp, writeFile, readFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverApplications, defaultApplicationsDir } from '../server/application-discovery.js'
import { discoverBuiltins } from '../server/plugin-discovery.js'
import { exportPlugins } from './export-plugins.js'

/** A new catalog directory containing one complete application, without user data. */
export async function exportApplication(id, destination, applicationsDir = defaultApplicationsDir) {
  const app = (await discoverApplications(applicationsDir)).find(item => item.id === id)
  if (!app || app.error) throw Error(app?.error || '应用不存在：' + id)
  await discoverBuiltins(app.pluginsDir, { mode: 'runtime' })
  const output = resolve(destination), folder = join(output, id)
  await mkdir(output)
  await mkdir(folder)
  const pkg = JSON.parse(await readFile(join(app.root, 'package.json'), 'utf8'))
  await writeFile(join(folder, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: 'module', cordisApp: pkg.cordisApp }, null, 2) + '\n')
  if (app.icon) { await mkdir(dirname(join(folder, app.icon)), { recursive: true }); await cp(join(app.root, app.icon), join(folder, app.icon)) }
  await exportPlugins(join(folder, 'plugins'), app.pluginsDir, { workspace: false })
  await writeFile(join(output, 'package.json'), JSON.stringify({ name: 'cordis-application-release', private: true, type: 'module' }, null, 2) + '\n')
  await writeFile(join(output, 'pnpm-workspace.yaml'), "packages:\n  - '*'\n  - '*/plugins/*'\n")
  return output
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2] || !process.argv[3]) throw Error('用法：pnpm export:app <应用ID> <尚不存在的输出目录>')
  console.log(await exportApplication(process.argv[2], process.argv[3]))
}
