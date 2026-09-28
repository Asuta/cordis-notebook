import { build } from 'esbuild'
import { buildPlugins } from './plugin-builder.js'
import { discoverApplications } from '../server/application-discovery.js'
import '../workbench/build.js'
const applications = await discoverApplications()
const selected = process.argv[2] ? applications.filter(app => app.id === process.argv[2]) : applications
if (process.argv[2] && !selected.length) throw Error('未找到要构建的应用')
for (const app of selected) {
  if (app.error) throw Error(`${app.id}: ${app.error}`)
  await buildPlugins(app.pluginsDir)
  console.log(`已构建应用：${app.name}`)
}
await build({ entryPoints:['client/host/runtime.js'], bundle:true, format:'esm', platform:'browser', target:'es2022', outfile:'public/runtime.js' })
console.log('应用插件与通用浏览器宿主已构建')
