import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { createDependencyView } from '../client/host/dependency-view.js'

const plugin = (id, deps = []) => ({ id, name: id.toUpperCase(), state: 'enabled', enabled: true,
  requires: { client: deps }, provides: { client: [id] }, bindings: { client: Object.fromEntries(deps.map(id => [id, id])) } })
function fixture(t) {
  const window = new Window(), oldDocument = globalThis.document, oldResize = globalThis.ResizeObserver
  let disconnected = 0
  globalThis.document = window.document
  globalThis.ResizeObserver = class { observe() {} disconnect() { disconnected++ } }
  const el = (tag, attrs = {}, text = '') => {
    const node = document.createElement(tag)
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'hidden' || key === 'disabled') node[key] = value
      else node.setAttribute(key, String(value))
    }
    node.textContent = text; return node
  }
  let toggled
  const view = createDependencyView({ el, labels: { enabled: '运行中', disabled: '已停用' }, failures: new Map(),
    card: p => { const card = el('article', {}, p.name), toggle = el('button', {}, p.enabled ? '停用' : '启用'); toggle.onclick = () => { toggled = p.id }; card.append(toggle); return card } })
  document.body.append(view.host); view.host.hidden = false
  const viewport = view.host.querySelector('.dependency-viewport')
  Object.defineProperties(viewport, { clientWidth: { value: 800 }, clientHeight: { value: 500 } })
  viewport.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 500 })
  const items = [plugin('storage'), plugin('ui'), plugin('notes', ['storage', 'ui']), plugin('editor', ['notes', 'ui']), plugin('alone')]
  view.render(items)
  t.after(async () => { view.destroy(); globalThis.document = oldDocument; globalThis.ResizeObserver = oldResize; await window.happyDOM.close() })
  return { view, window, viewport, items, node: id => view.host.querySelector(`[data-plugin-id="${id}"]`),
    get toggled() { return toggled }, get disconnected() { return disconnected } }
}

test('网图每个插件只有一个节点，点击高亮双向关系并沿用插件操作', t => {
  const f = fixture(t), host = f.view.host
  assert.equal(host.querySelectorAll('[data-plugin-id]').length, 5)
  assert.equal(host.querySelectorAll('[data-edge-id]').length, 4)
  f.node('notes').click()
  assert.equal(f.node('notes').getAttribute('aria-pressed'), 'true')
  for (const id of ['storage', 'ui', 'editor']) assert.ok(f.node(id).classList.contains('related'))
  assert.ok(f.node('alone').classList.contains('dimmed'))
  assert.equal(host.querySelectorAll('.dependency-edge.active').length, 3)
  host.querySelector('.dependency-detail article button').click()
  assert.equal(f.toggled, 'notes')
  host.querySelector('[data-source="ui"][data-target="editor"]').dispatchEvent(new f.window.MouseEvent('click', { bubbles: true }))
  assert.match(host.querySelector('.dependency-edge-detail').textContent, /前端 · ui · 已绑定/)
  assert.equal(f.node('editor').getAttribute('aria-pressed'), 'true')
})

test('搜索定位、缩放和平移后，状态刷新保留位置、选中节点与 DOM 身份', t => {
  const f = fixture(t), host = f.view.host, search = host.querySelector('input')
  search.value = 'notes'; search.dispatchEvent(new f.window.Event('input'))
  host.querySelector('.dependency-search-results button').click()
  const scene = host.querySelector('.dependency-scene'), button = f.node('notes'), position = [button.style.left, button.style.top]
  const before = scene.style.transform
  f.viewport.dispatchEvent(new f.window.WheelEvent('wheel', { deltaY: -100, clientX: 400, clientY: 250, cancelable: true }))
  assert.notEqual(scene.style.transform, before)
  f.viewport.dispatchEvent(new f.window.PointerEvent('pointerdown', { button: 0, pointerId: 1, clientX: 20, clientY: 20 }))
  f.viewport.dispatchEvent(new f.window.PointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 60 }))
  f.viewport.dispatchEvent(new f.window.PointerEvent('pointerup', { pointerId: 1, clientX: 120, clientY: 60 }))
  const camera = scene.style.transform
  f.view.render(f.items.map(p => ({ ...p, state: 'disabled', enabled: false })))
  assert.equal(f.node('notes'), button)
  assert.deepEqual([button.style.left, button.style.top], position)
  assert.equal(scene.style.transform, camera)
  assert.equal(button.getAttribute('aria-pressed'), 'true')
  assert.match(button.textContent, /已停用/)
  search.value = 'not-found'; search.dispatchEvent(new f.window.Event('input'))
  assert.match(host.querySelector('.dependency-search-results').textContent, /没有匹配/)
})

test('绑定提供者变化会更新连线，卸载或清空插件不遗留节点，销毁停止观察', t => {
  const f = fixture(t), host = f.view.host
  f.node('notes').click()
  f.view.render([plugin('replacement'), { ...plugin('notes', ['storage']), bindings: { client: { storage: 'replacement' } } }])
  assert.equal(host.querySelectorAll('[data-plugin-id]').length, 2)
  assert.equal(host.querySelectorAll('[data-edge-id]').length, 1)
  assert.equal(host.querySelector('[data-edge-id]').dataset.source, 'replacement')
  assert.equal(f.node('notes').getAttribute('aria-pressed'), 'true')
  f.view.render([])
  assert.equal(host.querySelectorAll('[data-plugin-id]').length, 0)
  assert.equal(host.querySelectorAll('[data-edge-id]').length, 0)
  assert.equal(host.querySelector('.dependency-empty').hidden, false)
  f.view.destroy(); assert.equal(f.disconnected, 1)
  f.view.render(f.items); assert.equal(host.querySelectorAll('[data-plugin-id]').length, 0)
})
