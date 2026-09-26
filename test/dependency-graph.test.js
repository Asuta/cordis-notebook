import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dependencyGraph } from '../client/host/dependency-graph.js'

const plugin = (id, dependencies = []) => ({ id, requires: { client: dependencies }, provides: { client: [id] }, bindings: { client: Object.fromEntries(dependencies.map(name => [name, name])) } })
test('共享依赖保留所有边，间接影响只计数一次', () => {
  const graph = dependencyGraph([plugin('storage'), plugin('layout'), plugin('notes', ['storage']), plugin('api', ['notes']), plugin('notebook', ['api', 'layout']), plugin('editor', ['notebook']), plugin('lab', ['layout', 'notes'])])
  assert.deepEqual(graph.roots, ['storage', 'layout'])
  assert.deepEqual(graph.children.get('layout'), [{ id: 'notebook', reference: true }, { id: 'lab', reference: false }])
  assert.deepEqual([...graph.upstream('editor')].sort(), ['api', 'layout', 'notebook', 'notes', 'storage'])
  assert.deepEqual([...graph.downstream('storage')].sort(), ['api', 'editor', 'lab', 'notebook', 'notes'])
  assert.equal([...graph.children.values()].flat().length, 7)
})
test('缺失依赖和循环不会让节点消失或无限递归', () => {
  const graph = dependencyGraph([plugin('a', ['b']), plugin('b', ['a']), plugin('orphan', ['missing'])])
  assert.equal(graph.cycles.size, 2)
  assert.ok(graph.roots.includes('orphan'))
  assert.deepEqual([...graph.upstream('orphan')], ['missing'])
  assert.deepEqual([...graph.downstream('a')], ['b'])
  const displayed = new Set()
  const walk = id => { assert.ok(!displayed.has(id)); displayed.add(id); for (const child of graph.children.get(id)) if (!child.reference) walk(child.id) }
  graph.roots.forEach(walk); assert.equal(displayed.size, 3)
})
