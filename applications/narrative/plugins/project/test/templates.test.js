import { test } from 'node:test'
import assert from 'node:assert/strict'
import { templateProject } from '../demo.js'
import { validateProject, validateRuntime } from '../model.js'
import { setupScene } from '../../scene-runtime/test/helpers.js'

test('会客厅模板仍可独立运行，旧模板入口保持关闭', async t => {
  validateProject(templateProject())
  validateProject(templateProject('last-train'))
  for (const id of ['hybrid', 'galgame', 'tavern']) assert.throws(() => templateProject(id), /请选择七日会客厅或末班车之前/)
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
