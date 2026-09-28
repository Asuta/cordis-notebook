import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import freePage from '../applications/notebook/plugins/free-page-editor/dist/client.js'
import { mountEditor } from '../applications/notebook/plugins/rich-text/engine.js'
import { documentService } from '../applications/notebook/plugins/rich-text/document.js'
import { createFreeformFormat } from '../applications/notebook/plugins/format-freeform/format.js'

function fixture(t) {
  const window = new Window(), previous = new Map(), cleanups = [], commands = new Map(), editors = new Map(), selections = new Map()
  for (const [key, value] of Object.entries({
    window, document: window.document, navigator: window.navigator,
    HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node,
    DOMParser: window.DOMParser,
    MutationObserver: window.MutationObserver, sessionStorage: window.sessionStorage,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) cleanup()
    await window.happyDOM.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  const effect = fn => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); return cleanup }
  const format = createFreeformFormat(documentService)
  let note = {
    id: 'page', type: 'freeform', version: 2, page: { color: '#ffffff', rule: 'none' },
    blocks: ['one', 'two'].map((id, i) => ({
      id, x: 40 + i * 400, y: 40, width: 320, text: id, outline: documentService.plain(id, id),
    })),
  }
  let root, notify, finishUpload
  freePage({
    effect,
    noteAssets: { upload: () => new Promise(resolve => { finishUpload = resolve }) },
    noteFormats: { typeOf: n => n.type },
    notebook: {
      busy: false, editable: true, current: () => note,
      flush: async () => {},
      observe(owner, fn) { notify = fn; fn() },
      edit(patch) { note = { ...note, ...format.normalize(patch) }; notify() },
    },
    richText: {
      ...documentService,
      mount(owner, body, options) {
        const editor = mountEditor(owner, body, options)
        editors.set(body.parentElement.getAttribute('data-block-id'), { editor, images: options.images })
        return editor
      },
    },
    // Exercise actual toolbar callbacks without requiring React to render this fixture.
    ui: {
      h(component, props) {
        if (typeof component === 'function') return component(props)
        if (props?.['aria-label']) commands.set(props['aria-label'], props.onClick)
        return null
      },
      React: { useState: value => [value === 'home' ? 'insert' : value, () => {}] },
      mount: () => ({ render() {} }),
    },
    editorHost: { register(owner, type, node) {
      root = node; document.body.append(node)
      const viewport = node.querySelector('.free-page-viewport')
      Object.defineProperties(viewport, { clientWidth: { value: 1000 }, clientHeight: { value: 700 } })
      viewport.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 700 })
      viewport.scrollTo = (left, top) => { viewport.scrollLeft = left; viewport.scrollTop = top }
    } },
  }, {
    effect, toast: text => assert.fail(text),
    agent: { selection(body, capture) { selections.set(body.parentElement.getAttribute('data-block-id'), capture) } },
    el(tag, attrs = {}, text = '') {
      const node = document.createElement(tag)
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
      node.textContent = text; node.setPointerCapture = () => {}
      return node
    },
    listen(node, event, handler) { node.addEventListener(event, handler); cleanups.push(() => node.removeEventListener(event, handler)) },
  })
  return {
    get note() { return structuredClone(note) },
    commands, editors, selections, root, window,
    finishUpload: () => finishUpload('/api/note-assets/' + 'a'.repeat(64) + '.png'),
    pointer(type, selector, x, y, shiftKey = false) {
      (selector ? root.querySelector(selector) : root).dispatchEvent(new window.PointerEvent(type, {
        bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y + 144, shiftKey,
      }))
    },
    undo() { root.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })) },
    redo() { root.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true })) },
  }
}

test('Agent 自由页面选区替换保留页面撤销，旧附件不能覆盖后续编辑', async t => {
  const f = fixture(t), api = f.editors.get('one').editor
  api.editor.commands.setTextSelection({ from: 1, to: 4 })
  const selection = f.selections.get('one')()
  assert.equal(selection.text, 'one')
  await selection.apply('替换内容')
  assert.equal(f.note.blocks[0].text, '替换内容')
  assert.throws(() => selection.apply('覆盖'), /已变化/)
  f.undo(); assert.equal(f.note.blocks[0].text, 'one')
  f.redo(); assert.equal(f.note.blocks[0].text, '替换内容')
})

for (const action of ['move', 'resize', 'space', 'merge']) test(`图片上传与${action}手势重叠时保留内容，撤销只还原手势`, async t => {
  const f = fixture(t)
  // Upload into the other block during a move too: its focus must not change
  // which blocks belong to the gesture already in progress.
  const imageBlock = action === 'move' ? 'two' : 'one'
  const upload = f.editors.get(imageBlock).images([{ name: 'review.png' }])
  const selector = action === 'space' ? '.free-page-paper' : `[data-block-id=one] .free-block-${action === 'resize' ? 'resize' : 'handle'}`
  if (action === 'space') f.commands.get('插入空间')()
  f.pointer('pointerdown', selector, 50, action === 'space' ? 20 : 45)
  f.finishUpload(); await upload
  const withImage = f.note
  assert.ok(withImage.blocks.find(b => b.id === imageBlock).outline.elements.some(n => n.kind === 'image'))
  f.pointer('pointerup', null, action === 'merge' ? 460 : 100, action === 'space' ? 50 : 75, action === 'merge')
  const after = f.note
  assert.equal(after.blocks.flatMap(b => b.outline.elements).filter(n => n.kind === 'image').length, 1)
  assert.ok(after.blocks.some(b => b.text.includes('one')))
  assert.ok(after.blocks.some(b => b.text.includes('two')))
  if (action === 'move') { assert.equal(after.blocks[0].x, 90); assert.equal(after.blocks[1].x, 440) }
  if (action === 'resize') assert.equal(after.blocks[0].width, 370)
  if (action === 'space') assert.deepEqual(after.blocks.map(b => b.y), [70, 70])
  if (action === 'merge') assert.equal(after.blocks.length, 1)
  f.undo(); assert.deepEqual(f.note, withImage)
  f.redo(); assert.deepEqual(f.note, after)
})

const key = (f, target, key, extra = {}) => {
  const event = new f.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })
  target.dispatchEvent(event)
  return event
}
const focus = (f, id) => {
  const api = f.editors.get(id).editor
  api.editor.view.focus()
  return api
}

for (const destination of ['canvas', 'empty', 'text']) test(`多容器复制到 ${destination} 保留各自内容、宽度与相对位置，整组撤销重做`, async t => {
  const f = fixture(t), viewport = f.root.querySelector('.free-page-viewport')
  f.pointer('pointerdown', '[data-block-id=two] .free-block-handle', 450, 45)
  f.pointer('pointerup', null, 470, 175)
  viewport.focus()
  key(f, viewport, 'a', { ctrlKey: true })
  const values = {}, clipboardData = { files: [], setData: (type, value) => { values[type] = value }, getData: type => values[type] || '' }
  const send = (type, target) => {
    const e = new f.window.Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(e, 'clipboardData', { value: clipboardData }); target.dispatchEvent(e)
    return e
  }
  assert.equal(send('copy', viewport).defaultPrevented, true)
  const original = f.note.blocks
  assert.equal(JSON.parse(values['application/x-cordis-outlines']).blocks.length, 2)
  let target = viewport, anchor
  if (destination === 'empty') {
    f.pointer('pointerdown', '.free-page-writing', 850, 400)
    f.pointer('pointerup', null, 850, 400)
    anchor = f.note.blocks.at(-1)
    target = f.editors.get(anchor.id).editor.editor.view.dom
  } else if (destination === 'text') {
    target = focus(f, 'one').editor.view.dom
    anchor = { x: original[0].x + 24, y: original[0].y + 24 }
  }
  const before = f.note
  // The real SDK does not forward arbitrary data attributes; target lookup
  // must use the mounted container map rather than the fixture's attributes.
  for (const node of f.root.querySelectorAll('.free-block')) node.removeAttribute('data-block-id')
  assert.equal(send('paste', target).defaultPrevented, true)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.note.blocks.length, 4)
  assert.deepEqual(f.note.blocks.slice(0, 2), original)
  const copied = f.note.blocks.slice(2)
  assert.deepEqual(copied.map(b => b.text), original.map(b => b.text))
  assert.deepEqual(copied.map(b => b.width), original.map(b => b.width))
  assert.equal(copied[1].x - copied[0].x, original[1].x - original[0].x)
  assert.equal(copied[1].y - copied[0].y, original[1].y - original[0].y)
  if (anchor) assert.deepEqual([copied[0].x, copied[0].y], [anchor.x, anchor.y])
  assert.notEqual(copied[0].outline.elements[0].id, original[0].outline.elements[0].id)
  assert.equal(f.root.querySelectorAll('.free-block.selected').length, 2)
  const after = f.note
  f.undo(); assert.deepEqual(f.note, before)
  f.redo(); assert.deepEqual(f.note, after)
})

test('主题深浅状态即时改变纸张显示，切回浅色不改笔记和历史', async t => {
  const f = fixture(t), before = f.note
  document.documentElement.dataset.themeMode = 'dark'
  await f.window.happyDOM.whenAsyncComplete()
  assert.equal(f.root.dataset.paperMode, 'dark')
  assert.equal(f.root.querySelector('.free-page-paper').style.backgroundColor, '#212121')
  assert.deepEqual(f.note, before)
  delete document.documentElement.dataset.themeMode
  await f.window.happyDOM.whenAsyncComplete()
  assert.equal(f.root.dataset.paperMode, 'light')
  assert.equal(f.root.querySelector('.free-page-paper').style.backgroundColor, '#ffffff')
  assert.deepEqual(f.note, before)
})

test('空容器离开时清理，工具栏操作和上传中的容器不被误删', async t => {
  const f = fixture(t)
  f.pointer('pointerdown', '.free-page-paper', 200, 300)
  f.pointer('pointerup', null, 200, 300)
  const id = f.note.blocks.at(-1).id
  const api = focus(f, id)
  const toolbar = f.root.querySelector('.free-page-controls')
  toolbar.dispatchEvent(new f.window.PointerEvent('pointerdown', { bubbles: true }))
  await Promise.resolve()
  assert.equal(f.note.blocks.length, 3)
  f.pointer('pointerdown', '.free-page-paper', 300, 400)
  f.pointer('pointerup', null, 300, 400)
  assert.equal(f.note.blocks.length, 3)
  assert.ok(!f.note.blocks.some(b => b.id === id))
  assert.ok(api.editor.isDestroyed)
  const pendingId = f.note.blocks.at(-1).id
  focus(f, pendingId)
  const upload = f.editors.get(pendingId).images([{ name: 'picture.png' }])
  f.pointer('pointerdown', '[data-block-id=one] .free-block-body', 50, 70)
  focus(f, 'one')
  await Promise.resolve()
  assert.ok(f.note.blocks.some(b => b.id === pendingId))
  f.finishUpload(); await upload
  assert.equal(f.note.blocks.find(b => b.id === pendingId).outline.elements.at(-1).kind, 'image')
})

test('文字编辑与容器选中区分，点击操作柄后 Delete 删除整容器且可撤销', async t => {
  const f = fixture(t)
  const api = focus(f, 'one')
  assert.equal(f.root.querySelector('[data-block-id=one]').dataset.selected, 'false')
  f.pointer('pointerdown', '[data-block-id=one] .free-block-handle', 50, 45)
  f.pointer('pointerup', null, 50, 45)
  assert.equal(f.root.querySelector('[data-block-id=one]').dataset.selected, 'true')
  assert.equal(document.activeElement, f.root.querySelector('.free-page-viewport'))
  key(f, document.activeElement, 'Delete')
  assert.deepEqual(f.note.blocks.map(b => b.id), ['two'])
  assert.ok(api.editor.isDestroyed)
  f.undo()
  assert.deepEqual(f.note.blocks.map(b => b.id), ['one', 'two'])
  const restored = focus(f, 'one')
  key(f, restored.editor.view.dom, 'Escape')
  assert.equal(f.root.querySelector('[data-block-id=one]').dataset.selected, 'true')
})

test('行首退格逐级取消 Tab 缩进，正文中不吞退格，中文句号键可切换项目符号', async t => {
  const f = fixture(t), api = focus(f, 'one'), dom = api.editor.view.dom
  api.editor.commands.setTextSelection(1)
  key(f, dom, 'Tab'); key(f, dom, 'Tab')
  assert.equal(api.document.elements[0].indent, 2)
  assert.equal(key(f, dom, 'Backspace').defaultPrevented, true)
  assert.equal(api.document.elements[0].indent, 1)
  key(f, dom, 'Backspace')
  assert.equal(api.document.elements[0].indent, 0)
  key(f, dom, 'Tab')
  api.editor.commands.setTextSelection(2)
  key(f, dom, 'Backspace')
  assert.equal(api.document.elements[0].indent, 1, '段中退格不修改段落缩进')
  api.editor.commands.setTextSelection(1)
  key(f, dom, 'Backspace')
  assert.equal(key(f, dom, '。', { code: 'Period', altKey: true }).defaultPrevented, true)
  assert.equal(api.document.elements[0].kind, 'list')
  assert.equal(api.document.elements[0].ordered, false)
  key(f, dom, '.', { code: 'Period', altKey: true })
  assert.equal(api.document.elements[0].kind, 'paragraph')
  key(f, dom, '.', { code: 'Period', altKey: true, isComposing: true })
  assert.equal(api.document.elements[0].kind, 'paragraph', '输入法组词期间不处理快捷键')
})

test('列表行首退格提升层级，Alt Shift 段落操作及反馈组合仅在编辑区拦截', async t => {
  const f = fixture(t), api = focus(f, 'one'), dom = api.editor.view.dom
  api.editor.commands.setContent('<ul><li><p>第一项</p><ul><li><p>第二项</p></li></ul></li></ul>')
  let pos
  api.editor.state.doc.descendants((n, p) => { if (n.type.name === 'paragraph' && n.textContent === '第二项') pos = p + 1 })
  api.editor.commands.setTextSelection(pos)
  key(f, dom, 'Backspace')
  assert.equal(api.document.elements[0].children.length, 2)
  assert.equal(api.document.elements[0].children[1].children[0].runs[0].text, '第二项')
  assert.equal(key(f, dom, 'ArrowUp', { altKey: true, shiftKey: true }).defaultPrevented, true)
  assert.equal(key(f, dom, 'I', { code: 'KeyI', altKey: true, shiftKey: true }).defaultPrevented, true)
  assert.equal(key(f, document.body, 'I', { code: 'KeyI', altKey: true, shiftKey: true }).defaultPrevented, false)
})

test('Office 多格式剪贴板只粘贴一次文字，纯图片仍上传，已处理事件不在画布重放', async t => {
  const f = fixture(t), api = focus(f, 'one'), dom = api.editor.view.dom
  api.editor.commands.setTextSelection({ from: 1, to: 4 })
  const paste = (target, values, files = [], prevented = false) => {
    const event = new f.window.Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { getData: type => values[type] || '', files } })
    if (prevented) event.preventDefault()
    target.dispatchEvent(event)
    return event
  }
  const text = '尝试好“像素控制”能力（10分钟）\n几个路线\n单纯文字\n只是数字限制\n参考图\n普通参考图（ai找找）\n网格参考图\n多次简化'
  const html = '<html><body><!--StartFragment--><ul><li><p>尝试好“像素控制”能力（10分钟）</p><ul><li><p>几个路线</p><ul><li><p>单纯文字</p><ul><li><p>只是数字限制</p></li></ul></li><li><p>参考图</p><ul><li><p>普通参考图（ai找找）</p></li><li><p>网格参考图</p></li><li><p>多次简化</p></li></ul></li></ul></li></ul></li></ul><!--EndFragment--></body></html>'
  const files = [new f.window.File(['image'], 'clipboard.png', { type: 'image/png' })]
  assert.equal(paste(dom, { 'text/plain': text, 'text/html': html }, files).defaultPrevented, true)
  assert.equal(f.note.blocks.length, 2)
  assert.equal(f.note.blocks[0].text, text)
  assert.equal(api.document.elements[0].kind, 'list')
  assert.equal(f.note.blocks[0].x, 40)
  assert.equal(f.note.blocks[0].outline.elements.some(n => n.kind === 'image'), false)
  const before = f.note
  paste(f.root.querySelector('.free-page-viewport'), { 'text/plain': text }, files, true)
  assert.deepEqual(f.note, before)
  paste(dom, {}, files)
  f.finishUpload()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.note.blocks.length, 2)
  assert.equal(f.root.querySelectorAll('.outline-prose img').length, 1)
})

test('默认空白处按下不创建容器，原地松开新建，拖动框选后可整组删除和撤销', t => {
  const f = fixture(t), before = f.note
  assert.ok(!f.commands.has('框选容器'), '不再保留单独的选择模式')
  f.pointer('pointerdown', '.free-page-paper', 200, 300)
  assert.deepEqual(f.note, before)
  f.pointer('pointerup', null, 202, 302)
  assert.equal(f.note.blocks.length, 3)
  assert.equal(f.note.blocks.at(-1).x, 200)
  assert.equal(f.note.blocks.at(-1).y, 300)
  // Leaving the new empty block cleans it up; a fast drag must not create a fourth block.
  f.pointer('pointerdown', '.free-page-paper', 35, 35)
  f.pointer('pointerup', null, 780, 150)
  assert.equal(f.note.blocks.length, 2)
  assert.equal(f.root.querySelectorAll('.free-block.selected').length, 2)
  key(f, document.activeElement, 'Delete')
  assert.equal(f.note.blocks.length, 0)
  f.undo()
  assert.deepEqual(f.note.blocks, before.blocks)
})

test('拖出后返回原点仍是拖动，Esc、失焦与指针取消均不创建容器', t => {
  const f = fixture(t), before = f.note
  f.pointer('pointerdown', '.free-page-paper', 200, 300)
  f.pointer('pointermove', null, 300, 300)
  f.pointer('pointerup', null, 200, 300)
  assert.deepEqual(f.note, before)
  for (const action of ['escape', 'blur', 'pointercancel', 'lostpointercapture']) {
    f.pointer('pointerdown', '.free-page-paper', 200, 300)
    if (action === 'escape') key(f, f.root, 'Escape')
    else if (action === 'blur') f.window.dispatchEvent(new f.window.Event('blur'))
    else f.pointer(action, null, 200, 300)
    f.pointer('pointerup', null, 200, 300)
    assert.deepEqual(f.note, before, action)
  }
})

test('Shift 框选追加原有选择，取消手势及不相关指针不会误建框', t => {
  const f = fixture(t)
  f.pointer('pointerdown', '[data-block-id=one] .free-block-handle', 50, 45)
  f.pointer('pointerup', null, 50, 45)
  f.pointer('pointerdown', '.free-page-paper', 430, 35, true)
  f.pointer('pointerup', null, 780, 150, true)
  assert.equal(f.root.querySelectorAll('.free-block.selected').length, 2)
  f.pointer('pointerdown', '.free-page-paper', 200, 300)
  f.root.dispatchEvent(new f.window.PointerEvent('pointerup', { bubbles: true, pointerId: 2, clientX: 200, clientY: 300 }))
  assert.equal(f.note.blocks.length, 2)
  f.pointer('pointercancel', null, 200, 300)
})

for (const ordered of [false, true]) test(`${ordered ? '编号' : '项目符号'}首项与嵌套项可连续缩进超过八级并反向退回`, t => {
  const f = fixture(t), api = focus(f, 'one'), dom = api.editor.view.dom
  const tag = ordered ? 'ol' : 'ul'
  api.editor.commands.setContent(`<${tag}><li><p>首项</p></li><li><p>第二项</p></li></${tag}>`)
  const setAt = text => {
    let at
    api.editor.state.doc.descendants((n, pos) => { if (n.type.name === 'paragraph' && n.textContent === text) at = pos + 1 })
    api.editor.commands.setTextSelection(at)
  }
  setAt('首项')
  for (let i = 0; i < 24; i++) key(f, dom, 'Tab')
  assert.equal(api.document.elements[0].children[0].indent, 24)
  assert.equal(api.document.elements[0].children.length, 2, '不制造空父项')
  assert.deepEqual(documentService.fromEditor(documentService.toEditor(api.document)), api.document)
  assert.equal(f.note.blocks[0].outline.elements[0].children[0].indent, 24)
  for (let i = 0; i < 12; i++) key(f, dom, 'Tab', { shiftKey: true })
  for (let i = 0; i < 12; i++) key(f, dom, 'Backspace')
  assert.equal(api.document.elements[0].children[0].indent || 0, 0)
  assert.equal(api.document.elements[0].ordered, ordered)
  setAt('第二项')
  key(f, dom, 'Tab') // Normal nesting still works when there is a previous item.
  for (let i = 0; i < 20; i++) key(f, dom, 'Tab')
  const nested = api.document.elements[0].children[0].children.find(n => n.kind === 'list')
  assert.equal(nested.children[0].indent, 20)
  for (let i = 0; i < 21; i++) key(f, dom, 'Tab', { shiftKey: true })
  assert.equal(api.document.elements[0].children.length, 2)
})

test('普通段落不再截断八级缩进，替代列表快捷键只执行一次', t => {
  const f = fixture(t), api = focus(f, 'one'), dom = api.editor.view.dom
  api.editor.commands.setTextSelection(1)
  for (let i = 0; i < 24; i++) key(f, dom, 'Tab')
  assert.equal(api.document.elements[0].indent, 24)
  assert.equal(f.note.blocks[0].outline.elements[0].indent, 24)
  api.setDocument(documentService.plain('快捷键'))
  key(f, dom, '*', { code: 'Digit8', ctrlKey: true, shiftKey: true })
  assert.equal(api.document.elements[0].kind, 'list')
  assert.equal(api.document.elements[0].ordered, false)
  key(f, dom, '*', { code: 'Digit8', ctrlKey: true, shiftKey: true })
  assert.equal(api.document.elements[0].kind, 'paragraph')
  key(f, dom, '&', { code: 'Digit7', ctrlKey: true, shiftKey: true })
  assert.equal(api.document.elements[0].ordered, true)
})
