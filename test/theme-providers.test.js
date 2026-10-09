import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from 'cordis'
import { Window } from 'happy-dom'
import { createApp } from '../server/server.js'
import { builtins } from '../server/builtins.js'
import { ClientPlugins } from '../client/host/plugin-host.js'

test('所有声明的主题提供者均能激活前后端、互斥切换并清理样式', async () => {
  const themes = builtins.filter(entry => entry.manifest.exclusiveGroup === 'appearance.theme')
  assert.ok(themes.length)
  const directory = await mkdtemp(join(tmpdir(), 'cordis-theme-providers-')), previous = globalThis.document, window = new Window()
  let app
  const root = new Context()
  globalThis.document = window.document
  const host = new ClientPlugins(root, { sdkFor: ctx => ({ provide: (name, value) => Object.assign(new Service(ctx, name), value) }),
    load: spec => import(`../applications/notebook/plugins/${spec.id}/dist/client.js`) })
  const spec = id => app.manager.serialize().plugins.find(plugin => plugin.id === id)
  try {
    app = await createApp({ port: 0, file: join(directory, 'notes.json') })
    await root.plugin(ctx => { new Service(ctx, 'shell') })
    for (const entry of themes) {
      const id = entry.manifest.id, change = await app.manager.toggle(id, true)
      if (change.pendingSwitch) await app.manager.finishExclusive(change.pendingSwitch.token, true)
      assert.equal(app.ctx.theme.id, id)
      assert.equal(app.manager.serialize().plugins.filter(p => p.exclusiveGroup === 'appearance.theme' && p.enabled).length, 1)
      await host.sync([spec('theme-engine'), spec(id)])
      assert.equal(document.documentElement.dataset.theme, id)
      assert.equal(document.head.querySelectorAll('style').length, 1)
      assert.doesNotMatch(document.head.textContent, /undefined|null/)
      assert.equal([...document.head.textContent.matchAll(/--theme-[a-z-]+:/g)].length, 10)
      await host.sync([])
      assert.equal(document.head.querySelectorAll('style').length, 0)
      assert.equal(document.documentElement.dataset.theme, undefined)
    }
  } finally { await root.fiber.dispose(); if (app) await app.close(); globalThis.document = previous; await window.happyDOM.close(); await rm(directory, { recursive: true, force: true }) }
})
