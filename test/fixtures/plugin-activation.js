import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHost } from '../../server/server.js'
import { createWorkbench } from '../../workbench/server.js'
import { buildPlugins } from '../../scripts/plugin-builder.js'

export async function activationFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'cordis-activation-')), applicationsDir = join(root, 'applications'), dataDir = join(root, 'data')
  let host, wb
  t.after(async () => {
    try { await wb?.close() } finally {
      try { await host?.close() } finally { await rm(root, { recursive: true, force: true }) }
    }
  })
  for (const appId of ['sample', 'other']) {
    const app = join(applicationsDir, appId), plugins = join(app, 'plugins')
    await mkdir(plugins, { recursive: true })
    await writeFile(join(app, 'package.json'), JSON.stringify({ cordisApp: { id: appId, name: appId, default: appId === 'sample' } }))
    const entries = [
      { id: 'backend', server: 'export default ctx => { ctx.http.route(ctx, "GET", new RegExp("^/probe$"), () => ({ready:true})) }', requires: { server: ['http'], client: [] }, defaultEnabled: true },
      { id: 'waiting', server: 'export default () => {}', requires: { server: ['missingService'], client: [] } },
      { id: 'broken', server: 'export default () => { throw Error("启动失败测试") }' },
      { id: 'panel', client: 'export default (ctx,sdk) => { const node=sdk.el("button", {id:"activation-panel"}, "插件已运行"); sdk.effect(()=>{document.body.append(node);return()=>node.remove()}) }' },
      { id: 'client-waiting', client: 'export default () => {}', requires: { server: [], client: ['missingClient'] } },
      { id: 'client-broken', client: 'export default () => { throw Error("前端失败测试") }' },
      { id: 'theme-first', client: 'export default ctx => { ctx.on("plugins/before-stop", change => { if (!change.targets.includes("theme-first")) return; document.body.dataset.activationPrepared="true"; if(document.body.dataset.activationVeto==="true") return "保存未完成测试"; change.hold(()=>{document.body.dataset.activationReleased="true"}) }) }', exclusiveGroup: 'themes', defaultEnabled: true },
      { id: 'theme-second', client: 'export default () => { if (document.body.dataset.activationRestoreFails === "true") throw Error("页面恢复失败测试") }', exclusiveGroup: 'themes' },
      { id: 'theme-broken', client: 'export default () => { throw Error("主题失败测试") }', exclusiveGroup: 'themes' },
    ]
    for (const entry of entries) {
      const folder = join(plugins, entry.id), m = { schemaVersion: 1, id: entry.id, name: entry.id, defaultEnabled: entry.defaultEnabled ?? false,
        requires: entry.requires || { server: [], client: [] }, provides: { server: [], client: [] }, public: [], build: [] }
      await mkdir(folder)
      for (const side of ['server', 'client']) if (entry[side]) {
        const file = side + '.js'
        m[side] = side === 'client' ? file : { entry: file, export: 'default' }
        if (side === 'client') m.public.push(file)
        m.build.push({ type: 'bundle', input: file, output: file, platform: side === 'server' ? 'node' : 'browser' })
        await writeFile(join(folder, file), entry[side])
      }
      if (entry.exclusiveGroup) m.exclusiveGroup = entry.exclusiveGroup
      await writeFile(join(folder, 'package.json'), JSON.stringify({ name: '@test/' + entry.id, type: 'module', version: '1.0.0', cordis: m }))
    }
    await buildPlugins(plugins)
  }
  // Prove a saved disabled flag overrides a manifest whose default is true.
  await mkdir(join(dataDir, 'apps', 'sample'), { recursive: true })
  await writeFile(join(dataDir, 'apps', 'sample', 'plugins-state.json'), JSON.stringify({ backend: false }))
  host = await createHost({ port: 0, dataDir, applicationsDir, initialApplication: 'sample' })
  const url = 'http://127.0.0.1:' + host.server.address().port
  wb = await createWorkbench({ root, port: 0, appPort: host.server.address().port, autoStart: false, dataDir: join(root, 'workbench') })
  const status = async () => ({ online: true, managed: true, mode: 'runtime', logs: [], state: await (await fetch(url + '/api/applications')).json() })
  wb.application.status = status
  return { root, dataDir, host, wb, url, status, read: async () => (await fetch(url + '/api/plugins')).json(),
    enable: id => wb.execute({ appId: 'sample' }, 'workspace_enable_plugin', { id }) }
}
