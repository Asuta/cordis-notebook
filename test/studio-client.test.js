import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import client from '../applications/studio/plugins/canvas/client.js'
import ui from '../applications/studio/plugins/canvas-ui/client.js'
import basic from '../applications/studio/plugins/canvas-basic-cards/client.js'
import generation from '../applications/studio/plugins/image-generation/client.js'
import agent from '../applications/studio/plugins/canvas-agent-tools/client.js'
import { newBoard } from '../applications/studio/plugins/canvas/store.js'
import { applyOperation } from './helpers/studio-fixture.js'

async function setup(t) {
  const window = new Window({ settings: { disableCSSFileLoading: true } }), previous = { window: globalThis.window, document: globalThis.document }
  globalThis.window = window; globalThis.document = window.document
  const cleanups = [], hooks = new Map(), tools = new Map()
  const board = newBoard('测试画板'), state = { boards: [board], assets: {}, jobs: [], config: { hasKey: true, model: 'test-model', baseUrl: 'https://example.com' } }
  const generated = [], toasts = []
  const ctx = { effect: fn => cleanups.push(fn()), on: (name, fn) => hooks.set(name, fn) }
  const sdk = {
    provide(name, service) { ctx[name] = service; return service },
    el(tag, props = {}, text) { const node = window.document.createElement(tag); for (const [key, value] of Object.entries(props)) { if (key === 'class') node.className = value; else if (key.startsWith('aria-')) node.setAttribute(key, value); else node[key] = value }; if (text !== undefined) node.textContent = text; return node },
    mount: (name, node) => window.document.body.append(node), toast: message => toasts.push(message),
    storage: { local: window.localStorage }, agent: { register: (definition, callback) => tools.set(definition.name, callback) },
    listen(target, name, fn) { target.addEventListener(name, fn); cleanups.push(() => target.removeEventListener(name, fn)) },
    async request(path, method, body) {
      if (path === '/api/studio') return structuredClone(state)
      if (path === '/api/studio/edit') {
        if (body.revision !== state.boards[0].revision) throw Error('画布已变化')
        const inverse = []
        for (const op of body.operations) { const result = applyOperation(state.boards[0], op, state.assets); state.boards[0] = result.board; inverse.unshift(result.inverse) }
        return { board: structuredClone(state.boards[0]), inverse }
      }
      if (path === '/api/studio/generate') { generated.push(structuredClone(state.boards[0])); return { id: 'job', status: 'queued' } }
      if (path === '/api/studio/import') { const asset = { id: 'imported-image', name: '参考图', width: 8, height: 6 }; state.assets[asset.id] = asset; return structuredClone(asset) }
      throw Error('未处理请求：' + path)
    },
  }
  t.after(async () => { for (const cleanup of cleanups.reverse()) await cleanup?.(); await window.happyDOM.close(); Object.assign(globalThis, previous) })
  state.providers = [{ id: 'fake', label: '测试服务', hasKey: true, model: 'test-model', ratios: ['1:1'], resolutions: ['1k'] }]
  const modules = { canvas: client, ui, basic, generation, agent }, running = new Map()
  async function start(id) {
    const releases = [], child = Object.create(ctx)
    child.effect = fn => { const release = fn(); let active = true; const dispose = () => { if (active) { active = false; return release?.() } }; releases.push(dispose); return dispose }
    const childSdk = { ...sdk,
      provide(name, service) { ctx[name] = service; child.effect(() => () => { if (ctx[name] === service) delete ctx[name] }); return service },
      mount(name, node) { sdk.mount(name, node); child.effect(() => () => node.remove()) },
      listen(target, name, fn) { target.addEventListener(name, fn); child.effect(() => () => target.removeEventListener(name, fn)) },
      agent: { register(definition, callback) { tools.set(definition.name, callback); child.effect(() => () => tools.delete(definition.name)) } },
    }
    const stop = async () => { for (const release of releases.reverse()) await release(); running.delete(id) }
    running.set(id, stop); cleanups.push(stop)
    await modules[id](child, childSdk)
  }
  for (const id of Object.keys(modules)) await start(id)
  return { window, state, tools, hooks, generated, toasts, ctx, start, stop: id => running.get(id)() }
}

async function waitUntil(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail('等待自动保存超时')
}

test('卡片视图、生成操作与 Agent 可分别卸载和恢复，不删除内容或重复入口', async t => {
  const { window, tools, state, stop, start } = await setup(t)
  await tools.get('studio_edit')({ revision: 0, operations: [{ type: 'add', node: { id: 'g', type: 'generator', prompt: '保留内容' } }] })
  await stop('generation')
  assert.match(window.document.querySelector('.studio-missing-card').textContent, /对应功能/)
  assert.equal(state.boards[0].nodes[0].prompt, '保留内容')
  await assert.rejects(tools.get('studio_generate')({ nodeId: 'g', revision: state.boards[0].revision }), /不可用/)
  await start('generation')
  assert.deepEqual([...window.document.querySelector('.studio-action-dock').children].slice(0, 3).map(node => node.textContent), ['＋ 文字', '↑ 图片', '✦ 生成卡片'])
  assert.equal(window.document.querySelectorAll('.studio-generator textarea').length, 1)
  assert.equal(window.document.querySelector('textarea').value, '保留内容')
  await stop('agent')
  assert.equal(tools.size, 0)
  await [...window.document.querySelectorAll('button')].find(b => b.textContent === '＋ 文字').onclick()
  assert.equal(state.boards[0].nodes.length, 2)
  await start('agent')
  assert.equal(tools.size, 10)
})

test('前端扩展注册菜单、卡片和操作，Agent 可发现并执行；卸载撤销注册', async t => {
  const { window, tools, ctx } = await setup(t), releases = [], plugin = { effect(fn) { const release = fn(); releases.push(release); return release } }
  let calls = 0
  ctx.canvasUI.menu(plugin, { id: 'custom', label: '扩展入口', run: () => calls++ })
  ctx.canvasSession.actions.register(plugin, { id: 'custom-action', label: '扩展操作', schema: { type: 'object' }, run: () => ++calls })
  assert.ok(tools.get('studio_read')().actions.some(action => action.id === 'custom-action'))
  await tools.get('studio_action')({ id: 'custom-action', revision: 0 })
  await [...window.document.querySelectorAll('button')].find(b => b.textContent === '扩展入口').onclick()
  assert.equal(calls, 2)
  for (const release of releases.reverse()) release()
  assert.equal(tools.get('studio_read')().actions.some(action => action.id === 'custom-action'), false)
  assert.equal([...window.document.querySelectorAll('button')].some(b => b.textContent === '扩展入口'), false)
})

test('灵感卡片选择显示上下文工具，批量排列及带内部连线的副本一次撤销', async t => {
  const { window, tools, state } = await setup(t)
  await tools.get('studio_edit')({ revision: 0, operations: [
    { type: 'add', node: { id: 'text', type: 'text', text: '参考文字', x: 0, y: 0 } },
    { type: 'add', node: { id: 'generator', type: 'generator', prompt: '提示词', x: 500, y: 30 } },
    { type: 'connect', id: 'edge', from: 'text', to: 'generator' },
  ] })
  const stage = window.document.querySelector('.studio-stage'), context = window.document.querySelector('.studio-context-tools')
  assert.equal(context.hidden, true)
  stage.focus()
  stage.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }))
  assert.equal(context.hidden, false)
  assert.match(context.textContent, /已选 2 张卡片.*水平排列.*垂直排列/)
  const original = structuredClone(state.boards[0].nodes)
  const click = text => [...window.document.querySelectorAll('button')].find(b => b.textContent === text).onclick()
  await click('垂直排列')
  assert.equal(state.boards[0].nodes[1].y, 270)
  assert.equal(state.boards[0].nodes[1].x, 0)
  assert.equal(state.boards[0].nodes[1].prompt, '提示词')
  await click('↶')
  assert.deepEqual(state.boards[0].nodes, original)
  await click('创建副本')
  assert.equal(state.boards[0].nodes.length, 4)
  assert.equal(state.boards[0].edges.length, 2)
  assert.notEqual(state.boards[0].edges[1].from, 'text')
  await click('↶')
  assert.deepEqual(state.boards[0].nodes, original)
  assert.equal(state.boards[0].edges.length, 1)
  window.document.querySelector('.studio-text').dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }))
  assert.match(context.textContent, /文字灵感.*编辑文字/)
  assert.doesNotMatch(context.textContent, /水平排列|垂直排列/)
})

test('拖动取消与无移动点击不写布局，文字组词中的 Esc 不退出编辑', async t => {
  const { window, tools, state } = await setup(t)
  await tools.get('studio_edit')({ revision: 0, operations: [{ type: 'add', node: { id: 'text', type: 'text', x: 0, y: 0 } }] })
  const stage = window.document.querySelector('.studio-stage'), original = structuredClone(state.boards[0])
  const pointer = (type, target, x, y) => target.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: x, clientY: y }))
  pointer('pointerdown', window.document.querySelector('.studio-card-head'), 40, 40)
  pointer('pointermove', stage, 120, 160)
  assert.notEqual(tools.get('studio_read')().board.nodes[0].x, 0)
  pointer('pointercancel', stage, 120, 160)
  assert.deepEqual(tools.get('studio_read')().board, original)
  assert.deepEqual(state.boards[0], original)
  pointer('pointerdown', window.document.querySelector('.studio-card-head'), 40, 40)
  pointer('pointerup', stage, 40, 40)
  assert.deepEqual(state.boards[0], original, '单击标题只选择卡片，不写坐标和撤销步骤')
  const input = window.document.querySelector('textarea'); input.focus()
  const composingEscape = new window.KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true })
  input.dispatchEvent(composingEscape)
  assert.equal(window.document.activeElement, input)
  assert.equal(composingEscape.defaultPrevented, false)
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  await waitUntil(() => window.document.querySelector('.studio-context-tools').hidden === false)
  assert.equal(window.document.activeElement, stage)
})

test('用户与 Agent 共用画布操作、自动保存、撤销和版本冲突规则，连线不自动生图', async t => {
    const { window, state, tools, hooks, generated } = await setup(t)
    let current = tools.get('studio_read')()
    await tools.get('studio_edit')({ revision: current.board.revision, operations: [
      { type: 'add', node: { id: 'text', type: 'text', text: '参考要求', x: 0, y: 0 } },
      { type: 'add', node: { id: 'generator', type: 'generator', x: 340, y: 0 } },
      { type: 'connect', id: 'edge', from: 'text', to: 'generator' },
    ] })
    assert.equal(window.document.querySelectorAll('.studio-card').length, 2)
    assert.equal(window.document.querySelectorAll('.studio-wires path').length, 1)
    assert.equal(generated.length, 0)
    await assert.rejects(tools.get('studio_edit')({ revision: 0, operations: [{ type: 'remove', ids: ['text'] }] }), /重新/)
    const input = window.document.querySelector('textarea')
    input.onfocus(); input.value = '用户编辑后的内容'; input.oninput()
    current = tools.get('studio_read')()
    assert.equal(current.dirty, true)
    await assert.rejects(tools.get('studio_generate')({ revision: current.board.revision, nodeId: 'generator' }), /重新/)
    await input.onblur()
    assert.equal(state.boards[0].nodes.find(n => n.id === 'text').text, '用户编辑后的内容')
    const undo = [...window.document.querySelectorAll('button')].find(b => b.textContent === '↶')
    await undo.onclick()
    assert.equal(state.boards[0].nodes.find(n => n.id === 'text').text, '参考要求')
    current = tools.get('studio_read')()
    await tools.get('studio_generate')({ revision: current.board.revision, nodeId: 'generator' })
    assert.equal(generated.length, 1)
    let released
    await hooks.get('plugins/before-stop')({ hold: callback => { released = callback } })
    await assert.rejects(tools.get('studio_edit')({ revision: tools.get('studio_read')().board.revision, operations: [{ type: 'rename', title: '停止期间' }] }), /重新/)
    released()
})

test('同步其他页面编辑后撤销或重做，不覆盖对方的文字', async t => {
  const { window, state, tools, toasts } = await setup(t)
  const edit = operations => tools.get('studio_edit')({ revision: tools.get('studio_read')().board.revision, operations })
  await edit([{ type: 'add', node: { id: 'text', type: 'text', text: '原文' } }])
  await edit([{ type: 'update', id: 'text', patch: { text: '本页编辑' } }])
  state.boards[0] = applyOperation(state.boards[0], { type: 'update', id: 'text', patch: { text: '外部编辑' } }, {}).board
  await tools.get('studio_jobs')()
  await [...window.document.querySelectorAll('button')].find(b => b.textContent === '↶').onclick()
  assert.equal(state.boards[0].nodes[0].text, '外部编辑')
  assert.match(toasts.at(-1), /冲突|其他页面/)
  await edit([{ type: 'update', id: 'text', patch: { text: '再次本页编辑' } }])
  await [...window.document.querySelectorAll('button')].find(b => b.textContent === '↶').onclick()
  state.boards[0] = applyOperation(state.boards[0], { type: 'update', id: 'text', patch: { text: '外部最新编辑' } }, {}).board
  await tools.get('studio_jobs')()
  await [...window.document.querySelectorAll('button')].find(b => b.textContent === '↷').onclick()
  assert.equal(state.boards[0].nodes[0].text, '外部最新编辑')
  assert.match(toasts.at(-1), /冲突|其他页面/)
})

test('Agent 导入后立即读取并添加图片，不依赖下一轮刷新', async t => {
  const { window, tools } = await setup(t)
  const asset = await tools.get('studio_import_image')({ path: 'C:/test/reference.png' })
  const current = tools.get('studio_read')()
  assert.deepEqual(current.assets[asset.id], asset)
  await tools.get('studio_edit')({ revision: current.board.revision, operations: [{ type: 'add', node: { id: 'image', type: 'image', assetId: asset.id } }] })
  assert.equal(window.document.querySelector('.studio-image img').getAttribute('src'), `/api/studio/images/${asset.id}.webp`)
  assert.match(window.document.querySelector('.studio-image-foot').textContent, /8 × 6/)
})

test('画板名称编辑阻止 Agent 写入，保留草稿并自动保存，不被后台结果重绘覆盖', async t => {
  const { window, state, tools, toasts } = await setup(t)
  const title = window.document.querySelector('[aria-label="画板名称"]')
  title.focus()
  await assert.rejects(tools.get('studio_edit')({ revision: 0, operations: [{ type: 'rename', title: 'Agent 覆盖' }] }), /正在编辑|重新/)
  state.boards[0] = applyOperation(state.boards[0], { type: 'add', node: { id: 'background', type: 'text' } }, {}).board
  await tools.get('studio_jobs')()
  title.value = '新画板名称'; title.oninput()
  assert.equal(tools.get('studio_read')().dirty, true)
  assert.match(window.localStorage.getItem('drafts'), /新画板名称/)
  await tools.get('studio_jobs')()
  assert.equal(title.value, '新画板名称')
  await waitUntil(() => !tools.get('studio_read')().dirty)
  assert.equal(state.boards[0].title, '新画板名称')
  title.value = '新画板名称第二段'; title.oninput()
  await title.onblur()
  assert.equal(state.boards[0].title, '新画板名称第二段')
  assert.equal(state.boards[0].nodes[0].id, 'background')
  assert.deepEqual(toasts, [])
})

test('另一页面同时重命名时保留本页名称草稿，停止应用前也不覆盖', async t => {
  const { window, state, tools, hooks, toasts } = await setup(t)
  const title = window.document.querySelector('[aria-label="画板名称"]')
  title.focus()
  state.boards[0] = applyOperation(state.boards[0], { type: 'rename', title: '另一页面名称' }, {}).board
  await tools.get('studio_jobs')()
  title.value = '我的未保存名称'; title.oninput()
  await title.onblur()
  assert.equal(state.boards[0].title, '另一页面名称')
  assert.equal(title.value, '我的未保存名称')
  assert.equal(tools.get('studio_read')().dirty, true)
  assert.match(window.localStorage.getItem('drafts'), /我的未保存名称/)
  assert.match(toasts.at(-1), /名称.*其他页面|其他页面.*名称/)
  await assert.rejects(hooks.get('plugins/before-stop')({ hold() {} }), /其他页面/)
})

test('提示词停顿自动保存后继续输入，点击生成使用最新内容而不误报冲突', async t => {
  const { window, state, tools, generated, toasts } = await setup(t)
  await tools.get('studio_edit')({ revision: 0, operations: [{ type: 'add', node: { id: 'generator', type: 'generator' } }] })
  const input = window.document.querySelector('textarea')
  input.focus(); input.value = '鳄'; input.oninput()
  await waitUntil(() => !tools.get('studio_read')().dirty)
  assert.equal(state.boards[0].nodes[0].prompt, '鳄')
  assert.equal(window.document.querySelector('textarea'), input, '保存不能打断输入或更换正在使用的输入框')
  input.value = '鳄鱼'; input.oninput()
  await input.onblur()
  await [...window.document.querySelectorAll('button')].find(b => b.textContent === '✦ 生成图片').onclick()
  assert.deepEqual(toasts, [])
  assert.equal(generated.length, 1)
  assert.equal(generated[0].nodes[0].prompt, '鳄鱼')
  assert.equal(tools.get('studio_read')().dirty, false)
  assert.equal(window.localStorage.getItem('drafts'), null)
})

test('自动保存后其他页面修改同一提示词，仍阻止覆盖并保留本页草稿', async t => {
  const { window, state, tools, generated, toasts } = await setup(t)
  await tools.get('studio_edit')({ revision: 0, operations: [{ type: 'add', node: { id: 'generator', type: 'generator' } }] })
  const input = window.document.querySelector('textarea')
  input.focus(); input.value = '鳄'; input.oninput()
  await waitUntil(() => !tools.get('studio_read')().dirty)
  state.boards[0] = applyOperation(state.boards[0], { type: 'update', id: 'generator', patch: { prompt: '另一页面的内容' } }, {}).board
  await tools.get('studio_jobs')()
  assert.equal(window.document.querySelector('textarea'), input)
  input.value = '鳄鱼'; input.oninput()
  await [...window.document.querySelectorAll('button')].find(b => b.textContent === '✦ 生成图片').onclick()
  assert.equal(generated.length, 0)
  assert.equal(state.boards[0].nodes[0].prompt, '另一页面的内容')
  assert.match(toasts.at(-1), /其他页面修改/)
  assert.equal(tools.get('studio_read')().dirty, true)
  assert.equal(JSON.parse(window.localStorage.getItem('drafts')).drafts[0][1].patch.prompt, '鳄鱼')
})

test('图片预览支持缩小放大、拖动平移、滚轮缩放与适应窗口', async t => {
  const { window, tools, toasts } = await setup(t)
  const asset = await tools.get('studio_import_image')({ path: 'C:/test/reference.png' })
  await tools.get('studio_edit')({ revision: tools.get('studio_read')().board.revision, operations: [{ type: 'add', node: { id: 'image', type: 'image', assetId: asset.id } }] })
  const viewer = window.document.querySelector('.studio-viewer')
  assert.equal(viewer.open, false)
  const click = async (text, scope = viewer) => { await [...scope.querySelectorAll('button')].find(b => b.textContent === text).onclick() }
  await [...window.document.querySelectorAll('.studio-image-foot button')].find(b => b.textContent === '预览').onclick()
  assert.equal(viewer.open, true, '预览按钮必须打开预览弹层')
  const stage = viewer.querySelector('.studio-viewer-stage'), image = stage.querySelector('img'), label = viewer.querySelector('.studio-viewer-zoom')
  assert.equal(image.getAttribute('src'), `/api/studio/images/${asset.id}.png`)
  const scale = () => Number(/scale\(([\d.]+)\)/.exec(image.style.transform)?.[1])
  const offset = () => /translate\((-?[\d.]+)px,(-?[\d.]+)px\)/.exec(image.style.transform)?.slice(1, 3).map(Number)
  assert.ok(scale() > 0 && scale() <= 1, '打开时按适应窗口显示，不超过 100%')
  assert.equal(label.textContent, Math.round(scale() * 100) + '%')
  await click('＋')
  assert.ok(scale() > 1, '放大后可超过 100%，不再受原始尺寸限制')
  await click('−')
  await click('1:1')
  assert.equal(scale(), 1)
  assert.equal(label.textContent, '100%')
  await click('适应窗口')
  assert.ok(scale() <= 1)
  const wheel = new window.MouseEvent('wheel', { bubbles: true, cancelable: true, clientX: 120, clientY: 120 })
  Object.defineProperty(wheel, 'deltaY', { value: -240 })
  stage.dispatchEvent(wheel)
  assert.ok(scale() > 1, '滚轮向上滚动放大图片')
  const pointer = (type, x, y) => stage.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 3, clientX: x, clientY: y }))
  const moved = { scale: scale(), offset: offset() }
  pointer('pointerdown', 100, 100); pointer('pointermove', 160, 140)
  assert.deepEqual(offset(), [moved.offset[0] + 60, moved.offset[1] + 40], '拖动按指针位移平移图片')
  assert.equal(scale(), moved.scale, '平移不改变缩放')
  assert.equal(stage.classList.contains('grabbing'), true)
  pointer('pointerup', 160, 140)
  assert.equal(stage.classList.contains('grabbing'), false)
  const held = offset()
  pointer('pointermove', 220, 180)
  assert.deepEqual(offset(), held, '松开后不再跟随指针')
  const wheelIn = new window.MouseEvent('wheel', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 })
  Object.defineProperty(wheelIn, 'deltaY', { value: 240 })
  stage.dispatchEvent(wheelIn)
  assert.ok(scale() < moved.scale, '滚轮向下滚动缩小图片')
  assert.deepEqual(toasts, [])
})

for (const saved of [true, false]) test(`提示词${saved ? '已保存' : '仍待保存'}时，按下再松开生成按钮只需一次点击`, async t => {
  const { window, tools, generated, toasts } = await setup(t)
  await tools.get('studio_edit')({ revision: 0, operations: [{ type: 'add', node: { id: 'generator', type: 'generator' } }] })
  const input = window.document.querySelector('textarea')
  input.focus(); input.value = '人类'; input.oninput()
  if (saved) await waitUntil(() => !tools.get('studio_read')().dirty)
  const run = [...window.document.querySelectorAll('button')].find(b => b.textContent === '✦ 生成图片')
  // A real pointer click moves focus on press, then dispatches click on release.
  // Allow blur/autosave to settle between these two events, as with a held click.
  const focusOnPress = run.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))
  if (focusOnPress) run.focus()
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(run.isConnected, true, '松开前必须保留原按钮，否则浏览器不会触发它的 click')
  assert.equal(generated.length, 0, '按下还未松开时不能提前发起生成')
  run.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0 }))
  run.click()
  await waitUntil(() => generated.length === 1)
  assert.equal(generated[0].nodes[0].prompt, '人类')
  assert.equal(tools.get('studio_read')().dirty, false)
  assert.deepEqual(toasts, [])
})
