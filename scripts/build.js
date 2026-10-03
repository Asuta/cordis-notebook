import { build as viteBuild } from 'vite'
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
await viteBuild({ configFile:false, publicDir:false, logLevel:'error', define:{'process.env.NODE_ENV':JSON.stringify('production')}, build:{ target:'es2022', outDir:'public', emptyOutDir:false, minify:false, lib:{entry:'client/host/runtime.js',formats:['es'],fileName:()=>'runtime.js'}, rolldownOptions:{output:{codeSplitting:false}} } })
console.log('应用插件与通用浏览器宿主已构建')
