import test from 'node:test'
import assert from 'node:assert/strict'
import { storyTree, outlineTree, descendants } from '../model.js'

const choice = (id, targetId) => ({ id, text: id, targetId, condition: null, effects: [] })
const scene = (id, choices = [], ending = false) => ({ id, title: id, backgroundId: '', musicId: '', leftCharacterId: '', rightCharacterId: '', ending, lines: [], choices })
const project = (scenes, startSceneId = 's1') => ({ schemaVersion: 1, id: 'p', revision: 0, title: 'p', description: '', startSceneId, variables: [], cast: [], assets: [], scenes })

test('从起点按顺序编号展开，重复到达记为引用，环不会无限递归', () => {
  const p = project([
    scene('s1', [choice('a', 's2'), choice('b', 's3')]),
    scene('s2', [choice('c', 's1'), choice('d', 's3')]),
    scene('s3', [], true),
    scene('s4', [], true)
  ])
  const { root, unreachable } = storyTree(p)
  assert.equal(root.id, 's1')
  assert.equal(root.seq, 1)
  assert.deepEqual(root.children.map(child => child.choice.id), ['a', 'b'])
  const merge = root.children[0].node
  assert.equal(merge.id, 's2')
  assert.equal(merge.seq, 2)
  assert.equal(merge.children[0].node.ref, true)
  assert.equal(merge.children[0].node.id, 's1')
  const shared = merge.children[1].node
  assert.equal(shared.id, 's3')
  assert.equal(shared.seq, 3)
  assert.equal(shared.ref, undefined)
  assert.equal(root.children[1].node.ref, true)
  assert.equal(root.children[1].node.id, 's3')
  assert.deepEqual(unreachable.map(item => item.id), ['s4'])
  // 引用节点也是折叠后会被隐藏的一行，因此一并计数
  assert.equal(descendants(root), 4)
  assert.equal(descendants(root.children[0].node), 2)
})

test('侧栏按树先序列出场景与层级', () => {
  const p = project([
    scene('s1', [choice('a', 's2'), choice('b', 's3')]),
    scene('s2', [choice('c', 's3')]),
    scene('s3', [], true)
  ])
  const { items, unreachable } = outlineTree(p)
  assert.deepEqual(items.map(item => item.id), ['s1', 's2', 's3'])
  assert.deepEqual(items.map(item => item.depth), [0, 1, 2])
  assert.deepEqual(unreachable, [])
})

test('未设置或已失效的目标场景单独标记，不进入子节点', () => {
  const p = project([scene('s1', [choice('a', 'ghost'), choice('b', '')])])
  const { root } = storyTree(p)
  assert.equal(root.children.length, 2)
  assert.equal(root.children[0].node, undefined)
  assert.match(root.children[0].missing, /目标场景已不存在/)
  assert.match(root.children[1].missing, /没有设置目标场景/)
})

test('指向自身的选项显示为引用节点', () => {
  const p = project([scene('s1', [choice('a', 's1')])])
  const { root } = storyTree(p)
  assert.equal(root.children[0].node.ref, true)
  assert.equal(root.children[0].node.id, 's1')
})

test('起点失效时没有树，所有场景都算未连接', () => {
  const p = project([scene('s1'), scene('s2')], 'missing')
  const { root, unreachable } = storyTree(p)
  assert.equal(root, null)
  assert.deepEqual(unreachable.map(item => item.id), ['s1', 's2'])
  assert.deepEqual(outlineTree(p).items, [])
})
