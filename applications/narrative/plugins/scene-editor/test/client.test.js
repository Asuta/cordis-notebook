import { test } from 'node:test'
import assert from 'node:assert/strict'
import editor from '../client.js'
import { setupScene } from '../../scene-runtime/test/helpers.js'
import { settle, owner } from '../../project/test/helpers.js'

test('属性面板编辑预制体实例覆盖，撤销后还原，未影响其他实例', async t => {
  const f = await setupScene(t), ctx = owner(), host = document.createElement('div')
  for (const id of ['first-chat', 'second-chat']) f.scene.edit({ op: 'instantiate', id, prefabId: 'standard-chat', prefabVersion: 1 })
  Object.assign(ctx, { narrative: f.engine, sceneRuntime: f.scene, sceneViews: { mount: () => ({ refresh() {}, dispose() {} }) }, narrativeUI: { registerPanel(_, d) { f.ctx.effect(() => d.render(host)) } } })
  editor(ctx, { toast: message => f.toasts.push(message) })
  document.body.append(host)
  host.querySelector('[data-id="first-chat--window"]').click(); await settle()
  const input = host.querySelector('[aria-label="窗口标题"]')
  input.value = '独立窗口'; input.dispatchEvent(new f.window.Event('change')); await settle()
  const expanded = f.scene.expanded().objects
  assert.equal(expanded.find(o => o.id === 'first-chat--window').props.title, '独立窗口')
  assert.equal(expanded.find(o => o.id === 'second-chat--window').props.title, '角色对话')
  assert.equal(f.scene.document.prefabs[0].objects.find(o => o.id === 'window').props.title, '角色对话')
  Array.from(host.querySelectorAll('button')).find(b => b.textContent.includes('撤销')).click(); await settle()
  assert.equal(f.scene.expanded().objects.find(o => o.id === 'first-chat--window').props.title, '角色对话')
  assert.deepEqual(f.toasts, [])
})
