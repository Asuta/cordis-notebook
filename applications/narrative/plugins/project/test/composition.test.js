import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultComposition, editComposition, expandScene, validateComposition } from '../composition.js'

const base = () => defaultComposition({ characters: [{ id: 'lin' }] })
test('预制体复用定义，实例 ID、引用和覆盖彼此隔离', () => {
  const original = base()
  let doc = editComposition(original, { op: 'instantiate', id: 'first', prefabId: 'standard-chat', prefabVersion: 1 })
  doc = editComposition(doc, { op: 'instantiate', id: 'second', prefabId: 'standard-chat', prefabVersion: 1 })
  doc = editComposition(doc, { op: 'patch', id: 'first', patch: { overrides: { session: { props: { source: 'script', script: '只属于第一份' } } } } })
  const rows = expandScene(doc, 'main').objects
  assert.equal(rows.find(o => o.id === 'first--window').refs.session, 'first--session')
  assert.equal(rows.find(o => o.id === 'second--window').refs.session, 'second--session')
  assert.equal(rows.find(o => o.id === 'first--session').props.script, '只属于第一份')
  assert.equal(rows.find(o => o.id === 'second--session').props.source, 'ai')
  assert.deepEqual(doc.prefabs, original.prefabs)
  assert.equal(original.scenes[0].objects.length, 1)
  doc = editComposition(doc, { op: 'unpack', id: 'first' })
  assert.equal(doc.scenes[0].objects.find(o => o.id === 'first--session').props.script, '只属于第一份')
})

test('批量操作继承所选场景，子操作仍可显式指定其他场景', () => {
  const doc = editComposition(base(), { op: 'add-scene', id: 'second', name: '第二幕' })
  const result = editComposition(doc, { op: 'batch', sceneId: 'second', commands: [
    { op: 'add', id: 'title', type: 'text', props: { text: '第二幕' } },
    { op: 'patch', id: 'title', patch: { name: '修改成功' } },
    { op: 'add', sceneId: 'main', id: 'extra', type: 'text' },
  ] })
  assert.equal(result.scenes[1].objects[0].name, '修改成功')
  assert.equal(result.scenes[0].objects.at(-1).id, 'extra')
  assert.equal(doc.scenes[1].objects.length, 0)
})

test('循环层级、坏引用和不存在的预制体版本被拒绝，失败不修改输入', () => {
  let doc = editComposition(base(), { op: 'add', id: 'root', type: 'container' })
  doc = editComposition(doc, { op: 'add', id: 'child', type: 'container', parent: 'root' })
  assert.throws(() => editComposition(doc, { op: 'move', id: 'root', parent: 'child' }), /循环/)
  assert.throws(() => editComposition(doc, { op: 'add', id: 'bad', type: 'value', refs: { value: 'missing' } }), /引用/)
  assert.throws(() => editComposition(doc, { op: 'instantiate', prefabId: 'standard-chat', prefabVersion: 2 }), /版本不存在/)
  assert.throws(() => editComposition(doc, { op: 'batch', commands: [null] }), /批量操作/)
  validateComposition(doc)
  assert.equal(doc.scenes[0].objects.find(o => o.id === 'root').parent, null)
})

test('复制对象组合重定向内部引用和连接，外部引用阻止误删', () => {
  let doc = base(), sequence = 0
  for (const command of [
    { op: 'add', id: 'root', type: 'container' },
    { op: 'add', id: 'count', type: 'counter', parent: 'root' },
    { op: 'add', id: 'display', type: 'value', parent: 'root', refs: { value: 'count' } },
    { op: 'add', id: 'button', type: 'button', parent: 'root' },
    { op: 'connect', id: 'wire', source: 'button', event: 'clicked', target: 'count', method: 'add' },
  ]) doc = editComposition(doc, command)
  const copied = editComposition(doc, { op: 'clone', id: 'root' }, () => 'copy-' + ++sequence)
  const rows = copied.scenes[0].objects.filter(o => o.id.startsWith('copy-'))
  assert.equal(rows.find(o => o.type === 'value').refs.value, rows.find(o => o.type === 'counter').id)
  assert.equal(copied.scenes[0].connections.at(-1).target, rows.find(o => o.type === 'counter').id)
  assert.throws(() => editComposition(doc, { op: 'remove', id: 'count' }), /仍引用/)
  assert.equal(editComposition(doc, { op: 'remove', id: 'root' }).scenes[0].connections.length, 0)
})
