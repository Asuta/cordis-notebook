import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { lastTrainProject } from '../last-train.js'
import { diagnose, initialRuntime, validateProject, validateRuntime } from '../model.js'
import { expandScene } from '../composition.js'

const project = () => lastTrainProject(undefined, 'last-train-test')

// Enumerate serialized story data, including the variable state, independently
// of the story-flow plugin. This verifies content reachability, not UI playback.
function availableChoices(node, variables) {
  return node.choices.filter(({ condition }) => {
    if (!condition) return true
    assert.equal(condition.type, 'variable')
    assert.ok(Object.hasOwn(variables, condition.variable))
    assert.ok(['gte', 'lt'].includes(condition.op))
    return condition.op === 'gte'
      ? variables[condition.variable] >= condition.value
      : variables[condition.variable] < condition.value
  })
}

function routes(value) {
  const nodes = new Map(value.nodes.map(node => [node.id, node]))
  const completed = []
  function visit(id, variables, path = [], decisions = []) {
    const node = nodes.get(id)
    assert.ok(node, `连接的节点必须存在：${id}`)
    assert.ok(!path.includes(id), `路径不能循环：${[...path, id].join(' → ')}`)
    path = [...path, id]
    if (node.type === 'ending') {
      assert.equal(node.choices.length, 0, '结局不能继续分支')
      assert.ok(!node.next, '结局不能继续跳转')
      completed.push({ path, decisions, variables, ending: id, lines: path.flatMap(key => nodes.get(key).lines) })
      return
    }
    assert.equal(node.type, 'story')
    if (!node.choices.length) {
      assert.ok(node.next, `${id} 不得成为死路`)
      visit(node.next, { ...variables }, path, decisions)
      return
    }
    assert.ok(!node.next, '选择节点不同时指定自动跳转，避免绕过玩家选择')
    const choices = availableChoices(node, variables)
    assert.equal(choices.length, 2, `${id} 在可达状态下必须恰有两个可选项`)
    for (const choice of choices) {
      const next = { ...variables }
      for (const action of choice.actions) {
        assert.equal(action.type, 'add-variable')
        const definition = value.variables.find(variable => variable.id === action.variable)
        assert.ok(definition, '动作必须引用已定义变量')
        next[action.variable] += action.value
        assert.ok(next[action.variable] >= definition.min && next[action.variable] <= definition.max, '实际路径不依赖运行时截断越界数值')
      }
      visit(choice.target, next, path, [...decisions, { node: id, choice: choice.id, before: { ...variables }, after: next }])
    }
  }
  visit(value.startNodeId, initialRuntime(value).variables)
  return completed
}

test('末班车模板可校验、可序列化且诊断无缺失引用', () => {
  const value = project()
  assert.equal(validateProject(value), value)
  assert.deepEqual(diagnose(value), [])
  assert.equal(value.template, 'last-train')
  assert.equal(value.title, '末班车之前')
  assert.equal(value.id, 'last-train-test')
  assert.equal(value.settings.dialogueStyle, 'novel')
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(value))), value)
  const custom = lastTrainProject('自定义作品名', 'custom-last-train')
  validateProject(custom)
  assert.equal(custom.title, '自定义作品名')
  assert.equal(custom.id, 'custom-last-train')
  assert.equal(custom.composition.scenes[0].objects.find(o=>o.type==='playback-controls').props.title, custom.title)
  const generated = lastTrainProject()
  validateProject(generated)
  assert.notEqual(generated.id, lastTrainProject().id)
})

test('游戏由独立对象及连接组合，不依赖整体播放器', () => {
  const doc=project().composition,scene=expandScene(doc,'main')
  assert.ok(!doc.dependencies.some(d=>d.id==='visual-novel'))
  assert.ok(scene.objects.some(o=>o.type==='story-flow'))
  assert.ok(scene.objects.some(o=>o.type==='dialogue-view'))
  assert.ok(!scene.objects.some(o=>o.type==='story-player'))
  assert.ok(scene.connections.some(c=>c.event==='continued'&&c.method==='advance'))
})

test('只使用已公开且真实存在的四项内置素材，角色明确成年', async () => {
  const value = project()
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const expected = ['station.png', 'observatory.png', 'lin.png', 'rain-theme.wav']
  assert.deepEqual(value.assets.map(asset => asset.url.split('/').at(-1)).sort(), expected.sort())
  for (const asset of value.assets) {
    const path = asset.url.replace('/builtin/project/', '')
    assert.ok(manifest.cordis.public.includes(path), `${asset.url} 必须已公开`)
    assert.ok((await stat(new URL('../' + path, import.meta.url))).size > 0)
    assert.equal(asset.kind, path.endsWith('.wav') ? 'audio' : 'image')
  }
  assert.deepEqual(value.characters.map(character => character.id), ['lin'])
  const character = value.characters[0]
  assert.match(character.description, /二十六岁.*成年研究员/)
  const images = new Set(value.assets.filter(asset => asset.kind === 'image').map(asset => asset.id))
  for (const image of [character.portrait, ...Object.values(character.expressions)]) assert.ok(images.has(image))
  assert.equal(value.settings.bgm, 'rain-theme')
})

test('每个节点独立配置舞台，台词仅用林栀或空 speaker 且不依赖自由聊天', () => {
  const value = project()
  assert.deepEqual(new Set(value.nodes.map(node => node.stage.background)), new Set(['station', 'observatory']))
  assert.deepEqual(new Set(value.nodes.map(node => node.stage.characterId)), new Set(['lin', '']))
  for (const node of value.nodes) {
    assert.ok(['story', 'ending'].includes(node.type))
    assert.equal(node.chat, undefined)
    assert.ok(node.lines.length > 0, `${node.id} 不能是空白过渡`)
    for (const line of node.lines) {
      assert.ok(['lin', ''].includes(line.speaker))
      assert.ok(line.text.trim().length >= 8, '台词或旁白应是完整句子')
    }
    const runtime = initialRuntime(value, node.id)
    assert.deepEqual(runtime.stage, node.stage)
    assert.notEqual(runtime.stage, node.stage)
    runtime.lineIndex = node.lines.length - 1
    runtime.text = { ...node.lines.at(-1) }
    assert.deepEqual(validateRuntime(runtime, value), runtime)
  }
})

test('带变量状态穷举八条完整路线，全部节点和选项可达，每条恰有三次选择', () => {
  const value = project(), paths = routes(value)
  assert.equal(paths.length, 8)
  assert.equal(value.nodes.filter(node => node.choices.length).length, 3)
  assert.deepEqual(new Set(paths.flatMap(route => route.path)), new Set(value.nodes.map(node => node.id)))
  const selected = new Set(paths.flatMap(route => route.decisions.map(decision => decision.node + '/' + decision.choice)))
  assert.deepEqual(selected, new Set(value.nodes.flatMap(node => node.choices.map(choice => node.id + '/' + choice.id))))
  assert.deepEqual(new Set(paths.map(route => route.ending)), new Set(['promise', 'quiet']))
  assert.equal(value.nodes.filter(node => node.type === 'ending').length, 2)
  for (const route of paths) {
    assert.equal(route.decisions.length, 3)
    assert.equal(route.path.filter(id => value.nodes.find(node => node.id === id).type === 'ending').length, 1)
  }
})

test('前两次选择改变实际对白，第三次选择尊重累计信任及主动告别', () => {
  const value = project(), paths = routes(value)
  const byId = new Map(value.nodes.map(node => [node.id, node]))
  for (const id of ['arrival', 'observatory']) {
    const choices = byId.get(id).choices
    assert.notEqual(choices[0].target, choices[1].target)
    assert.notDeepEqual(byId.get(choices[0].target).lines, byId.get(choices[1].target).lines)
    assert.ok(byId.get(choices[0].target).lines.length >= 8)
    assert.ok(byId.get(choices[1].target).lines.length >= 8)
  }
  const platform = byId.get('platform')
  for (const trust of [0, 1, 2, 3]) {
    const ids = availableChoices(platform, { trust }).map(choice => choice.id)
    assert.deepEqual(ids, [trust >= 2 ? 'promise' : 'leave-an-invitation', 'say-goodnight'])
  }
  for (const route of paths) {
    const last = route.decisions.at(-1)
    const invited = last.choice !== 'say-goodnight'
    assert.equal(route.ending, invited && last.before.trust >= 2 ? 'promise' : 'quiet')
    if (last.choice === 'leave-an-invitation') assert.ok(route.path.includes('invitation'))
    if (last.choice === 'say-goodnight') assert.ok(route.path.includes('goodnight'))
  }
  // In particular, the invitation's +1 cannot retroactively unlock the promise.
  assert.ok(paths.some(route => route.decisions.at(-1).choice === 'leave-an-invitation' && route.variables.trust === 2 && route.ending === 'quiet'))
  assert.ok(paths.some(route => route.decisions.at(-1).choice === 'say-goodnight' && route.variables.trust === 2 && route.ending === 'quiet'))
})

test('全稿与每条实际路线均至少七十五句，阅读量不以不可见分支凑数', t => {
  const value = project(), paths = routes(value)
  const allLines = value.nodes.flatMap(node => node.lines)
  assert.ok(allLines.length >= 75)
  assert.equal(new Set(allLines.map(line => line.text)).size, allLines.length, '不重复填充台词')
  const lengths = paths.map(route => route.lines.length)
  const characters = paths.map(route => route.lines.reduce((count, line) => count + line.text.length, 0))
  for (const route of paths) {
    assert.ok(route.lines.length >= 75, `${route.ending} 的实际路线对白不足`)
    assert.ok(route.lines.filter(line => line.speaker === 'lin').length >= 25)
    assert.ok(route.lines.reduce((count, line) => count + line.text.length, 0) >= 3500, '每条路线应有完整短篇阅读量')
  }
  t.diagnostic(`全稿 ${allLines.length} 句；单路线 ${Math.min(...lengths)}–${Math.max(...lengths)} 句，${Math.min(...characters)}–${Math.max(...characters)} 字符。时长取决于实际阅读速度。`)
})

test('作品实例不共享台词、舞台、变量、动作、角色或场景的可变数据', () => {
  const first = project(), second = project(), baseline = structuredClone(second)
  first.nodes[0].lines[0].text = '修改台词'
  first.nodes[0].stage.background = 'observatory'
  first.nodes[0].choices[0].actions[0].value = 99
  first.nodes.find(node => node.id === 'platform').choices[0].condition.value = 99
  first.variables[0].initial = 2
  first.characters[0].expressions.happy = 'changed'
  first.assets[0].url = 'changed'
  first.composition.scenes[0].objects[0].props.title = '修改标题'
  assert.deepEqual(second, baseline)
  assert.notEqual(first.nodes[0].stage, first.nodes[1].stage)
})
