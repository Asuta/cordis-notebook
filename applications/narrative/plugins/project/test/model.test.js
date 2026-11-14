import { test } from 'node:test'
import assert from 'node:assert/strict'
import { templateProject } from '../demo.js'
import { diagnose, initialRuntime, validateProject, validateRuntime } from '../model.js'

const project = () => templateProject('hybrid', '测试作品', 'test-project')
const invalid = (run, message) => assert.throws(run, error => error.status === 400 && message.test(error.message))

for (const template of ['hybrid', 'galgame', 'tavern']) {
  test(`${template} 模板可校验，所有剧情连接与素材存在，每个结局可从起点到达`, () => {
    const value = templateProject(template, undefined, 'demo-' + template)
    validateProject(value)
    assert.deepEqual(diagnose(value), [])
    const nodes = new Map(value.nodes.map(node => [node.id, node]))
    const assets = new Set(value.assets.map(asset => asset.id))
    for (const character of value.characters) {
      for (const id of [character.portrait, ...Object.values(character.expressions)]) {
        if (id) assert.ok(assets.has(id), `${character.name} 的立绘或表情素材 ${id} 缺失`)
      }
    }
    const visited = new Set(), endings = new Set()
    function visit(id, path = []) {
      const node = nodes.get(id)
      assert.ok(node, `剧情连接 ${id} 必须存在`)
      assert.ok(!path.includes(id), `模板路径不能陷入循环：${[...path, id].join(' → ')}`)
      visited.add(id)
      if (node.type === 'ending') { endings.add(id); return }
      const targets = [...node.choices.map(choice => choice.target), node.next, node.chat?.next].filter(Boolean)
      assert.ok(targets.length, `${node.title} 必须有通往后续剧情的连接`)
      for (const target of targets) visit(target, [...path, id])
    }
    visit(value.startNodeId)
    assert.deepEqual([...visited].sort(), [...nodes.keys()].sort(), '模板不能遗留无法到达的节点')
    assert.deepEqual([...endings].sort(), template === 'tavern' ? ['quiet'] : ['quiet', 'starlight'])
    assert.equal(value.settings.dialogueStyle, template === 'tavern' ? 'chat' : 'novel')
  })
}

test('模板之间不共享可变的角色、舞台、选项或规则数据', () => {
  const first = project(), second = project()
  first.characters[0].expressions.happy = 'changed'
  first.nodes[0].stage.position = 10
  first.nodes[0].choices[0].actions[0].value = 9
  first.rules[0].actions[0].value = 'sad'
  assert.equal(second.characters[0].expressions.happy, 'lin')
  assert.equal(second.nodes[0].stage.position, 62)
  assert.equal(second.nodes[0].choices[0].actions[0].value, 1)
  assert.equal(second.rules[0].actions[0].value, 'happy')
})

test('导入拒绝损坏的版本、标识、范围、节点与扩展配置', async t => {
  const cases = [
    ['错误结构版本', p => { p.schemaVersion = 2 }],
    ['路径形式的作品标识', p => { p.id = '../outside' }],
    ['非整数修订版本', p => { p.revision = 0.5 }],
    ['负修订版本', p => { p.revision = -1 }],
    ['空白标题', p => { p.title = '  ' }],
    ['不存在的起点', p => { p.startNodeId = 'missing' }],
    ['重复节点标识', p => { p.nodes[1].id = p.nodes[0].id }],
    ['初值超出属性范围', p => { p.variables[0].initial = 11 }],
    ['非有限属性', p => { p.variables[0].max = Infinity }],
    ['反向属性范围', p => { p.variables[0].min = 5; p.variables[0].max = 2 }],
    ['舞台位置越界', p => { p.nodes[0].stage.position = 101 }],
    ['舞台缩放越界', p => { p.nodes[0].stage.scale = 29 }],
    ['损坏对白', p => { p.nodes[0].lines.push(null) }],
    ['重复选项标识', p => { p.nodes[0].choices[1].id = p.nodes[0].choices[0].id }],
    ['无效条件比较符', p => { p.nodes[4].choices[0].condition.op = 'eval' }],
    ['非有限数值动作', p => { p.nodes[0].choices[0].actions[0].value = NaN }],
    ['无效跳转动作', p => { p.rules[0].actions = [{ type: 'goto', target: '../outside' }] }],
    ['零次聊天', p => { p.nodes[1].chat.maxTurns = 0 }],
    ['损坏离线回复', p => { p.nodes[1].chat.demoReplies = [null] }],
    ['损坏界面设置', p => { p.settings.accent = 'red' }],
  ]
  for (const [name, mutate] of cases) await t.test(name, () => {
    const value = project(); mutate(value)
    invalid(() => validateProject(value), /无效|范围|起始/)
  })
  for (const value of [null, [], {}, 'not a project']) invalid(() => validateProject(value), /基本信息/)
})

test('导入限制集合数量、对白与内嵌素材大小，也限制多份素材的总大小', async t => {
  for (const [key, count] of [['characters', 41], ['assets', 101], ['variables', 81], ['nodes', 301], ['rules', 201]]) {
    await t.test(key, () => {
      const value = project(), row = value[key][0]
      value[key] = Array.from({ length: count }, (_, i) => ({ ...structuredClone(row), id: 'entry-' + i }))
      invalid(() => validateProject(value), new RegExp(key))
    })
  }
  const lines = project()
  lines.nodes[0].lines = Array.from({ length: 200 }, () => ({ speaker: '', text: '一段对白' }))
  validateProject(lines)
  lines.nodes[0].lines.push({ speaker: '', text: '超过限制' })
  invalid(() => validateProject(lines), /对白/)
  const large = project()
  large.assets[0].url = 'data:image/png;base64,' + 'A'.repeat(8 * 1024 * 1024)
  invalid(() => validateProject(large), /素材/)
  const total = project()
  for (const asset of total.assets) asset.url = 'data:image/png;base64,' + 'A'.repeat(7 * 1024 * 1024)
  invalid(() => validateProject(total), /24 MB/)
})

test('素材允许可移植图片与音频，拒绝脚本、凭据、本地路径及未公开的内置路径', () => {
  for (const [kind, url] of [
    ['image', '/builtin/project/assets/lin.png'],
    ['image', 'https://media.example.test/portrait.webp?version=2'],
    ['image', 'data:image/png;base64,iVBORw0KGgo='],
    ['audio', 'data:audio/ogg;base64,T2dnUw=='],
    ['audio', 'https://media.example.test/music.mp3'],
  ]) {
    const value = project(); Object.assign(value.assets[0], { kind, url }); validateProject(value)
  }
  for (const url of [
    'javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/svg+xml;base64,PHN2Zz4=',
    'file:///C:/private.png', '//media.example.test/image.png', '/private/image.png',
    'https://user:secret@example.test/image.png', '/builtin/ai-dialogue/settings-private.json',
    '/builtin/project/assets/../server.js', '/builtin/project/server.js',
  ]) {
    const value = project(); value.assets[0].url = url
    invalid(() => validateProject(value), /素材/)
  }
})

test('插件自定义节点和动作可保留，未连接的引用通过诊断报告而不破坏作品', () => {
  const value = project()
  value.nodes[0].type = 'custom-scene'
  value.nodes[0].choices[0].actions.push({ type: 'custom-action', payload: '插件数据' })
  validateProject(value)
  value.nodes[0].stage.background = 'missing-asset'
  value.nodes[0].stage.characterId = 'missing-character'
  value.nodes[0].choices[0].target = 'missing-node'
  value.nodes[0].choices[1].target = ''
  value.nodes[4].choices[0].condition.variable = 'missing-variable'
  const before = structuredClone(value), issues = diagnose(value)
  for (const message of [/素材缺失/, /角色缺失/, /不存在的节点/, /未连接的选项/, /不存在的属性/]) {
    assert.ok(issues.some(issue => message.test(issue)), String(message))
  }
  assert.deepEqual(value, before)
})

test('运行状态独立初始化，恢复保留进度并清除在途标志和旧错误', () => {
  const value = project(), runtime = initialRuntime(value)
  assert.equal(runtime.nodeId, value.startNodeId)
  assert.deepEqual(runtime.variables, { trust: 0, courage: 1 })
  runtime.stage.position = 35; runtime.variables.trust = 3
  runtime.lineIndex = 1; runtime.text = structuredClone(value.nodes[0].lines[1])
  runtime.transcript.push({ role: 'user', name: '玩家', text: '想听听这张唱片' })
  runtime.visited.push('arrival'); runtime.firedRules.push('first-gift'); runtime.log.push('已送礼物')
  runtime.busy = true; runtime.error = '过期请求错误'
  const restored = validateRuntime(runtime, value)
  assert.deepEqual(restored, { ...runtime, busy: false, error: '' })
  restored.variables.trust = 4; restored.stage.position = 50; restored.transcript[0].text = '已修改'
  assert.equal(runtime.variables.trust, 3)
  assert.equal(runtime.stage.position, 35)
  assert.equal(runtime.transcript[0].text, '想听听这张唱片')
  assert.equal(value.nodes[0].stage.position, 62)
  assert.equal(initialRuntime(value).variables.trust, 0)
  invalid(() => initialRuntime(value, 'missing-node'), /节点不存在/)
})

test('存档拒绝不存在的节点、越界对白、损坏舞台、越界属性和过量历史', async t => {
  const value = project()
  const cases = [
    ['未知节点', r => { r.nodeId = 'missing' }],
    ['负对白位置', r => { r.lineIndex = -1 }],
    ['越界对白位置', r => { r.lineIndex = value.nodes[0].lines.length }],
    ['缺失属性', r => { delete r.variables.trust }],
    ['越界属性', r => { r.variables.trust = 11 }],
    ['字符串属性', r => { r.variables.trust = '3' }],
    ['非法舞台位置', r => { r.stage.position = NaN }],
    ['越界缩放', r => { r.stage.scale = 181 }],
    ['非法历史角色', r => { r.transcript = [{ role: 'system', name: '', text: '注入内容' }] }],
    ['损坏历史内容', r => { r.transcript = [null] }],
    ['历史过多', r => { r.transcript = Array.from({ length: 1001 }, () => ({ role: 'user', name: '', text: '你好' })) }],
    ['访问节点过多', r => { r.visited = Array(1001).fill('arrival') }],
    ['损坏规则标识', r => { r.firedRules = ['../rule'] }],
    ['非整数聊天次数', r => { r.chatTurns = 1.5 }],
    ['非布尔结束标志', r => { r.ended = 'false' }],
  ]
  for (const [name, mutate] of cases) await t.test(name, () => {
    const runtime = initialRuntime(value); mutate(runtime)
    invalid(() => validateRuntime(runtime, value), /存档/)
  })
  value.nodes[0].lines = []
  validateRuntime(initialRuntime(value), value)
})
