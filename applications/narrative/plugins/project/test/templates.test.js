import { test } from 'node:test'
import assert from 'node:assert/strict'
import { templateProject } from '../demo.js'
import { validateProject, validateRuntime } from '../model.js'
import { setupScene } from '../../scene-runtime/test/helpers.js'

test('只提供会客厅模板，所有对象类型均由保留插件注册', async t => {
  validateProject(templateProject())
  for (const id of ['hybrid', 'galgame', 'tavern']) assert.throws(() => templateProject(id), /仅提供七日会客厅/)
  const f = await setupScene(t)
  assert.deepEqual(f.scene.validate(), [])
  assert.deepEqual(f.engine.nodeTypes(), [], '场景玩法不需要旧剧情插件注册处理器')
  await f.engine.play()
  assert.equal(f.engine.runtime.error, '')
  await f.scene.call('lin-session', 'send', {text:'你好'})
  await f.scene.call('yao-session', 'send', {text:'你好遥'})
  await f.scene.call('next-day', 'click', {})
  assert.equal(f.scene.runtime.state('relationship').value, 2)
  assert.equal(f.scene.runtime.state('day').value, 2)
  const snapshot = validateRuntime(f.engine.runtime, f.engine.project)
  f.engine.stop()
  f.engine.restoreRuntime(snapshot)
  assert.equal(f.scene.runtime.state('day').value, 2)
  assert.equal(f.scene.runtime.state('lin-session').messages.length, 2)
  assert.deepEqual(f.toasts, [])
})
