import { test } from 'node:test'
import assert from 'node:assert/strict'
import { configureDemo } from '../demo.js'
import { templateProject } from '../../project/demo.js'
import { validateProject, diagnose } from '../../project/model.js'
import { PARAMS } from '../compiled/runtime.js'

test('Miko 演示是独立且可校验的剧情，左右转头使用真实参数范围', () => {
  const project = templateProject('galgame'), cid = project.characters[0].id
  configureDemo(project, cid); validateProject(project)
  assert.deepEqual(diagnose(project), [])
  assert.equal(project.nodes[0].choices.length, 4)
  assert.ok(project.nodes.every(n => n.stage.characterId === cid && n.lines.every(l => l.speaker === cid)))
  for (const rule of project.rules) for (const action of rule.actions) if (action.type === 'mesh-pose') for (const [key, value] of Object.entries(action)) if (key !== 'type') { const p = PARAMS.find(p => p.id === key); assert.ok(p, key); assert.ok(value >= p.min && value <= p.max, key) }
})
