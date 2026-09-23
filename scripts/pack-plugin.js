import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join, relative } from 'node:path'
import { validatePackage } from '../src/plugins.js'
const folder = resolve(process.argv[2] || 'examples/local-lab'), output = resolve(process.argv[3] || 'outputs/local-lab.cordis-plugin.json')
const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8')), files = {}
async function collect(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.name === 'manifest.json' || item.name === 'node_modules' || item.name.startsWith('.')) continue
    if (item.isSymbolicLink()) throw new Error('打包不接受符号链接')
    const path = join(dir, item.name)
    if (item.isDirectory()) await collect(path)
    else files[relative(folder, path).replaceAll('\\', '/')] = await readFile(path, 'utf8')
  }
}
await collect(folder); validatePackage({ manifest, files }); const content = JSON.stringify({ manifest, files }, null, 2)
if (Buffer.byteLength(content) > 1900000) throw new Error('插件包过大')
await mkdir(resolve(output, '..'), { recursive: true }); await writeFile(output, content); console.log('已打包：' + output)
