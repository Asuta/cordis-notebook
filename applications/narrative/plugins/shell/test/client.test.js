import { test } from 'node:test'
import assert from 'node:assert/strict'
import shell from '../client.js'
import { setupScene } from '../../scene-runtime/test/helpers.js'
import { mountScene } from '../../scene-ui/renderer.js'
import { owner, settle } from '../../project/test/helpers.js'

test('会客厅壳层没有旧剧情入口，起始场景设置与试玩可用', async t => {
  const f = await setupScene(t), ctx = owner(), surfaces = owner(); let ui
  ctx.narrative = f.engine
  shell(ctx, { ...f.sdk, mount(_, root) { document.body.append(root) }, provide(_, value) { ui = value } })
  ui.registerSurface(surfaces, { id: 'scene.player', mount(host) { const view = mountScene(host, { scene: f.scene, engine: f.engine, ui }); return () => view.dispose() } })
  f.ctx.effect(() => async () => { await surfaces.dispose(); await ctx.dispose() })
  assert.equal(document.querySelector('.ne-center-heading h2').textContent, '会客厅')
  assert.equal(document.querySelector('.ne-flow-card'), null)
  assert.equal(document.querySelector('[aria-label="起始剧情"]'), null)
  f.engine.sceneCommand({op:'add-scene',id:'second-scene',name:'第二场景'})
  const start=document.querySelector('[aria-label="起始场景"]')
  start.value='second-scene'; start.dispatchEvent(new f.window.Event('change'))
  await settle()
  assert.equal(f.engine.composition.startSceneId, 'second-scene')
  f.engine.sceneCommand({op:'start-scene',id:'main'})
  await f.engine.play()
  assert.equal(f.engine.runtime.error, '')
  assert.ok(document.querySelector('.scene-chat'))
  f.engine.stop()
  await surfaces.dispose(); await ctx.dispose()
  assert.equal(document.querySelector('.ne-app'), null)
})
