import { build as viteBuild, transformWithOxc } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { resolve, dirname, sep, posix } from 'node:path'
import { realpath, rm } from 'node:fs/promises'
import { isBuiltin } from 'node:module'
import { inside } from '../server/plugin-discovery.js'

const clean = id => id.split('?')[0]
const packageName = id => id.startsWith('@') ? id.split('/').slice(0, 2).join('/') : id.split('/')[0]

// The same manifest boundaries apply in development and production.
export function pluginSources(entries, { register = () => {}, sharedRuntime = false, runtimeEntry } = {}) {
  const owner = file => entries.find(entry => inside(entry.sourceRoot, resolve(clean(file))))
  return {
    name: 'cordis-plugin-sources', enforce: 'pre',
    async resolveId(source, importer, options) {
      if (importer?.startsWith('\0cordis-runtime:')) return { id: source, external: true }
      if (!importer || source.startsWith('\0') || source.startsWith('/@vite/')) return
      const entry = owner(importer)
      const own = entry && !importer.includes(`${sep}node_modules${sep}`) && !importer.includes('/node_modules/')
      if (own && !source.startsWith('.') && !source.startsWith('/') && !source.startsWith('\0')) {
        const name = packageName(source)
        if (entry.package.dependencies?.[name]?.startsWith('workspace:')) throw Error('workspace 包仅允许 import type；运行时请使用 ctx 服务：' + source)
        const provider = entry.runtimeOwners.get(name)
        if (provider && provider !== entry.manifest.id) throw Error(`${name} 运行时由 ${provider} 提供，请声明服务依赖`)
        if (isBuiltin(source)) {
          if (this.environment?.name === 'ssr') return { id: source, external: true }
          throw Error('浏览器不能导入 Node 内置模块：' + source)
        }
        if (!Object.hasOwn(entry.package.dependencies || {}, name)) throw Error('代码包依赖未声明：' + name)
      }
      // Third-party React libraries must share the renderer's actual module, not
      // embed another copy behind the service boundary. Source plugins still use ctx.ui.
      if (sharedRuntime) {
        const consumer = entries[0], runtime = consumer.runtimeModules?.get(source)
        if (runtime && !(consumer.manifest.id === runtime.provider && runtimeEntry === runtime.output)) {
          if (consumer.manifest.id !== runtime.provider && !runtime.services.some(name => consumer.manifest.requires.client.includes(name))) throw Error('共享运行时需要声明提供者的服务依赖：' + source)
          const url = consumer.manifest.id === runtime.provider
            ? './' + posix.relative(posix.dirname(runtimeEntry), runtime.output)
            : `/builtin/${runtime.provider}/${runtime.output}`
          return options?.kind === 'require-call' ? '\0cordis-runtime:' + url : { id: url, external: true }
        }
      }
      const result = await this.resolve(source, importer, { skipSelf: true })
      if (!result || result.external || result.id.startsWith('\0')) return result
      const file = clean(result.id)
      if (own && (source.startsWith('.') || source.startsWith('/'))) {
        const target = await realpath(file)
        if (!inside(await realpath(entry.sourceRoot), target)) throw Error('禁止跨插件或宿主目录导入实现：' + source)
      }
      if (entry && this.environment?.name !== 'ssr') {
        const task = entry.package.cordis.build.find(task => task.output === entry.serverEntry?.entry)
        if (task && resolve(entry.sourceRoot, task.input) === resolve(file)) throw Error('浏览器构建不能包含后端入口')
      }
      if (this.environment?.name !== 'ssr') register(file)
      return result
    },
    load(id) {
      if (id.startsWith('\0cordis-runtime:')) return `import runtime from ${JSON.stringify(id.slice('\0cordis-runtime:'.length))}; module.exports = runtime;`
    },
    async transform(code, id) {
      const file = clean(id), entry = owner(file)
      if (!/\.[jt]sx$/.test(file) || file.includes('/node_modules/')) return
      const task = entry?.package.cordis.build.find(task => task.platform === 'browser')
      return transformWithOxc(code, file, {
        jsx: { runtime: 'classic', pragma: task?.jsx?.factory || 'React.createElement',
          pragmaFrag: task?.jsx?.fragment || 'React.Fragment' }, sourcemap: true,
      })
    },
  }
}

export async function buildBrowser(entry, task, input, target) {
  const css = task.type === 'tailwind'
  // Each plugin keeps one ESM entry, except for explicitly shared runtime modules.
  const virtual = resolve(entry.sourceRoot, '__cordis_css_entry__.js')
  await viteBuild({
    configFile: false, root: entry.sourceRoot, publicDir: false, logLevel: 'error',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    plugins: css ? [tailwindcss(), {
      name: 'cordis-css-entry', resolveId: id => id === virtual ? virtual : undefined,
      load: id => id === virtual ? `import ${JSON.stringify(input.replaceAll('\\', '/'))}` : undefined,
    }] : [pluginSources([entry], { sharedRuntime: true, runtimeEntry: task.output })],
    build: {
      target: 'es2022', outDir: dirname(target), emptyOutDir: false,
      minify: css || (task.minify ?? false),
      lib: { entry: css ? virtual : input, formats: ['es'], fileName: () => css ? '__css.js' : task.output.split('/').at(-1), cssFileName: task.output.split('/').at(-1).replace(/\.css$/, '') },
      rolldownOptions: { output: { codeSplitting: false } },
    },
  })
  if (css) await rm(resolve(dirname(target), '__css.js'), { force: true })
}
