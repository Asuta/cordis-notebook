import { test } from 'node:test'
import assert from 'node:assert/strict'
import editor from '../client.js'
import { RESOURCE_MIME, resourceReferences, readAsset } from '../resources.js'
import { setupScene } from '../../scene-runtime/test/helpers.js'
import { mountScene } from '../../scene-ui/renderer.js'
import { settle, owner } from '../../project/test/helpers.js'
import { fittedScreen, preferences } from '../layout.js'

async function fixture(t) {
  const f = await setupScene(t), ctx = owner(), host = document.createElement('main')
  Object.assign(ctx, { narrative: f.engine, sceneRuntime: f.scene, sceneViews: { mount: (node, options) => mountScene(node, { scene: f.scene, engine: f.engine, ui: {}, ...options }) }, narrativeUI: { registerPanel(_, d) { ctx.effect(() => d.render(host)) }, async navigate() {} } })
  document.body.append(host); editor(ctx, f.sdk); f.ctx.effect(() => () => ctx.dispose())
  const click = async text => { const b = [...host.querySelectorAll('button')].find(b => b.textContent === text); assert.ok(b, text); b.click(); await settle() }
  return { ...f, host, click, canvas: host.querySelector('.scene-canvas'), select(id) { host.querySelector('[data-id="' + id + '"]').click() } }
}
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height })
test('固定屏幕完整适配横竖区域，调整分区、取消拖动、重置与持久化', async t => {
  const f = await fixture(t), grid = f.host.querySelector('.scene-editor-grid'), viewport = f.host.querySelector('.scene-viewport')
  for (const orientation of ['landscape', 'portrait']) for (const [w,h] of [[900,400],[300,700],[1200,900]]) {
    const screen = fittedScreen(w,h,orientation)
    assert.ok(screen.width * screen.scale <= w - 24 + .001)
    assert.ok(screen.height * screen.scale <= h - 24 + .001)
    assert.equal(screen.width / screen.height, orientation === 'landscape' ? 16/9 : 9/16)
  }
  Object.defineProperties(grid, { clientWidth: { value: 1200, configurable: true }, clientHeight: { value: 700, configurable: true } })
  Object.defineProperties(viewport, { clientWidth: { value: 600, configurable: true }, clientHeight: { value: 400, configurable: true } })
  window.dispatchEvent(new f.window.Event('resize'))
  const version = f.engine.version
  for (const [key,x,y,endX,endY,expected] of [['left',210,100,260,100,260],['right',900,100,850,100,340],['bottom',100,520,100,470,230]]) {
    const handle = grid.querySelector('[data-split="' + key + '"]')
    pointer(f,handle,'pointerdown',x,y); pointer(f,handle,'pointermove',endX,endY); pointer(f,handle,'pointerup',endX,endY)
    assert.equal(grid.style.getPropertyValue('--scene-' + key), expected + 'px')
    assert.equal(preferences(f.sdk.storage.local).value[key], expected)
  }
  const left = grid.querySelector('[data-split="left"]')
  pointer(f,left,'pointerdown',260,100); pointer(f,left,'pointermove',800,100); pointer(f,left,'pointercancel',800,100)
  assert.equal(grid.style.getPropertyValue('--scene-left'), '260px')
  left.dispatchEvent(new f.window.MouseEvent('dblclick')); assert.equal(grid.style.getPropertyValue('--scene-left'), '210px')
  const size = f.host.querySelector('[aria-label="预览比例"]'); size.value='portrait'; size.dispatchEvent(new f.window.Event('change')); await settle()
  assert.equal(f.canvas.style.width,'540px'); assert.equal(f.canvas.style.height,'960px')
  assert.equal(preferences(f.sdk.storage.local).value.orientation,'portrait')
  assert.equal(f.engine.version,version)
})

test('资源 Ctrl 滚轮只缩放卡片，支持限幅、重置、持久化，普通滚轮不拦截', async t => {
  const f=await fixture(t), assets=f.host.querySelector('.scene-assets'), version=f.engine.version
  // happy-dom's WheelEvent omits MouseEvent modifier keys.
  const wheel=(ctrlKey,deltaY)=>{const event=new f.window.WheelEvent('wheel',{deltaY,bubbles:true,cancelable:true});Object.defineProperty(event,'ctrlKey',{value:ctrlKey});assets.dispatchEvent(event);return event}
  assert.equal(wheel(false,-100).defaultPrevented,false)
  assert.equal(assets.style.getPropertyValue('--resource-width'),'114px')
  assert.equal(wheel(true,-100).defaultPrevented,true)
  assert.equal(assets.style.getPropertyValue('--resource-width'),'122px')
  assert.equal(preferences(f.sdk.storage.local).value.resourceSize,122)
  for(let i=0;i<50;i++)wheel(true,-100)
  assert.equal(assets.style.getPropertyValue('--resource-width'),'240px')
  for(let i=0;i<50;i++)wheel(true,100)
  assert.equal(assets.style.getPropertyValue('--resource-width'),'80px')
  f.host.querySelector('[aria-label="重置资源缩放"]').click();await settle()
  assert.equal(assets.style.getPropertyValue('--resource-width'),'114px')
  assert.equal(f.engine.version,version)
})

test('预览缩小后拖动尺寸手柄仍按逻辑像素提交', async t => {
  const f=await fixture(t);await gestureScene(f,'anchor')
  f.canvas.dataset.previewScale='0.5';f.select('a');await settle()
  const node=f.canvas.querySelector('[data-object-id="a"]');node.getBoundingClientRect=()=>rect(0,0,45,45)
  pointer(f,node.querySelector('[data-scene-handle="resize"]'),'pointerdown',45,45)
  pointer(f,f.canvas,'pointermove',70,60);pointer(f,f.canvas,'pointerup',70,60)
  assert.deepEqual(f.scene.expanded().objects.find(o=>o.id==='a').layout,{width:140,height:120})
})
function pointer(f, node, type, x, y) { node.dispatchEvent(new f.window.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, clientX: x, clientY: y, pointerType: 'mouse' })) }
async function gestureScene(f, mode = 'column') {
  f.scene.edit({ op: 'batch', commands: [{ op: 'add-scene', id: 'gestures', name: '手势场景' }, { op: 'add', sceneId: 'gestures', id: 'box', type: 'container', layout: { mode } }, ...['a', 'b', 'c'].map(id => ({ op: 'add', sceneId: 'gestures', id, parent: 'box', type: 'text', props: { text: id } }))] })
  f.scene.select('gestures'); await settle()
  Object.defineProperty(f.canvas, 'clientWidth', { configurable: true, value: 900 })
  for (const [index, id] of ['a', 'b', 'c'].entries()) f.canvas.querySelector('[data-object-id="' + id + '"]').getBoundingClientRect = () => rect(mode === 'row' || mode === 'grid' ? index * 100 : 0, mode === 'column' ? index * 100 : 0, 90, 90)
  f.canvas.querySelector('[data-object-id="box"]').getBoundingClientRect = () => rect(0, 0, 300, 300)
}

for (const mode of ['column', 'row', 'grid']) test(mode + ' 拖动只改同级顺序，单次撤销恢复，无独立坐标', async t => {
  const f = await fixture(t); await gestureScene(f, mode)
  const before = f.engine.composition, history = f.engine.sceneHistory.undo
  const a = f.canvas.querySelector('[data-object-id="a"]')
  pointer(f, a, 'pointerdown', 20, 20)
  pointer(f, f.canvas, 'pointermove', mode === 'column' ? 20 : 290, mode === 'column' ? 290 : 20)
  pointer(f, f.canvas, 'pointerup', 290, 290)
  assert.deepEqual(f.scene.expanded().objects.filter(o => o.parent === 'box').map(o => o.id), ['b', 'c', 'a'])
  assert.deepEqual(f.scene.expanded().objects.find(o => o.id === 'a').layout, {})
  assert.equal(f.engine.sceneHistory.undo, history + 1)
  await f.engine.save(); assert.deepEqual(f.records.get('first').composition, f.engine.composition)
  f.scene.undo(); assert.deepEqual(f.engine.composition, before); assert.deepEqual(f.toasts, [])
})

test('锚点吸附与窄屏缩放写回布局；过期版本、取消手势和试玩禁止提交', async t => {
  const f = await fixture(t); await gestureScene(f, 'anchor')
  pointer(f, f.canvas.querySelector('[data-object-id="a"]'), 'pointerdown', 20, 20)
  pointer(f, f.canvas, 'pointermove', 280, 280); pointer(f, f.canvas, 'pointerup', 280, 280)
  assert.equal(f.scene.expanded().objects.find(o => o.id === 'a').layout.anchor, 'bottom-right')
  Object.defineProperty(f.canvas, 'clientWidth', { configurable: true, value: 390 })
  f.select('a'); await settle()
  let node = f.canvas.querySelector('[data-object-id="a"]'); node.getBoundingClientRect = () => rect(0, 0, 90, 90)
  pointer(f, node.querySelector('[data-scene-handle="resize"]'), 'pointerdown', 90, 90)
  pointer(f, f.canvas, 'pointermove', 190, 140); pointer(f, f.canvas, 'pointerup', 190, 140)
  assert.deepEqual(f.scene.expanded().objects.find(o => o.id === 'a').layout, { anchor: 'bottom-right', compact: { width: 190, height: 140 } })
  const saved = f.engine.composition, history = f.engine.sceneHistory.undo
  node = f.canvas.querySelector('[data-object-id="a"]'); node.getBoundingClientRect = () => rect(0, 0, 190, 140)
  pointer(f, node.querySelector('[data-scene-handle="resize"]'), 'pointerdown', 190, 140)
  pointer(f, f.canvas, 'pointermove', 220, 180); pointer(f, f.canvas, 'pointercancel', 220, 180)
  assert.deepEqual(f.engine.composition, saved); assert.equal(f.engine.sceneHistory.undo, history)
  pointer(f, node.querySelector('[data-scene-handle="resize"]'), 'pointerdown', 190, 140)
  f.engine.update(p => { p.description = 'Agent 同时修改作品' })
  pointer(f, f.canvas, 'pointermove', 220, 180); pointer(f, f.canvas, 'pointerup', 220, 180)
  assert.deepEqual(f.engine.composition, saved); assert.match(f.toasts.at(-1), /版本已变化/)
  f.select('b'); await f.engine.play(); assert.equal(f.host.querySelector('.scene-inspector-fields').disabled, true)
  assert.equal(f.canvas.querySelector('[data-scene-handle]'), null)
  f.engine.stop(); assert.equal(f.scene.selected, 'gestures'); assert.ok(f.host.querySelector('[data-id="b"]').classList.contains('is-selected'))
})

test('资源选择显示引用，放入选择的容器，拖入图片与独立人物聊天可撤销', async t => {
  const f = await fixture(t)
  f.select('chats'); f.host.querySelector('[data-resource="type:text:"]').click(); await settle()
  assert.match(f.host.querySelector('.scene-inspector-fields').textContent, /提供插件/)
  await f.click('放入场景')
  const added = f.scene.expanded().objects.at(-1); assert.equal(added.type, 'text'); assert.equal(added.parent, 'chats')
  f.scene.undo()
  f.host.querySelector('[data-resource="asset:lin:"]').click(); await settle()
  assert.ok(f.host.querySelector('.scene-resource-preview')); assert.ok(f.host.querySelector('.scene-inspector-fields').textContent.includes('立绘 / 表情'))
  const dataTransfer = new f.window.DataTransfer(); dataTransfer.setData(RESOURCE_MIME, JSON.stringify({ kind: 'asset', id: 'station' }))
  const drop=new f.window.Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(drop,'dataTransfer',{value:dataTransfer})
  f.canvas.querySelector('[data-object-id="layout"]').dispatchEvent(drop); await settle()
  assert.deepEqual(f.toasts, [])
  assert.equal(f.scene.expanded().objects.at(-1).props.asset, 'station'); assert.equal(f.scene.expanded().objects.at(-1).parent, 'layout')
  f.scene.undo()
  f.host.querySelector('[data-resource="character:yao:"]').click(); await settle(); await f.click('创建独立角色聊天')
  const chat = f.scene.expanded().objects.at(-1), session = f.scene.expanded().objects.find(o => o.id === chat.refs.session)
  assert.equal(chat.type, 'chat-window'); assert.equal(session.props.characterId, 'yao'); assert.notEqual(session.id, 'yao-session')
  assert.equal(resourceReferences(f.engine, f.scene, { kind: 'character', id: 'yao' }).length, 2)
  f.scene.undo(); assert.equal(resourceReferences(f.engine, f.scene, { kind: 'character', id: 'yao' }).length, 1)
  assert.deepEqual(f.toasts, [])
})

test('导入素材限制格式与大小，音频 MIME 规范化后能保存进作品', async t => {
  const f = await setupScene(t), original = globalThis.FileReader
  globalThis.FileReader = f.window.FileReader; t.after(() => { if (original) globalThis.FileReader = original; else delete globalThis.FileReader })
  await assert.rejects(readAsset({ name: 'video.mp4', type: 'video/mp4', size: 12 }), /请选择/)
  await assert.rejects(readAsset({ name: 'large.png', type: 'image/png', size: 6 * 1024 * 1024 }), /5 MB/)
  const a = await readAsset(new f.window.File(['RIFF'], '声音.wav', { type: 'audio/x-wav' }))
  assert.ok(a.url.startsWith('data:audio/wav;base64,'))
  f.engine.update(p => p.assets.push(a)); await f.engine.save(); assert.equal(f.records.get('first').assets.at(-1).name, '声音.wav')
})

test('层级拖动可改变父对象，并拒绝拖动途中被其他入口更新的版本',async t=>{
  const f=await fixture(t)
  const drag=(id,target,change)=>{
    const dataTransfer=new f.window.DataTransfer()
    const start=new f.window.Event('dragstart',{bubbles:true,cancelable:true});Object.defineProperty(start,'dataTransfer',{value:dataTransfer})
    f.host.querySelector('[data-id="'+id+'"]').dispatchEvent(start)
    change?.()
    const drop=new f.window.Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(drop,'dataTransfer',{value:dataTransfer})
    f.host.querySelector('[data-id="'+target+'"]').dispatchEvent(drop)
  }
  drag('next-day','chats');await settle()
  assert.equal(f.scene.expanded().objects.find(o=>o.id==='next-day').parent,'chats')
  f.scene.undo()
  drag('next-day','chats',()=>f.engine.update(p=>{p.description='并发编辑'}));await settle()
  assert.equal(f.scene.expanded().objects.find(o=>o.id==='next-day').parent,'layout')
  assert.match(f.toasts.at(-1),/版本已变化/)
})
