import { build } from 'esbuild'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'

const base = fileURLToPath(new URL('../mesh-avatar/', import.meta.url))
const vendor = join(base, 'vendor'), out = join(base, 'compiled')
await mkdir(out, { recursive: true })
const runtime = join(vendor, 'packages/runtime/src/index.ts')
function replaceRequired(contents, from, to) {
  const next = contents.replace(from, to)
  if (next === contents) throw Error('Mesh Avatar 上游适配位置已改变：' + String(from))
  return next
}
const adapter = { name: 'novel-studio-adapter', setup(b) {
  b.onResolve({ filter: /^virtual:sample-rig$/ }, () => ({ path: 'sample-rig', namespace: 'novel' }))
  b.onLoad({ filter: /.*/, namespace: 'novel' }, async () => ({ contents: 'export default ' + await readFile(join(vendor, 'samples/miko-qipao/rig.json'), 'utf8'), loader: 'js' }))
  b.onLoad({ filter: /[/\\]src[/\\]editor[/\\](project\.ts|App\.tsx|Preview\.tsx)$/ }, async args => {
    let contents = await readFile(args.path, 'utf8')
    if (args.path.endsWith('project.ts')) contents = contents.replaceAll('/__studio/', './__studio/').replaceAll("'/miko-qipao/'", "'./miko-qipao/'")
    if (args.path.endsWith('App.tsx')) {
      contents = 'import { useNovelBridge } from ' + JSON.stringify(join(base, 'editor-bridge.ts')) + ';\n' + contents
      contents = replaceRequired(contents, '  const importControl =', '  useNovelBridge({ rig, lipSync, localProject, dirty, busy: busy || saving, update, runJob, saved: () => { setSavedRig(JSON.stringify(history.present)); setSavedLipSync(JSON.stringify(lipSync)); } });\n  const importControl =')
      contents = replaceRequired(contents, /href=\{localProject \|\| listedProject \|\| !pickedName \?[^\n]+/, 'href="./game-preview"')
      contents = contents.replaceAll('liveText[language].title', '(language === "zh" ? "游戏预览" : language === "ja" ? "ゲームプレビュー" : "Game preview")')
    }
    if (args.path.endsWith('Preview.tsx')) {
      contents = "import { useEffect as useNovelPreviewEffect } from 'react';\n" + contents
      contents = replaceRequired(contents, '  const skipped =', "  const novelExpression = useRef('neutral');\n  useNovelPreviewEffect(() => { const preview = (event: Event) => { const detail = (event as CustomEvent).detail; setIdle(detail.idle ?? false); setStress(false); setParameters(detail.parameters ?? {}); if (detail.expression) novelExpression.current = detail.expression; avatar.current?.setExpression(novelExpression.current as any); }; window.addEventListener('novel-mesh-preview', preview); return () => window.removeEventListener('novel-mesh-preview', preview); }, []);\n  const skipped =")
      contents = replaceRequired(contents, '        value.setLighting(lightRef.current);', '        value.setExpression(novelExpression.current as any);\n        value.setLighting(lightRef.current);')
    }
    return { contents, loader: args.path.endsWith('tsx') ? 'tsx' : 'ts' }
  })
  b.onLoad({ filter: /[/\\]src[/\\]server[/\\]local-projects\.ts$/ }, async args => ({ contents: (await readFile(args.path, 'utf8')).replaceAll('/__studio/projects/', './__studio/projects/'), loader: 'ts' }))
} }
const common = { bundle: true, format: 'esm', target: 'es2022', logLevel: 'info', legalComments: 'inline', absWorkingDir: fileURLToPath(new URL('../', import.meta.url)) }
await build({ ...common, entryPoints: [join(base, 'editor-entry.tsx')], outfile: join(out, 'studio.js'), platform: 'browser', jsx: 'automatic', alias: { 'mesh-avatar': runtime }, plugins: [adapter], define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'true', 'import.meta.hot': 'undefined' }, minify: true })
await build({ ...common, stdin: { contents: 'export * from ' + JSON.stringify(runtime) + ';', resolveDir: base, loader: 'ts' }, outfile: join(out, 'runtime.js'), platform: 'browser' })
await build({ ...common, stdin: { contents: 'export { localProjectMiddleware, revealFolder } from ' + JSON.stringify(join(vendor, 'src/server/local-projects.ts')) + ';\nexport { packProjectAvatar } from ' + JSON.stringify(join(vendor, 'packages/runtime/src/format/project-archive.ts')) + ';\nexport { JobError } from ' + JSON.stringify(join(vendor, 'src/server/project-jobs.ts')) + ';', resolveDir: base, loader: 'ts' }, outfile: join(out, 'server.js'), platform: 'node', packages: 'external', plugins: [adapter] })
const pkgFile = fileURLToPath(new URL('../package.json', import.meta.url)), pkg = JSON.parse(await readFile(pkgFile, 'utf8'))
pkg.cordis.build = pkg.cordis.build.filter(task => !task.output.startsWith('mesh-avatar/'))
async function include(directory) { for (const entry of await readdir(directory, { withFileTypes: true })) { const file = join(directory, entry.name); if (entry.isDirectory()) await include(file); else { const input = 'mesh-avatar/' + relative(base, file).replaceAll('\\', '/'); pkg.cordis.build.push({ type: 'copy', input, output: input }) } } }
pkg.cordis.build.push({ type: 'bundle', input: 'mesh-avatar/compiled/studio.js', output: 'mesh-avatar/compiled/studio.js', platform: 'browser', minify: true })
pkg.cordis.build.push({ type: 'copy', input: 'mesh-avatar/compiled/studio.css', output: 'mesh-avatar/compiled/studio.css' })
await include(join(vendor, 'samples'))
for (const file of await readdir(join(vendor, 'tools'))) if (file.endsWith('.py')) pkg.cordis.build.push({ type: 'copy', input: 'mesh-avatar/vendor/tools/' + file, output: 'mesh-avatar/vendor/tools/' + file })
for (const file of ['vendor/LICENSE', 'PROVENANCE.md']) pkg.cordis.build.push({ type: 'copy', input: 'mesh-avatar/' + file, output: 'mesh-avatar/' + file })
await writeFile(pkgFile, JSON.stringify(pkg, null, 2) + '\n')
