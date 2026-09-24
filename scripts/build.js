import { build } from 'esbuild'
// The same local ESM parser is consumed by the format plugin in both processes.
await build({ entryPoints: ['shared/formats/markdown/parser.js'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'shared/formats/markdown-parser.js', minify: true })
await build({ entryPoints: ['client/host/runtime.js'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'public/runtime.js' })
console.log('Cordis 浏览器运行时已构建')
