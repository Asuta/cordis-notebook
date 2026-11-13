import { build } from 'esbuild'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'

const base = fileURLToPath(new URL('./', import.meta.url))
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
      contents = 'import { useNarrativeBridge } from ' + JSON.stringify(join(base, 'editor-bridge.ts')) + ';\n' + contents
      contents = replaceRequired(contents, '  const importControl =', '  useNarrativeBridge({ rig, lipSync, localProject, dirty, busy: busy || saving, update, runJob, saved: () => { setSavedRig(JSON.stringify(history.present)); setSavedLipSync(JSON.stringify(lipSync)); } });\n  const importControl =')
      contents = replaceRequired(contents, /href=\{localProject \|\| listedProject \|\| !pickedName \?[^\n]+/, 'href="./game-preview"')
      contents = contents.replaceAll('liveText[language].title', '(language === "zh" ? "游戏预览" : language === "ja" ? "ゲームプレビュー" : "Game preview")')
    }
    if (args.path.endsWith('Preview.tsx')) {
      contents = "import { useEffect as useNovelPreviewEffect } from 'react';\nimport { createPreviewStepper } from " + JSON.stringify(join(base, 'preview-clock.js')) + ";\n" + contents
      // Throttle the live mouth read-out: the upstream preview calls setLiveMouth on every animation
      // frame, which re-renders this whole panel 60 times a second on top of the WebGL redraw.
      contents = replaceRequired(contents, '    let previous = start;', '    let previous = start;\n    const advancePreview = createPreviewStepper(value);\n    let mouthStamp = 0;')
      contents = replaceRequired(contents, '      value.advance(lip || audioActive ? Math.min(0.05, Math.max(0, (now - previous) / 1000)) : 1 / 60);', '      advancePreview((now - previous) / 1000);')
      contents = replaceRequired(contents, '        setLiveMouth(Math.round(state.open * 100) / 100);', '        if (now - mouthStamp >= 100) { mouthStamp = now; setLiveMouth(Math.round(state.open * 100) / 100); }')
      contents = replaceRequired(contents, '  const skipped =', "  const novelExpression = useRef('neutral');\n  useNovelPreviewEffect(() => { const preview = (event: Event) => { const detail = (event as CustomEvent).detail; setIdle(detail.idle ?? false); setStress(false); setParameters(detail.parameters ?? {}); if (detail.expression) novelExpression.current = detail.expression; avatar.current?.setExpression(novelExpression.current as any); }; window.addEventListener('narrative-mesh-preview', preview); return () => window.removeEventListener('narrative-mesh-preview', preview); }, []);\n  const skipped =")
      contents = replaceRequired(contents, '        value.setLighting(lightRef.current);', '        value.setExpression(novelExpression.current as any);\n        value.setLighting(lightRef.current);')
    }
    return { contents, loader: args.path.endsWith('tsx') ? 'tsx' : 'ts' }
  })
  b.onLoad({ filter: /[/\\]src[/\\]server[/\\]local-projects\.ts$/ }, async args => ({ contents: (await readFile(args.path, 'utf8')).replaceAll('/__studio/projects/', './__studio/projects/').replace('const files: Record<string, Uint8Array> = Object.create(null);', 'for (const name of await readdir(path)) if (/[.](md|txt)$/i.test(name)) names.add(name);' + String.fromCharCode(10) + 'const files: Record<string, Uint8Array> = Object.create(null);'), loader: 'ts' }))
} }
const common = { bundle: true, format: 'esm', target: 'es2022', logLevel: 'info', legalComments: 'inline', absWorkingDir: fileURLToPath(new URL('../', import.meta.url)) }
await build({ ...common, entryPoints: [join(base, 'editor-entry.tsx')], outfile: join(out, 'studio.js'), platform: 'browser', jsx: 'automatic', alias: { 'mesh-avatar': runtime }, plugins: [adapter], define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'true', 'import.meta.hot': 'undefined' }, minify: true })
await build({ ...common, stdin: { contents: 'export * from ' + JSON.stringify(runtime) + ';', resolveDir: base, loader: 'ts' }, outfile: join(out, 'runtime.js'), platform: 'browser' })
await build({ ...common, stdin: { contents: 'export { localProjectMiddleware, revealFolder } from ' + JSON.stringify(join(vendor, 'src/server/local-projects.ts')) + ';\nexport { packProjectAvatar } from ' + JSON.stringify(join(vendor, 'packages/runtime/src/format/project-archive.ts')) + ';\nexport { JobError } from ' + JSON.stringify(join(vendor, 'src/server/project-jobs.ts')) + ';', resolveDir: base, loader: 'ts' }, outfile: join(out, 'server.js'), platform: 'node', packages: 'external', plugins: [adapter] })
const pkgFile = join(base, 'package.json'), pkg = JSON.parse(await readFile(pkgFile, 'utf8'))
pkg.cordis.build = pkg.cordis.build.filter(task => !/^(compiled|vendor|docs)\//.test(task.output) && task.output !== 'PROVENANCE.md')
async function include(directory) { for (const entry of await readdir(directory, { withFileTypes: true })) { const file = join(directory, entry.name); if (entry.isDirectory()) await include(file); else { const input = relative(base, file).replaceAll('\\', '/'); pkg.cordis.build.push({ type: 'copy', input, output: input }) } } }
pkg.cordis.build.push({ type: 'bundle', input: 'compiled/studio.js', output: 'compiled/studio.js', platform: 'browser', minify: true })
pkg.cordis.build.push({ type: 'copy', input: 'compiled/studio.css', output: 'compiled/studio.css' })
await include(join(vendor, 'samples'))
await include(join(base, 'docs'))
for (const file of await readdir(join(vendor, 'tools'))) if (file.endsWith('.py')) pkg.cordis.build.push({ type: 'copy', input: 'vendor/tools/' + file, output: 'vendor/tools/' + file })
for (const file of ['vendor/LICENSE', 'PROVENANCE.md']) pkg.cordis.build.push({ type: 'copy', input: file, output: file })
await writeFile(pkgFile, JSON.stringify(pkg, null, 2) + '\n')
