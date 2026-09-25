import { mkdir, cp, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverBuiltins, defaultPluginsDir } from '../server/plugin-discovery.js'

/** Export built runtime packages only. Destination must not already exist. */
export async function exportPlugins(destination, pluginsDir = defaultPluginsDir) {
  const entries = await discoverBuiltins(pluginsDir, { mode: 'runtime' })
  const output = resolve(destination)
  await mkdir(output, { recursive: false })
  await writeFile(join(output, 'package.json'), JSON.stringify({ name:'cordis-runtime-plugins', private:true, type:'module' }, null, 2) + '\n')
  await writeFile(join(output, 'pnpm-workspace.yaml'), "packages:\n  - '*'\n")
  for (const entry of entries) {
    const folder = join(output, entry.manifest.id)
    await mkdir(folder)
    await cp(entry.assetRoot, join(folder, 'dist'), { recursive: true, dereference: true })
    const { build, ...cordis } = entry.package.cordis
    // Workspace references are public types, never runtime implementation imports.
    const dependencies = Object.fromEntries(Object.entries(entry.package.dependencies || {}).filter(([, version]) => !version.startsWith('workspace:')))
    const pkg = { name: entry.package.name, version: entry.package.version, private: true, type: 'module', dependencies, cordis }
    await writeFile(join(folder, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  }
  return output
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('用法：pnpm export:plugins <尚不存在的输出目录>')
  console.log(await exportPlugins(process.argv[2]))
}
