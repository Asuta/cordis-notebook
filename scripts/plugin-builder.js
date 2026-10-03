import { build } from 'esbuild'
import { buildBrowser } from './vite-build.js'
import { mkdir, copyFile, realpath, rm, writeFile } from 'node:fs/promises'
import { resolve, dirname, sep } from 'node:path'
import { isBuiltin } from 'node:module'
import { discoverBuiltins, defaultPluginsDir, containedFile, inside } from '../server/plugin-discovery.js'

const packageName = path => path.startsWith('@') ? path.split('/').slice(0,2).join('/') : path.split('/')[0]
function boundaries(entry, task) {
  return { name:'plugin-boundaries', setup(builder) {
    builder.onResolve({filter:/.*/}, args => {
      if (!args.importer) return
      const own = inside(entry.sourceRoot, args.importer) && !args.importer.includes(`${sep}node_modules${sep}`)
      if (own && (args.path.startsWith('.') || args.path.startsWith('/'))) {
        if (!inside(entry.sourceRoot, resolve(args.resolveDir,args.path))) throw new Error('禁止跨插件或宿主目录导入实现：'+args.path)
      } else if (!args.path.startsWith('.') && !args.path.startsWith('/')) {
        const name = packageName(args.path)
        if (entry.package.dependencies?.[name]?.startsWith('workspace:')) throw new Error('workspace 包仅允许 import type；运行时请使用 ctx 服务：'+args.path)
        const owner = entry.runtimeOwners.get(name)
        if (owner && owner !== entry.manifest.id) throw new Error(`${name} 运行时由 ${owner} 提供，请声明服务依赖`)
        if (own && !isBuiltin(args.path) && !Object.hasOwn(entry.package.dependencies || {},name)) throw new Error(`代码包依赖未声明：${name}`)
      }
    })
    builder.onLoad({filter:/.*/}, async args => {
      if (args.path.includes(`${sep}node_modules${sep}`)) return
      if (!inside(entry.sourceRoot,args.path)) throw new Error('禁止跨目录加载实现：'+args.path)
      const target = await realpath(args.path)
      if (!inside(await realpath(entry.sourceRoot),target)) throw new Error('源文件链接超出插件目录：'+args.path)
      const serverTask = entry.package.cordis.build.find(item => item.output === entry.serverEntry?.entry)
      if (task.platform === 'browser' && serverTask && target === resolve(entry.sourceRoot, serverTask.input)) throw new Error('浏览器构建不能包含后端入口')
    })
  }}
}
export async function buildPlugins(directory = defaultPluginsDir, { backendOnly = false, onDependencies = () => {}, stagedOutputs } = {}) {
  const entries = await discoverBuiltins(directory)
  const pending = []
  for (const entry of entries) {
    const output = resolve(entry.sourceRoot,'dist')
    // Only remove this fixed, verified child. Never follow an external link.
    if (!inside(entry.sourceRoot,output) || (await realpath(output).catch(()=>output)) !== output) throw new Error('dist 目录不能是外部链接')
    if (!backendOnly) await rm(output,{recursive:true,force:true})
    await mkdir(output,{recursive:true})
    for (const task of entry.package.cordis.build) {
      if (backendOnly && task.platform !== 'node') continue
      const input = await containedFile(entry.sourceRoot,task.input), target = resolve(output,task.output)
      if (!inside(output,target)) throw new Error('构建输出超出 dist')
      await mkdir(dirname(target),{recursive:true})
      if (task.type === 'copy') await copyFile(input,target)
      else if (task.type === 'tailwind' || task.platform === 'browser') await buildBrowser(entry, task, input, target)
      else {
        const result = await build({
        absWorkingDir:entry.sourceRoot, entryPoints:[input],outfile:target,bundle:true,format:'esm',platform:task.platform,logLevel:'silent',
        target:'es2022',minify:task.minify ?? false, ...(task.platform==='node'?{packages:'external'}:{}),
        ...(task.jsx?{jsxFactory:task.jsx.factory,jsxFragment:task.jsx.fragment}:{}),
        define:{'process.env.NODE_ENV':JSON.stringify(backendOnly ? 'development' : 'production')}, plugins:[boundaries(entry,task)],
        write: !backendOnly, metafile: true,
      })
        onDependencies(Object.keys(result.metafile.inputs).map(file => resolve(entry.sourceRoot, file)))
        if (backendOnly) pending.push(...result.outputFiles)
      }
    }
  }
  // Do not publish partially compiled backends after a compilation error.
  if (stagedOutputs) stagedOutputs.push(...pending)
  else for (const file of pending) await writeFile(file.path, file.contents)
  return entries
}
