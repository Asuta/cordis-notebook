import { build } from 'esbuild'
// The same local ESM parser is consumed by the format plugin in both processes.
await build({ entryPoints: ['plugins/markdown/parser.js'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'plugins/markdown/parser.bundle.js', minify: true })
await build({ entryPoints: ['client/host/runtime.js'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'public/runtime.js' })
console.log('Cordis 浏览器运行时已构建')
