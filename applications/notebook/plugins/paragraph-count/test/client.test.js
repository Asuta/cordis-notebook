import { test } from 'node:test'
import assert from 'node:assert/strict'
import createParagraphCount from '../client.js'

/** 最小桩 DOM/SDK：只覆盖客户端入口用到的宿主契约，不替代真实浏览器验收。 */
function createElement(tag) {
  return {
    tagName: tag.toUpperCase(), children: [], dataset: {}, attributes: {},
    textContent: '', className: '', title: '', parent: null,
    append(...items) { for (const item of items) { item.parent = this; this.children.push(item) } },
    remove() {
      if (!this.parent) return
      this.parent.children = this.parent.children.filter(child => child !== this)
      this.parent = null
    },
    setAttribute(name, value) { this.attributes[name] = String(value) },
    getAttribute(name) { return this.attributes[name] ?? null },
  }
}

/** 模拟宿主的归属关系：挂载与订阅都随插件上下文释放。 */
function createHarness({ note = null } = {}) {
  const state = { note }
  const mounted = [], observers = [], disposers = [], slots = []
  const ctx = {
    notebook: {
      current: () => state.note,
      observe(owner, handler) {
        assert.equal(owner, ctx, '订阅必须绑定插件上下文')
        observers.push(handler)
        ctx.effect(() => () => observers.splice(observers.indexOf(handler), 1))
        handler() // 真实服务在订阅时立即回调一次
        return () => {}
      },
    },
    effect(callback) { const dispose = callback(); if (typeof dispose === 'function') disposers.push(dispose) },
  }
  const sdk = {
    el(tag, props = {}, text) {
      const node = createElement(tag)
      for (const [key, value] of Object.entries(props)) {
        if (key === 'class') node.className = value
        else if (key.startsWith('aria-')) node.setAttribute(key, value)
        else node[key] = value
      }
      if (text !== undefined) node.textContent = text
      return node
    },
    mount(name, node) {
      const slot = createElement('div')
      slots.push(slot)
      mounted.push({ name, node })
      ctx.effect(() => { slot.append(node); return () => node.remove() })
      return node
    },
  }
  createParagraphCount(ctx, sdk)
  const root = mounted[0].node
  return {
    mounted, root, slot: slots[0], value: root.children[0], observers,
    setNote: next => { state.note = next },
    /** 模拟 notebook/changed：编辑正文或切换笔记都会走这里。 */
    notify: () => { for (const handler of [...observers]) handler() },
    dispose: () => { for (const dispose of disposers.splice(0).reverse()) dispose() },
  }
}

test('挂载到编辑区底栏，没有选中笔记时显示空状态', () => {
  const { mounted, root, value } = createHarness()
  assert.equal(mounted.length, 1, '一次激活只挂载一份界面')
  assert.equal(mounted[0].name, 'footer')
  assert.equal(root.className, 'paragraph-count')
  assert.equal(root.getAttribute('role'), 'group')
  assert.equal(root.getAttribute('aria-label'), '段落计数')
  assert.equal(value.textContent, '未选择笔记')
  assert.equal(root.dataset.state, 'no-note')
  assert.equal(root.title, '选择一篇笔记后显示段落数')
})

test('选中没有正文的笔记时显示「正文为空」', () => {
  const harness = createHarness({ note: { id: 'a', content: '   \n\t' } })
  assert.equal(harness.value.textContent, '正文为空')
  assert.equal(harness.root.dataset.state, 'empty')
  assert.equal(harness.root.title, '当前笔记正文为空，写点内容后显示段落数')
})

test('编辑内容后段落数即时更新', () => {
  const harness = createHarness({ note: { id: 'a', content: '第一段\n\n第二段' } })
  assert.equal(harness.value.textContent, '2 段')
  assert.equal(harness.root.dataset.state, 'ready')
  assert.equal(harness.root.title, '共 2 个非空段落，按空行分段')
  harness.setNote({ id: 'a', content: '第一段\n\n第二段\n\n第三段' })
  harness.notify()
  assert.equal(harness.value.textContent, '3 段')
  harness.setNote({ id: 'a', content: '' })
  harness.notify()
  assert.equal(harness.value.textContent, '正文为空')
  assert.equal(harness.root.dataset.state, 'empty')
})

test('切换笔记后按新笔记内容更新，包括 Markdown 派生正文', () => {
  const harness = createHarness({ note: { id: 'a', content: '单段' } })
  assert.equal(harness.value.textContent, '1 段')
  harness.setNote({ id: 'b', type: 'markdown', markdown: '# 标题\n\n正文一\n\n正文二', content: '标题\n正文一\n正文二' })
  harness.notify()
  assert.equal(harness.value.textContent, '3 段')
  harness.setNote(undefined)
  harness.notify()
  assert.equal(harness.value.textContent, '未选择笔记')
})

test('停用后释放订阅与节点，重新启用只保留一份界面', () => {
  const first = createHarness({ note: { id: 'a', content: '一\n\n二' } })
  assert.equal(first.observers.length, 1)
  assert.equal(first.slot.children.length, 1)
  first.dispose()
  assert.equal(first.observers.length, 0, '停用后不再收到 notebook/changed')
  assert.equal(first.slot.children.length, 0, '停用后移除界面节点')

  const second = createHarness({ note: { id: 'a', content: '一\n\n二' } })
  assert.equal(second.mounted.length, 1)
  assert.equal(second.slot.children.length, 1, '重新启用不重复挂载')
  assert.equal(second.value.textContent, '2 段')
  second.dispose()
  assert.equal(second.slot.children.length, 0)
})
