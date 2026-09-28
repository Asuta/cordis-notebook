import { build } from 'esbuild'
await build({ entryPoints: ['workbench/markdown.js'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'workbench/public/markdown.js' })
