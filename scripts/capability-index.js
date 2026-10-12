import { writeFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverApplications } from '../server/application-discovery.js'
import { discoverBuiltins } from '../server/plugin-discovery.js'
import { capabilitiesOf } from '../shared/capabilities.js'

export async function capabilityIndex(root = resolve('.')) {
  const rows = ['# 插件能力索引', '', '由 `pnpm docs:capabilities` 从提供者清单生成。这里只描述能力契约；实时提供者状态请查询 `/api/capabilities`，前端状态需由页面核对。', '', '| 应用 | 提供者 | 能力 | 说明 | 契约 |', '| --- | --- | --- | --- | --- |']
  const cell = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
  for (const app of await discoverApplications(resolve(root, 'applications'))) {
    if (app.error) throw Error(app.error)
    for (const entry of await discoverBuiltins(app.pluginsDir, { mode: 'development' })) for (const capability of capabilitiesOf(entry.manifest)) {
      const links = capability.contracts.map(file => `[${cell(file)}](${relative(resolve(root, 'docs'), resolve(entry.sourceRoot, file)).replaceAll('\\', '/')})`).join('、')
      rows.push(`| ${cell(app.id)} | ${cell(entry.manifest.id)} | ${cell(capability.key)} | ${cell(capability.description)} | ${links} |`)
    }
  }
  return rows.join('\n') + '\n'
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await writeFile(resolve('docs/插件能力索引.md'), await capabilityIndex())
