import { build } from 'esbuild'
import { readdir, access } from 'node:fs/promises'
await build({ entryPoints: ['plugins/ui/runtime.jsx'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'plugins/ui/runtime.bundle.js', minify: true, define: { 'process.env.NODE_ENV': '"production"' } })
for (const dir of await readdir('plugins')) {
  const entry = `plugins/${dir}/view.jsx`
  try { await access(entry) } catch { continue }
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: `plugins/${dir}/view.bundle.js`, jsxFactory: 'h', jsxFragment: 'Fragment' })
}
// The same local ESM parser is consumed by the format plugin in both processes.
await build({ entryPoints: ['plugins/markdown/parser.js'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'plugins/markdown/parser.bundle.js', minify: true })
await build({ entryPoints: ['client/host/runtime.js'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'public/runtime.js' })
console.log('Cordis 浏览器运行时已构建')
