import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir, access, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, sep } from 'node:path'
import { createApp } from '../server/server.js'
import { builtins } from '../server/builtins.js'

test('每个内置插件聚合在同名目录，浏览器入口、相对依赖和样式均可加载，后端源码不公开', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-assets-'))
  let app
  try {
    const folders = (await readdir('applications/notebook/plugins', { withFileTypes: true })).filter(item => item.isDirectory()).map(item => item.name)
    assert.deepEqual(folders.sort(), builtins.map(item => item.manifest.id).sort())
    app = await createApp({ port: 0, file: join(dir, 'notes.json') })
    const base = `http://127.0.0.1:${app.server.address().port}`, seen = new Set()
    async function visit(url) {
      if (seen.has(url)) return
      seen.add(url)
      const response = await fetch(url)
      assert.equal(response.status, 200, url)
      assert.match(response.headers.get('content-type'), url.endsWith('.css') ? /text\/css/ : /javascript/, url)
      const source = await response.text()
      if (!url.endsWith('.js')) return
      for (const [, specifier] of source.matchAll(/^import\s+.*?\s+from\s+['"]([^'"]+)['"]/gm)) {
        const consumer = builtins.find(entry => entry.manifest.id === new URL(url).pathname.split('/')[2])
        if (specifier.startsWith('/builtin/')) {
          const runtime = [...consumer.runtimeModules.values()].find(value => specifier === `/builtin/${value.provider}/${value.output}`)
          assert.ok(runtime, `只能引用清单声明的共享运行时：${specifier}`)
          assert.ok(consumer.manifest.id === runtime.provider || runtime.services.some(name => consumer.manifest.requires.client.includes(name)), '消费共享运行时须声明服务依赖')
        } else {
          assert.ok(specifier.startsWith('.'), `浏览器不能加载裸包：${url}: ${specifier}`)
          assert.equal(new URL(specifier, url).pathname.split('/')[2], new URL(url).pathname.split('/')[2], `插件不能跨目录导入实现：${url}: ${specifier}`)
        }
        await visit(new URL(specifier, url).href)
      }
      for (const [, stylesheet] of source.matchAll(/href:\s*['"]([^'"]+\.css)['"]/g)) await visit(new URL(stylesheet, url).href)
    }
    for (const { manifest, server, clientAssets } of builtins) {
      if (server) await access(`applications/notebook/plugins/${manifest.id}/server.js`)
      if (manifest.client) {
        assert.equal(manifest.client, 'client.js')
        await visit(`${base}/builtin/${manifest.id}/${manifest.client}`)
      }
      for (const file of clientAssets) await visit(`${base}/builtin/${manifest.id}/${file}`)
      assert.equal((await fetch(`${base}/builtin/${manifest.id}/server.js`)).status, 404)
    }
    for (const path of ['/builtin/markdown/parser.js', '/builtin/unknown/client.js', '/shared/theme-server.js', '/shared/theme-client.js', '/shared/config-schema.js', '/builtin/notebook/model.js/extra', '/plugins/format-markdown/server.js']) {
      assert.equal((await fetch(base + path)).status, 404, path)
    }
  } finally { if (app) await app.close(); await rm(dir, { recursive: true, force: true }) }
})

test('插件源码只能导入自身实现或外部包，宿主与其他插件能力通过服务使用', async () => {
  for (const { manifest } of builtins) {
    const root = resolve('applications/notebook/plugins', manifest.id)
    for (const name of await readdir(root)) {
      if (!name.endsWith('.js') || name.endsWith('.bundle.js')) continue
      const file = join(root, name), source = await readFile(file, 'utf8')
      for (const [, specifier] of source.matchAll(/^(?:import|export)\s+.*?\bfrom\s+['"]([^'"]+)['"]/gm)) {
        if (!specifier.startsWith('.')) continue
        assert.ok(resolve(dirname(file), specifier).startsWith(root + sep), `${manifest.id}/${name} 跨目录导入了 ${specifier}`)
      }
    }
  }
})
