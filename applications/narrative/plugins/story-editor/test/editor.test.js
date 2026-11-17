import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mountEditor } from '../editor.js'
import { setup, owner, settle } from '../../project/test/helpers.js'
import { validateProject } from '../../project/model.js'
import { mountWorkspace } from '../../shell/workspace.js'

const makeDraft = customize => project => {
  const stage = structuredClone(project.nodes[0].stage)
  project.startNodeId = 'intro'; project.rules = []
  project.nodes = [
    { id: 'intro', type: 'story', title: '相遇', stage, lines: [{ speaker: '', text: '第一句' }, { speaker: 'lin', text: '第二句' }], choices: [], next: '' },
    { id: 'end', type: 'ending', title: '重逢', stage: structuredClone(stage), lines: [], choices: [], next: '' },
    { id: 'other', type: 'scene', title: '其他插件节点', stage: structuredClone(stage), lines: [], choices: [] },
  ]
  customize?.(project)
  return project
}
function controls(host, window) {
  const field = key => { const node = [...host.querySelectorAll('[data-field]')].find(n => n.dataset.field === key); assert.ok(node, key); return node }
  const button = label => { const node = [...host.querySelectorAll('button')].find(n => n.getAttribute('aria-label') === label || n.textContent === label); assert.ok(node, label); return node }
  const change = (key, value) => { const node = field(key); node.value = String(value); node.dispatchEvent(new window.Event('change', { bubbles: true })); return node }
  const click = async label => { button(label).click(); await settle() }
  return { field, button, change, click }
}
async function fixture(t, customize, ui) {
  const f = await setup(t, { draft: makeDraft(customize) }), host = document.createElement('main')
  f.engine.select({ nodeId: 'intro' })
  host.className = 'ne-app'; document.body.append(host)
  const dispose = mountEditor(host, { engine: f.engine, sdk: f.sdk, ui })
  f.ctx.effect(() => dispose)
  return { ...f, host, dispose, ...controls(host, f.window), node: () => f.engine.project.nodes.find(n => n.id === f.engine.selection.nodeId) }
}

test('普通字段以 render:false 保存，保留焦点、待点击章节和安全文本', async t => {
  const f = await fixture(t), events = [], o = owner()
  f.engine.observe(o, event => { if (event.type === 'project') events.push(event) }); f.ctx.effect(() => () => o.dispose())
  const root = f.host.firstChild, input = f.field('title'), chapter = f.host.querySelector('[data-node-id="end"]')
  input.focus(); f.change('title', '<img src=x onerror=alert(1)>')
  assert.equal(document.activeElement, input); assert.equal(f.host.firstChild, root)
  assert.equal(chapter, f.host.querySelector('[data-node-id="end"]'))
  assert.equal(f.host.querySelector('img'), null)
  assert.match(f.host.querySelector('[data-node-id="intro"]').textContent, /<img src=x/)
  f.change('stage.background', 'observatory'); f.change('stage.characterId', 'yao'); f.change('stage.expression', 'happy')
  f.change('stage.position', 42); f.change('stage.scale', 120); f.change('next', 'end')
  f.change('type', 'ending'); f.change('type', 'story')
  assert.deepEqual(f.node().stage, { background: 'observatory', characterId: 'yao', expression: 'happy', position: 42, scale: 120 })
  assert.equal(f.node().next, 'end'); assert.ok(events.length >= 8); assert.ok(events.every(e => e.render === false))
  chapter.click(); assert.equal(f.engine.selection.nodeId, 'end'); assert.equal(f.field('title').value, '重逢')
  f.engine.select({ nodeId: 'intro' }); assert.equal(f.field('title').value, '<img src=x onerror=alert(1)>')
  await f.engine.save(); assert.equal(f.records.get('first').nodes[0].title, '<img src=x onerror=alert(1)>')
})

test('对白新增、说话者、上下移动和删除均通过真实模型保存', async t => {
  const f = await fixture(t)
  f.change('lines.0.text', '修改后的第一句'); f.change('lines.0.speaker', 'yao')
  await f.click('下移对白 1')
  assert.deepEqual(f.node().lines.map(l => l.text), ['第二句', '修改后的第一句'])
  await f.click('上移对白 2'); assert.equal(f.node().lines[0].speaker, 'yao')
  await f.click('新增对白'); f.change('lines.2.text', '<script>literal</script>')
  await f.click('删除对白 2')
  assert.deepEqual(f.node().lines.map(l => l.text), ['修改后的第一句', '<script>literal</script>'])
  assert.equal(f.host.querySelector('script'), null); validateProject(f.engine.project)
})

test('选项目标、变量条件与增减/设值动作完整可编辑，可移除', async t => {
  const f = await fixture(t)
  await f.click('新增选项'); f.change('choices.0.text', '陪你等雨停'); f.change('choices.0.target', 'end')
  await f.click('为选项 1 添加变量条件')
  f.change('choices.0.condition.variable', 'courage'); f.change('choices.0.condition.op', 'lt'); f.change('choices.0.condition.value', 3)
  assert.deepEqual(f.node().choices[0].condition, { type: 'variable', variable: 'courage', op: 'lt', value: 3 })
  await f.click('为选项 1 添加变量动作')
  f.change('choices.0.actions.0.variable', 'trust'); f.change('choices.0.actions.0.value', -2)
  assert.deepEqual(f.node().choices[0].actions, [{ type: 'add-variable', variable: 'trust', value: -2 }])
  f.change('choices.0.actions.0.type', 'set-variable'); f.change('choices.0.actions.0.value', 4)
  assert.deepEqual(f.node().choices[0].actions, [{ type: 'set-variable', variable: 'trust', value: 4 }])
  assert.match(f.host.querySelector('[data-node-id="intro"]').textContent, /陪你等雨停 → 重逢/)
  await f.click('移除选项 1 条件'); assert.equal(f.node().choices[0].condition, undefined)
  await f.click('删除选项 1 动作 1'); assert.deepEqual(f.node().choices[0].actions, [])
  await f.click('删除选项 1'); assert.deepEqual(f.node().choices, []); assert.deepEqual(f.toasts, [])
})

test('新增章节、结局、起点和删除确认保持其他插件数据', async t => {
  const f = await fixture(t), other = structuredClone(f.engine.project.nodes[2])
  await f.click('删除章节'); assert.match(f.toasts.at(-1), /起始节点/)
  await f.click('新增章节'); const added = f.engine.selection.nodeId
  assert.equal(f.node().type, 'story'); assert.equal(f.field('title').value, '新的章节')
  await f.click('设为起始节点'); assert.equal(f.engine.project.startNodeId, added)
  await f.click('新增结局'); const ending = f.engine.selection.nodeId
  assert.equal(f.node().type, 'ending')
  await f.click('删除章节'); assert.ok(f.engine.project.nodes.some(n => n.id === ending))
  await f.click('取消删除'); assert.ok(f.engine.project.nodes.some(n => n.id === ending))
  await f.click('删除章节'); await f.click('确认删除章节')
  assert.ok(!f.engine.project.nodes.some(n => n.id === ending)); assert.deepEqual(f.engine.project.nodes.find(n => n.id === 'other'), other)
  validateProject(f.engine.project)
})

test('删除检查覆盖 next、选项目标、聊天、goto 动作及规则节点', async t => {
  const f = await fixture(t)
  const cases = [
    p => { p.nodes[0].next = 'end' },
    p => { p.nodes[0].choices = [{ id: 'link', text: '去结局', target: 'end', actions: [] }] },
    p => { p.nodes[0].choices = [{ id: 'link', text: '执行跳转', target: '', actions: [{ type: 'goto', target: 'end' }] }] },
    p => { p.nodes[2].chat = { characterId: '', prompt: '', maxTurns: 1, next: 'end', label: '', demoReplies: [] } },
    p => { p.rules = [{ id: 'rule', name: '结局规则', event: 'node.enter', nodeId: 'end', once: false, actions: [] }] },
    p => { p.rules = [{ id: 'rule', name: '跳转规则', event: 'node.enter', once: false, actions: [{ type: 'goto', target: 'end' }] }] },
  ]
  for (const configure of cases) {
    f.engine.update(p => { p.nodes[0].next = ''; p.nodes[0].choices = []; delete p.nodes[2].chat; p.rules = []; configure(p) })
    f.engine.select({ nodeId: 'end' }); await f.click('删除章节')
    assert.match(f.toasts.at(-1), /仍被引用/); assert.ok(f.engine.project.nodes.some(n => n.id === 'end'))
    assert.equal(f.host.querySelector('.vn-editor-confirm'), null)
  }
})

test('校验错误与保存异常保留输入和模型，阻止结构操作丢失草稿', async t => {
  const f = await fixture(t), initial = f.node().stage.scale
  const invalid = f.change('stage.scale', 999)
  assert.equal(invalid.value, '999'); assert.equal(invalid.getAttribute('aria-invalid'), 'true'); assert.equal(f.node().stage.scale, initial)
  await f.click('新增对白'); assert.equal(f.node().lines.length, 2); assert.equal(f.field('stage.scale'), invalid)
  f.engine.select({ nodeId: 'end' }); assert.equal(f.engine.selection.nodeId, 'intro'); assert.equal(invalid.value, '999')
  f.change('stage.scale', 120); await f.click('新增对白'); assert.equal(f.node().lines.length, 3)
  const realUpdate = f.engine.update; f.engine.update = () => { throw Error('模拟更新失败') }
  const title = f.change('title', '失败但保留的文字')
  assert.equal(title.value, '失败但保留的文字'); assert.equal(f.node().title, '相遇'); assert.match(f.toasts.at(-1), /模拟更新失败/)
  await f.click('新增结局'); assert.equal(f.engine.project.nodes.length, 3)
  f.engine.update = realUpdate; title.dispatchEvent(new f.window.Event('change', { bubbles: true }))
  assert.equal(f.node().title, '失败但保留的文字')
  const long = f.change('lines.0.text', '字'.repeat(8001)); assert.equal(long.value.length, 8001); assert.equal(f.node().lines[0].text, '第一句')
  f.change('lines.0.text', '修正完成'); validateProject(f.engine.project)
})

test('点击结构按钮会保存尚未触发 change 的有效输入', async t => {
  const f = await fixture(t)
  f.field('lines.0.text').value = '还在输入的对白'
  await f.click('新增对白'); assert.equal(f.node().lines[0].text, '还在输入的对白')
})

test('模型集合上限禁用新增，且没有变量时不创建无效条件或动作', async t => {
  const f = await fixture(t, p => {
    const n = p.nodes[0]
    n.lines = Array.from({ length: 200 }, () => ({ speaker: '', text: '' }))
    n.choices = Array.from({ length: 20 }, (_, i) => ({ id: 'c' + i, text: '', target: '', actions: i ? [] : Array.from({ length: 30 }, () => ({ type: 'add-variable', variable: 'trust', value: 1 })) }))
    while (p.nodes.length < 300) p.nodes.push({ ...structuredClone(p.nodes[1]), id: 'n' + p.nodes.length })
  })
  for (const label of ['新增章节', '新增结局', '新增对白', '新增选项', '为选项 1 添加变量动作']) assert.equal(f.button(label).disabled, true, label)
  const version = f.engine.version; await f.click('新增章节'); assert.equal(f.engine.version, version)
  f.engine.update(p => { p.variables = []; p.nodes[0].choices = [{ id: 'one', text: '', target: '', actions: [] }] })
  assert.equal(f.button('为选项 1 添加变量条件').disabled, true); assert.equal(f.button('为选项 1 添加变量动作').disabled, true)
})

test('未知类型和丢失引用可见且不被默认选择静默覆盖', async t => {
  const f = await fixture(t, p => {
    p.nodes[0].stage.background = 'missing-background'
    p.nodes[0].lines[0].speaker = 'missing-character'
    p.nodes[0].choices = [{ id: 'custom', text: '<b>选项</b>', target: 'missing-target', condition: { type: 'custom', variable: 'trust', op: 'eq', value: 0 }, actions: [{ type: 'custom-action', data: '<svg onload=alert(1)>' }] }]
  })
  const choice = structuredClone(f.node().choices[0])
  assert.equal(f.field('stage.background').value, 'missing-background')
  assert.equal(f.field('lines.0.speaker').value, 'missing-character')
  assert.equal(f.field('choices.0.target').value, 'missing-target')
  assert.equal(f.host.querySelector('svg'), null); assert.match(f.host.textContent, /当前剧情播放器不支持/)
  f.change('title', '修改标题'); assert.deepEqual(f.node().choices[0], choice)
})

test('试读关闭设置后以所选节点调用 play，关闭引发卸载也不取消试读', async t => {
  const order = []; let f
  f = await fixture(t, undefined, { async navigate(id) { order.push('navigate:' + id); f.dispose() } })
  const play = f.engine.play; f.engine.play = id => { order.push('play:' + id); return play(id) }
  f.engine.select({ nodeId: 'end' }); await f.click('从此段试读')
  assert.deepEqual(order, ['navigate:scene.editor', 'play:end']); assert.equal(f.engine.mode, 'play'); assert.equal(f.engine.runtime.nodeId, 'end')
  assert.equal(f.host.children.length, 0)
})

test('卸载清理订阅和事件，脱离 DOM 的旧控件无法再修改模型', async t => {
  const f = await fixture(t), title = f.field('title'), add = f.button('新增章节')
  f.dispose(); f.dispose(); const version = f.engine.version
  title.value = '过期编辑'; title.dispatchEvent(new f.window.Event('change', { bubbles: true })); add.click()
  f.engine.select({ nodeId: 'end' }); f.engine.update(p => { p.nodes[1].title = '外部修改' })
  assert.equal(f.engine.version, version + 1); assert.equal(f.engine.project.nodes[0].title, '相遇'); assert.equal(f.host.children.length, 0)
})

test('真实 shell 普通字段不重挂，结构变化重挂后仍可编辑且无重复订阅', async t => {
  const f = await setup(t, { draft: makeDraft() }), ctx = owner(), workspaceHost = document.createElement('div')
  f.engine.select({ nodeId: 'intro' })
  document.body.append(workspaceHost); f.ctx.effect(() => () => ctx.dispose())
  const shell = mountWorkspace(ctx, { ...f.sdk, mount(_, root) { workspaceHost.append(root) }, provide() {} }, f.engine, { projectPanel: { id: 'project', label: '作品', render() {} }, showLibrary() {}, download() {} })
  let mounts = 0, disposals = 0
  shell.ui.registerPanel(ctx, { id: 'novel.editor', label: '剧情与对白', render(host) {
    mounts++; const dispose = mountEditor(host, { engine: f.engine, sdk: f.sdk, ui: shell.ui })
    return () => { disposals++; dispose() }
  } })
  await shell.ui.navigate('novel.editor')
  const c = controls(workspaceHost, f.window), input = c.field('title'); input.focus(); c.change('title', '面板保持挂载')
  await settle(); assert.equal(mounts, 1); assert.equal(c.field('title'), input); assert.equal(document.activeElement, input)
  await c.click('新增对白'); assert.equal(mounts, 2); assert.equal(disposals, 1)
  c.change('lines.2.text', '重挂后编辑'); assert.equal(f.engine.project.nodes[0].lines[2].text, '重挂后编辑')
  f.engine.select({ nodeId: 'end' }); assert.equal(c.field('title').value, '重逢')
  await shell.ui.navigate('scene.editor'); assert.equal(disposals, 2); assert.equal(workspaceHost.querySelector('.vn-editor'), null)
})
