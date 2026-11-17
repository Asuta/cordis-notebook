import { test } from 'node:test'
import assert from 'node:assert/strict'
import shell from '../client.js'
import { setupScene } from '../../scene-runtime/test/helpers.js'
import { mountScene } from '../../scene-ui/renderer.js'
import { owner, setup, settle } from '../../project/test/helpers.js'
import editor from '../../scene-editor/client.js'
import runtimeClient from '../../scene-runtime/client.js'
import { builtinTypes } from '../../scene-ui/types.js'

test('会客厅壳层没有旧剧情入口，起始场景设置与试玩可用', async t => {
  const f = await setupScene(t), ctx = owner(), surfaces = owner(); let ui
  ctx.narrative = f.engine
  shell(ctx, { ...f.sdk, mount(_, root) { document.body.append(root) }, provide(_, value) { ui = value } })
  ui.registerSurface(surfaces, { id: 'scene.player', mount(host) { const view = mountScene(host, { scene: f.scene, engine: f.engine, ui }); return () => view.dispose() } })
  f.ctx.effect(() => async () => { await surfaces.dispose(); await ctx.dispose() })
  const editorOwner=owner();Object.assign(editorOwner,{narrative:f.engine,sceneRuntime:f.scene,narrativeUI:ui,sceneViews:{mount:(host,options)=>mountScene(host,{scene:f.scene,engine:f.engine,ui,...options})}})
  editor(editorOwner,f.sdk);f.ctx.effect(()=>()=>editorOwner.dispose())
  assert.equal(document.querySelectorAll('.scene-canvas').length,1)
  assert.ok(document.querySelector('[aria-label="场景层级"]'))
  assert.ok(document.querySelector('[aria-label="属性检查器"]'))
  assert.ok(document.querySelector('[aria-label="资源库"]'))
  assert.equal(document.querySelector('.ne-sidebar'),null)
  assert.equal(document.querySelector('.ne-flow-card'), null)
  assert.equal(document.querySelector('[aria-label="起始剧情"]'), null)
  f.engine.sceneCommand({op:'add-scene',id:'second-scene',name:'第二场景'})
  await ui.navigate('project')
  const start=document.querySelector('[aria-label="起始场景"]')
  start.value='second-scene'; start.dispatchEvent(new f.window.Event('change'))
  await settle()
  assert.equal(f.engine.composition.startSceneId, 'second-scene')
  await ui.navigate('scene.editor')
  const originalCanvas=document.querySelector('.scene-canvas')
  f.engine.sceneCommand({op:'start-scene',id:'main'})
  await f.engine.play()
  assert.equal(f.engine.runtime.error, '')
  assert.ok(document.querySelector('.scene-chat'))
  assert.equal(document.querySelectorAll('.scene-canvas').length,1)
  assert.equal(document.querySelector('.scene-canvas'),originalCanvas)
  assert.equal(document.querySelector('.scene-inspector-fields').disabled,true)
  f.engine.stop()
  assert.equal(document.querySelector('.scene-canvas'),originalCanvas)
  assert.equal(document.querySelector('.scene-inspector-fields').disabled,false)
  await surfaces.dispose(); await ctx.dispose()
  assert.equal(document.querySelector('.ne-app'), null)
})

for (const shellFirst of [true, false]) test(`切换作品重置场景后再挂载编辑器（shell ${shellFirst ? '先' : '后'}注册）`, async t => {
  const f = await setup(t, { template: 'salon' }), shellOwner = owner(), sceneOwner = owner(), editorOwner = owner()
  let ui, scene
  shellOwner.narrative = sceneOwner.narrative = f.engine
  f.ctx.effect(() => async () => { await editorOwner.dispose(); await sceneOwner.dispose(); await shellOwner.dispose() })
  const mountShell = () => shell(shellOwner, { ...f.sdk, mount(_, root) { document.body.append(root) }, provide(_, value) { ui = value } })
  const mountRuntime = () => {
    runtimeClient(sceneOwner, { provide(_, value) { scene = value } })
    for (const d of builtinTypes()) scene.register(sceneOwner, d)
  }
  if (shellFirst) { mountShell(); mountRuntime() } else { mountRuntime(); mountShell() }
  Object.assign(editorOwner, { narrative: f.engine, sceneRuntime: scene, narrativeUI: ui, sceneViews: { mount: (host, options) => mountScene(host, { scene, engine: f.engine, ui, ...options }) } })
  editor(editorOwner, f.sdk)
  scene.edit({ op: 'add-scene', id: 'only-in-first', name: '旧作品的场景' })
  scene.select('only-in-first'); await settle()
  const oldCanvas = document.querySelector('.scene-canvas')
  await f.engine.open('second'); await settle()
  assert.equal(f.engine.project.id, 'second')
  assert.equal(scene.selected, f.engine.composition.startSceneId)
  assert.equal(document.querySelectorAll('.scene-canvas').length, 1)
  assert.notEqual(document.querySelector('.scene-canvas'), oldCanvas)
  assert.equal(document.querySelector('[aria-label="作品名称"]').value, f.engine.project.title)
  assert.ok(document.querySelector('[aria-label="场景层级"]'))
  assert.deepEqual(f.toasts, [])
  // Disposing while a project refresh is queued must not recreate the workspace.
  f.engine.update(p => { p.description = '待刷新' })
  await shellOwner.dispose(); await settle()
  assert.equal(document.querySelector('.ne-app'), null)
})
