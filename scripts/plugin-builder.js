import { build } from 'esbuild'
import { mkdir, copyFile, realpath, rm } from 'node:fs/promises'
import { resolve, dirname, sep } from 'node:path'
import { createRequire, isBuiltin } from 'node:module'
import { spawn } from 'node:child_process'
import { discoverBuiltins, defaultPluginsDir, containedFile, inside } from '../server/plugin-discovery.js'

const require = createRequire(import.meta.url)
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
        if (args.path.startsWith('@cordis-notebook/')) throw new Error('workspace 包仅允许 import type；运行时请使用 ctx 服务：'+args.path)
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
async function command(file, args, cwd) {
  await new Promise((accept,reject)=>{
    const child=spawn(process.execPath,[file,...args],{cwd,stdio:'inherit',windowsHide:true})
    child.once('error',reject)
    child.once('exit',code=>code===0?accept():reject(new Error(`构建命令退出码：${code}`)))
  })
}
export async function buildPlugins(directory = defaultPluginsDir) {
  const entries = await discoverBuiltins(directory)
  for (const entry of entries) {
    const output = resolve(entry.sourceRoot,'dist')
    // Only remove this fixed, verified child. Never follow an external link.
    if (!inside(entry.sourceRoot,output) || (await realpath(output).catch(()=>output)) !== output) throw new Error('dist 目录不能是外部链接')
    await rm(output,{recursive:true,force:true}); await mkdir(output,{recursive:true})
    for (const task of entry.package.cordis.build) {
      const input = await containedFile(entry.sourceRoot,task.input), target = resolve(output,task.output)
      if (!inside(output,target)) throw new Error('构建输出超出 dist')
      await mkdir(dirname(target),{recursive:true})
      if (task.type === 'copy') await copyFile(input,target)
      else if (task.type === 'tailwind') {
        const cli=resolve(dirname(require.resolve('@tailwindcss/cli/package.json')),'dist/index.mjs')
        await command(cli,['-i',input,'-o',target,'--minify'],entry.sourceRoot)
      } else await build({
        absWorkingDir:entry.sourceRoot, entryPoints:[input],outfile:target,bundle:true,format:'esm',platform:task.platform,logLevel:'silent',
        target:'es2022',minify:task.minify ?? false, ...(task.platform==='node'?{packages:'external'}:{}),
        ...(task.jsx?{jsxFactory:task.jsx.factory,jsxFragment:task.jsx.fragment}:{}),
        define:{'process.env.NODE_ENV':'"production"'}, plugins:[boundaries(entry,task)],
      })
    }
  }
  return entries
}
