import test from 'node:test'
import assert from 'node:assert/strict'
import { createFlowHandlers, createNode, flowEdges } from '../model.js'
import { actionAssetOptions, actionFieldDefault } from '../editor.js'

const line = text => ({ speaker: 'lin', text })
const node = (patch = {}) => ({ id: 'intro', type: 'story', title: '初遇', stage: { background: 'sky', characterId: 'lin', expression: 'happy', position: 62, scale: 110 }, lines: [line('第一句'), line('第二句')], choices: [], next: '', ...patch })
function harness() {
  const engine = {
    mode: 'play', held: false, calls: [],
    runtime: { nodeId: 'intro', lineIndex: 7, text: line('旧对白'), stage: {}, ended: true, busy: false },
    transact(change) { change(this.runtime) },
    async go(target) { this.calls.push(target); this.runtime.nodeId = target },
  }
  return { engine, ...createFlowHandlers(engine) }
}

test('只提供剧情和结局处理器，自由聊天仍由外部节点插件拥有', () => {
  const handlers = createFlowHandlers(harness().engine)
  assert.deepEqual(Object.keys(handlers), ['story', 'ending'])
  for (const handler of Object.values(handlers)) { assert.equal(typeof handler.enter, 'function'); assert.equal(typeof handler.advance, 'function') }
})

test('进入剧情重置对白位置、复制第一句与完整舞台，并清除旧结局状态', () => {
  const { engine, story } = harness(), source = node()
  story.enter(source)
  assert.equal(engine.runtime.lineIndex, 0)
  assert.deepEqual(engine.runtime.text, source.lines[0])
  assert.deepEqual(engine.runtime.stage, source.stage)
  assert.equal(engine.runtime.ended, false)
  engine.runtime.text.text = '仅改变运行时'
  engine.runtime.stage.expression = 'sad'
  assert.equal(source.lines[0].text, '第一句')
  assert.equal(source.stage.expression, 'happy')
})

test('空对白会清除上一幕的文字，并为部分舞台补全默认值', () => {
  const { engine, story } = harness()
  story.enter(node({ lines: [], stage: { background: 'night' } }))
  assert.deepEqual(engine.runtime.text, { speaker: '', text: '' })
  assert.equal(engine.runtime.lineIndex, 0)
  assert.deepEqual(engine.runtime.stage, { background: 'night', characterId: '', expression: 'neutral', position: 50, scale: 100 })
})

test('逐句推进，最后一句停留至下一次继续才跳转', async () => {
  const { engine, story } = harness(), source = node({ next: 'after' })
  story.enter(source)
  await story.advance(source)
  assert.equal(engine.runtime.lineIndex, 1)
  assert.deepEqual(engine.runtime.text, source.lines[1])
  assert.deepEqual(engine.calls, [])
  await story.advance(source)
  assert.deepEqual(engine.calls, ['after'])
})

test('分支必须显式选择，不绕过选项沿 next 自动跳转', async () => {
  const { engine, story } = harness(), source = node({ lines: [line('选择吧')], choices: [{ id: 'a', target: 'branch' }], next: 'fallback' })
  story.enter(source)
  await story.advance(source)
  await story.advance(source)
  assert.deepEqual(engine.calls, [])
  assert.equal(engine.runtime.lineIndex, 0)
  assert.equal(engine.runtime.ended, false)
})

test('没有后续节点的剧情在读完后结束，空节点不会产生越界行号', async () => {
  for (const lines of [[], [line('最后的话')]]) {
    const { engine, story } = harness(), source = node({ lines })
    story.enter(source)
    assert.equal(engine.runtime.ended, false)
    await story.advance(source)
    assert.equal(engine.runtime.ended, true)
    assert.equal(engine.runtime.lineIndex, 0)
    await story.advance(source)
    assert.equal(engine.runtime.lineIndex, 0)
  }
})

test('多句结局到最后一句才置 ended，结束后不沿遗留 next 离开', async () => {
  const { engine, ending } = harness(), source = node({ type: 'ending', next: 'unused' })
  ending.enter(source)
  assert.equal(engine.runtime.ended, false)
  await ending.advance(source)
  assert.equal(engine.runtime.lineIndex, 1)
  assert.equal(engine.runtime.text.text, '第二句')
  assert.equal(engine.runtime.ended, true)
  await ending.advance(source)
  assert.deepEqual(engine.calls, [])
  assert.equal(engine.runtime.lineIndex, 1)
})

test('单句或空结局在进入时结束，但保留可阅读的最后文本', () => {
  for (const lines of [[], [line('故事结束')]]) {
    const { engine, ending } = harness()
    ending.enter(node({ type: 'ending', lines }))
    assert.equal(engine.runtime.ended, true)
    assert.equal(engine.runtime.text.text, lines[0]?.text || '')
  }
})

test('编辑预览和失效的旧节点处理器都不会修改运行时', async () => {
  for (const mode of ['edit', 'play']) {
    const { engine, story } = harness()
    engine.mode = mode
    if (mode === 'play') engine.runtime.nodeId = 'other'
    const before = structuredClone(engine.runtime)
    story.enter(node())
    await story.advance(node())
    assert.deepEqual(engine.runtime, before)
    assert.deepEqual(engine.calls, [])
  }
})

test('忙碌或插件切换保护期间不推进对白', async () => {
  for (const property of ['busy', 'held']) {
    const { engine, story } = harness(), source = node()
    story.enter(source)
    if (property === 'busy') engine.runtime.busy = true; else engine.held = true
    await story.advance(source)
    assert.equal(engine.runtime.lineIndex, 0)
  }
})

test('advance 等待异步节点进入完成，向调用方传播连接错误', async () => {
  const { engine, story } = harness(), source = node({ lines: [], next: 'after' })
  story.enter(source)
  let release, finished = false
  engine.go = async target => { assert.equal(target, 'after'); await new Promise(resolve => { release = resolve }) }
  const pending = story.advance(source).then(() => { finished = true })
  await Promise.resolve()
  assert.equal(finished, false)
  release(); await pending
  assert.equal(finished, true)
  engine.go = async () => { throw Error('连接不存在') }
  await assert.rejects(story.advance(source), /连接不存在/)
})

test('新节点数据彼此隔离，聊天节点只生成契约数据', () => {
  const a = createNode('story'), b = createNode('ending'), chat = createNode('chat', [{ id: 'lin' }])
  assert.notEqual(a.id, b.id)
  a.lines.push(line('仅属于剧情')); a.stage.position = 70
  assert.deepEqual(b.lines, [])
  assert.equal(b.stage.position, 50)
  assert.equal(chat.chat.characterId, 'lin')
  assert.equal(chat.chat.maxTurns, 4)
  assert.deepEqual(chat.chat.demoReplies, [])
  assert.equal(createNode('chat').chat.characterId, '')
})

test('缩略图只连接有效且可执行的边，保留自循环与聊天出口', () => {
  const rows = [
    node({ id: 'a', choices: [{ text: '自己', target: 'a' }, { text: '聊天', target: 'b' }, { target: 'missing' }], next: 'c' }),
    node({ id: 'b', type: 'chat', chat: { next: 'c' }, next: 'a' }),
    node({ id: 'c', type: 'ending', next: 'a' }),
    node({ id: 'd', next: 'a' }),
  ]
  assert.deepEqual(flowEdges(rows), [
    { from: 'a', to: 'a', label: '自己' }, { from: 'a', to: 'b', label: '聊天' },
    { from: 'b', to: 'c', label: '继续' }, { from: 'd', to: 'a', label: '继续' },
  ])
})

test('贡献动作的素材选项按 assetKind 过滤，始终允许使用默认素材', () => {
  const project = { assets: [{ id: 'sky', name: '星空', kind: 'image' }, { id: 'rain', name: '雨声', kind: 'audio' }, { id: 'music', name: '', kind: 'audio' }] }
  assert.deepEqual(actionAssetOptions({ kind: 'asset', assetKind: 'audio' }, project), [['', '使用默认素材'], ['rain', '雨声'], ['music', 'music']])
  assert.equal(actionAssetOptions({ kind: 'asset' }, project).length, 4)
  assert.deepEqual(actionAssetOptions({ assetKind: 'audio' }, { assets: [] }), [['', '使用默认素材']])
})

test('声音与 Live2D 动作初始化保留 boolean、空素材、字符串和数字默认值', () => {
  const project = { variables: [{ id: 'trust' }], nodes: [{ id: 'intro' }] }
  const fields = [{ key: 'asset', kind: 'asset' }, { key: 'loop', kind: 'boolean', default: true }, { key: 'muted', kind: 'boolean' }, { key: 'expression', kind: 'string', default: 'smile' }, { key: 'group', kind: 'string', default: 'Idle' }, { key: 'index', kind: 'number', default: 0 }]
  assert.deepEqual(Object.fromEntries(fields.map(spec => [spec.key, actionFieldDefault(spec, project)])), { asset: '', loop: true, muted: false, expression: 'smile', group: 'Idle', index: 0 })
  assert.equal(actionFieldDefault({ kind: 'boolean', default: false }, project), false)
  assert.equal(actionFieldDefault({ kind: 'variable' }, project), 'trust')
  assert.equal(actionFieldDefault({ kind: 'node' }, project), 'intro')
})
