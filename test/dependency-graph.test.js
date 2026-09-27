import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dependencyGraph } from '../client/host/dependency-graph.js'
import { dependencyLayout, dependencyPath } from '../client/host/dependency-layout.js'

const plugin = (id, dependencies = []) => ({ id, requires: { client: dependencies }, provides: { client: [id] }, bindings: { client: Object.fromEntries(dependencies.map(name => [name, name])) } })
test('共享依赖保留所有边，间接影响只计数一次', () => {
  const graph = dependencyGraph([plugin('storage'), plugin('layout'), plugin('notes', ['storage']), plugin('api', ['notes']), plugin('notebook', ['api', 'layout']), plugin('editor', ['notebook']), plugin('lab', ['layout', 'notes'])])
  assert.deepEqual(graph.roots, ['storage', 'layout'])
  assert.deepEqual(graph.dependents.get('layout'), ['notebook', 'lab'])
  assert.deepEqual([...graph.upstream('editor')].sort(), ['api', 'layout', 'notebook', 'notes', 'storage'])
  assert.deepEqual([...graph.downstream('storage')].sort(), ['api', 'editor', 'lab', 'notebook', 'notes'])
  assert.equal(graph.edges.length, 7)
  const layout = dependencyLayout(graph)
  assert.equal(layout.nodes.size, 7)
  for (const edge of graph.edges) {
    const a = layout.nodes.get(edge.source), b = layout.nodes.get(edge.target)
    assert.ok(a.x + a.width < b.x, '服务提供者必须在使用者左侧')
    assert.ok(dependencyPath(a, b).startsWith(`M ${a.x + a.width} ${a.y + a.height / 2}`))
  }
})
test('缺失依赖和循环不会让节点消失或无限递归', () => {
  const graph = dependencyGraph([plugin('a', ['b']), plugin('b', ['a']), plugin('orphan', ['missing'])])
  assert.equal(graph.cycles.size, 2)
  assert.ok(graph.roots.includes('orphan'))
  assert.deepEqual([...graph.upstream('orphan')], ['missing'])
  assert.deepEqual([...graph.downstream('a')], ['b'])
  const layout = dependencyLayout(graph)
  assert.equal(layout.nodes.size, 3)
  assert.equal(graph.edges.length, 2, '缺失插件不制造虚假节点')
  for (const edge of graph.edges) assert.match(dependencyPath(layout.nodes.get(edge.source), layout.nodes.get(edge.target)), / L /)
})

test('同一对插件的前后端服务合并成一条边，宿主与未确定候选不连线', () => {
  const provider = { ...plugin('provider'), provides: { client: ['a', 'b'], server: ['a'] } }
  const other = { ...plugin('other'), provides: { client: ['choice'] } }
  const second = { ...plugin('second'), provides: { client: ['choice'] } }
  const consumer = { ...plugin('consumer'), requires: { client: ['a', 'b', 'choice', 'pluginManagement'], server: ['a', 'http'] },
    bindings: { client: { a: 'provider', pluginManagement: '@host' }, server: { a: 'provider', http: '@host' } },
    packageDependencies: { other: 'workspace:*' } }
  const graph = dependencyGraph([provider, other, second, consumer])
  assert.equal(graph.edges.length, 1)
  assert.deepEqual(graph.edges[0].services.map(s => [s.scope, s.name, s.bound]), [['server', 'a', true], ['client', 'a', true], ['client', 'b', false]])
  assert.deepEqual(graph.dependencies.get('consumer'), ['provider'])
  assert.equal(graph.relations.get('consumer').find(s => s.name === 'choice').candidates.length, 2)
})

test('通过非首条依赖构成的环也能识别，布局稳定且无重叠', () => {
  const items = [plugin('root'), plugin('a', ['root', 'c']), plugin('b', ['a']), plugin('c', ['b']), plugin('end', ['c'])]
  const graph = dependencyGraph(items), layout = dependencyLayout(graph)
  assert.deepEqual([...graph.cycles].sort(), ['a', 'b', 'c'])
  assert.deepEqual(dependencyLayout(dependencyGraph([...items].reverse())), layout)
  assert.deepEqual(dependencyLayout(dependencyGraph(items.map(p => ({ ...p, state: 'disabled' })))), layout)
  const nodes = [...layout.nodes.values()]
  for (let i = 0; i < nodes.length; i++) for (const b of nodes.slice(i + 1)) {
    const a = nodes[i]
    assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y)
  }
  assert.equal(dependencyLayout(dependencyGraph([])).nodes.size, 0)
})
