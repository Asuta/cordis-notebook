import { build } from 'esbuild'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { resolve, dirname, relative, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Rebuild from the checked-in source snapshot; --source refreshes that snapshot.
const root = fileURLToPath(new URL('../live2d/vendor/standrig/', import.meta.url))
const sourceArg = process.argv.indexOf('--source')
const upstream = sourceArg >= 0 ? resolve(process.argv[sourceArg + 1], 'packages') : root
const core = join(upstream, sourceArg >= 0 ? 'core/src' : 'core')
const runtime = join(upstream, sourceArg >= 0 ? 'runtime/src' : 'runtime')
await mkdir(root, { recursive: true })
const entry = `export { RigRuntime } from ${JSON.stringify(join(runtime, 'renderer.ts'))};
export { createRectArtMesh, addArtMeshVertex, removeArtMeshVertex, retriangulateArtMesh, resolveArtMesh } from ${JSON.stringify(join(core, 'artMesh.ts'))};
export { evaluateRigParts, resolveRigFrame } from ${JSON.stringify(join(core, 'evaluator.ts'))};
export { DEFAULT_PARAMETERS } from ${JSON.stringify(join(core, 'parameters.ts'))};
export { DEFAULT_TRANSFORM } from ${JSON.stringify(join(core, 'types.ts'))};
export { executeModelingOperation } from ${JSON.stringify(join(core, 'modelingOps.ts'))};
export { defaultWarpDeformer } from ${JSON.stringify(join(core, 'warp.ts'))};`
const result = await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, metafile: true, legalComments: 'inline', plugins: [{ name: 'standrig-source', setup(b) { b.onResolve({ filter: /^@standrig\/core\// }, args => ({ path: join(core, args.path.slice(15) + '.ts') })) } }] })
await writeFile(join(root, 'runtime.js'), '// StandRig d74c6aba9a02ba3cc33c34f7426c13d09b4bc6f5, Apache-2.0. See LICENSE and PROVENANCE.md.\n' + result.outputFiles[0].text)
if (sourceArg >= 0) {
  for (const input of Object.keys(result.metafile.inputs).filter(x => !x.startsWith('<'))) {
    const full = resolve(input), isCore = full.startsWith(core), folder = isCore ? core : runtime
    const target = join(root, isCore ? 'core' : 'runtime', relative(folder, full))
    await mkdir(dirname(target), { recursive: true }); await copyFile(full, target)
  }
  for (const file of ['LICENSE', 'NOTICE']) await copyFile(resolve(upstream, '..', file), join(root, file))
}
console.log(JSON.stringify({ sources: Object.keys(result.metafile.inputs).length, bytes: result.outputFiles[0].contents.length }))
