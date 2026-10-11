import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function pluginInventory(root = resolve('.')) {
  const lines = ['# 应用插件清单', '', '由 `pnpm docs:inventory` 从应用和插件清单生成；测试会检查是否过期。默认启用只描述新数据目录，已有用户的开关以保存状态为准。', '', '| 应用 | 插件总数 | 默认启用 | 默认停用 |', '| --- | ---: | ---: | ---: |']
  for (const folder of (await readdir(join(root, 'applications'))).sort()) {
    const app = join(root, 'applications', folder), pkg = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'))
    const plugins = []
    for (const entry of (await readdir(join(app, 'plugins'))).sort()) {
      if (entry.startsWith('.') || entry === 'node_modules') continue
      try { const value = JSON.parse(await readFile(join(app, 'plugins', entry, 'package.json'), 'utf8')); if (value.cordis) plugins.push(value.cordis) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    const enabled = plugins.filter(plugin => plugin.defaultEnabled).length
    lines.push(`| ${pkg.cordisApp.name}（${pkg.cordisApp.id}） | ${plugins.length} | ${enabled} | ${plugins.length - enabled} |`)
  }
  return lines.join('\n') + '\n'
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await writeFile(resolve('docs/应用插件清单.md'), await pluginInventory())
  console.log('已更新应用插件清单')
}
