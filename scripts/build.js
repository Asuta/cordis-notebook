import { build } from 'esbuild'
await build({ entryPoints: ['client/runtime.js'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'public/runtime.js' })
console.log('Cordis 浏览器运行时已构建')
