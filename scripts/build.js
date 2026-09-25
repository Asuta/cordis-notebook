import { build } from 'esbuild'
import { buildPlugins } from './plugin-builder.js'
await buildPlugins()
await build({ entryPoints:['client/host/runtime.js'], bundle:true, format:'esm', platform:'browser', target:'es2022', outfile:'public/runtime.js' })
console.log('插件 dist 与 Cordis 浏览器宿主已构建')
