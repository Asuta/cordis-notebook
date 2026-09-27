import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { mountEditor } from '../applications/notebook/plugins/rich-text/engine.js'
import { normalizeDocument, fromEditor, toEditor, documentText } from '../applications/notebook/plugins/rich-text/document.js'

const p = (id, indent = 0) => ({ id, kind: 'paragraph', indent, runs: [{ text: id }] })
const item = (id, children = [], indent = 0) => ({ id, kind: 'item', indent, children: [p(id + '-text'), ...children] })
const list = (id, children, ordered = false) => ({ id, kind: 'list', ordered, children })
function fixture(t, elements) {
  const window = new Window(), saved = new Map(), cleanups = []
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator,
    HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node, DOMParser: window.DOMParser,
    MutationObserver: window.MutationObserver, getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  const el = document.createElement('div'); document.body.append(el)
  const changes = []
  const api = mountEditor({ effect(fn) { cleanups.push(fn()) } }, el, {
    document: normalizeDocument({ version: 1, elements }), change: doc => changes.push(doc), error: e => { throw e },
  })
  const pos = id => { let result; api.editor.state.doc.descendants((n, at) => { if (n.attrs.id === id) result = at }); return result }
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) cleanup?.()
    await window.happyDOM.close()
    for (const [key, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]
  })
  return { api, el, changes, pos,
    select(id, end = id) { api.editor.commands.setTextSelection({ from: pos(id) + 1, to: pos(end) + api.editor.state.doc.nodeAt(pos(end)).nodeSize - 1 }) },
    key(key, extra = {}) { const e = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }); api.editor.view.dom.dispatchEvent(e); return e },
    keyup(key, extra = {}) { const e = new window.KeyboardEvent('keyup', { key, bubbles: true, cancelable: true, ...extra }); api.editor.view.dom.dispatchEvent(e); return e },
  }
}

for (const ordered of [false, true]) test(`${ordered ? '编号' : '项目符号'}转换在段落与列表项间转移缩进且一次更新可撤销`, t => {
  const f = fixture(t, [p('first', 3), p('second', 5)])
  f.select('first', 'second')
  const before = f.api.document, count = f.changes.length
  f.api.exec(ordered ? 'number' : 'bullet')
  assert.equal(f.changes.length, count + 1)
  const items = f.api.document.elements[0].children
  assert.deepEqual(items.map(n => n.indent), [2, 4])
  assert.deepEqual(items.map(n => n.children[0].indent), [0, 0])
  f.api.exec(ordered ? 'number' : 'bullet')
  assert.deepEqual(f.api.document, before)
  f.api.setDocument(before)
  f.select('first'); f.api.exec('bullet'); f.api.exec('number')
  assert.equal(f.api.document.elements[0].children[0].indent, 2)
  assert.equal(f.api.document.elements[0].children[0].children[0].indent, 0)
})

test('三级列表内部移动携带子项和反向选区，到达边界后可以越过父项', t => {
  const f = fixture(t, [list('L1', [item('parent', [list('L2', [item('middle', [list('L3', [
    item('a'), item('b', [list('L4', [item('child')])]), item('c'), item('d'),
  ])]), item('other-middle')])]), item('other-parent')]), p('outside')])
  const ids = () => f.api.document.elements[0].children[0].children[1].children[0].children[1].children.map(n => n.id)
  f.select('b-text')
  const before = f.api.document, selected = f.api.editor.state.doc.textBetween(f.api.editor.state.selection.from, f.api.editor.state.selection.to)
  f.key('ArrowDown', { altKey: true, shiftKey: true })
  assert.deepEqual(ids(), ['a', 'c', 'b', 'd'])
  assert.equal(f.api.editor.state.doc.textBetween(f.api.editor.state.selection.from, f.api.editor.state.selection.to), selected)
  assert.ok(f.api.document.elements[0].children[0].children[1].children[0].children[1].children[2].children[1])
  f.key('ArrowUp', { altKey: true, shiftKey: true })
  assert.deepEqual(f.api.document, before)
  f.select('b-text', 'c-text')
  const { from, to } = f.api.editor.state.selection
  f.api.editor.commands.setTextSelection({ from: to, to: from })
  f.key('ArrowUp', { altKey: true, shiftKey: true })
  assert.deepEqual(ids(), ['b', 'c', 'a', 'd'])
  assert.ok(f.api.editor.state.selection.anchor > f.api.editor.state.selection.head)
  f.select('b-text')
  f.key('ArrowUp', { altKey: true, shiftKey: true })
  assert.ok(f.pos('b-text') < f.pos('middle-text'))
  assert.ok(f.pos('child-text') < f.pos('middle-text'))
})

test('取消嵌套列表提升项目时额外缩进不重复累加', t => {
  const f = fixture(t, [list('outer', [item('parent', [list('inner', [item('child', [], 3)])])])])
  f.select('child-text'); f.api.exec('bullet')
  const child = f.api.document.elements[0].children.find(n => n.id === 'child')
  assert.equal(child.indent, 4)
  assert.equal(child.children[0].indent, 0)
})

test('列表折叠隐藏从属正文与子列表，嵌套状态独立保存，按钮把隐藏光标移回父项', t => {
  const f = fixture(t, [list('outer', [item('parent', [p('detail'), list('inner', [
    item('child', [list('deep', [item('leaf')])]), item('sibling'),
  ])]), item('outside')])])
  const header = id => f.el.querySelector(`[data-element-id="${id}"]`)
  f.select('child-text'); f.key('-', { code: 'Minus', altKey: true, shiftKey: true })
  assert.equal(header('deep').classList.contains('outline-folded'), true)
  f.select('leaf-text')
  header('parent-text').querySelector('button').click()
  assert.equal(header('detail').classList.contains('outline-folded'), true)
  assert.equal(header('inner').classList.contains('outline-folded'), true)
  assert.equal(header('outside').classList.contains('outline-folded'), false)
  assert.equal(f.api.editor.state.selection.from, f.pos('parent-text') + 1)
  const saved = f.api.document
  assert.deepEqual(fromEditor(toEditor(saved)), saved)
  f.api.setDocument(saved)
  header('parent-text').querySelector('button').click()
  assert.equal(header('inner').classList.contains('outline-folded'), false)
  assert.equal(header('deep').classList.contains('outline-folded'), true)
  f.select('child-text'); f.key('+', { code: 'Equal', altKey: true, shiftKey: true })
  assert.equal(header('deep').classList.contains('outline-folded'), false)
  assert.equal(header('leaf-text').querySelector('button'), null)
  assert.equal(documentText(f.api.document), documentText(saved))
})

test('额外缩进的列表项与普通段落按相同父子边界移动和折叠', t => {
  const f = fixture(t, [list('list', [item('root'), item('a', [], 3), item('a-child', [], 5), item('b', [], 3), item('next')]),
    p('plain'), p('detail', 2), p('end')])
  f.select('a-text'); f.api.exec('collapse')
  assert.ok(f.el.querySelector('[data-element-id="a-child"]').classList.contains('outline-folded'))
  f.api.exec('moveParagraph', 1)
  assert.deepEqual(f.api.document.elements[0].children.map(n => n.id), ['root', 'b', 'a', 'a-child', 'next'])
  f.api.exec('moveParagraph', 1)
  assert.ok(f.pos('a-text') > f.pos('next-text'))
  assert.ok(f.pos('a-child-text') > f.pos('a-text'))
  f.select('plain'); f.api.exec('collapse')
  assert.ok(f.el.querySelector('[data-element-id="detail"]').classList.contains('outline-folded'))
  f.api.exec('moveParagraph', 1)
  assert.deepEqual(f.api.document.elements.slice(1).map(n => n.id), ['end', 'plain', 'detail'])
})

test('Ctrl 与 Alt 加中英文句号只触发一次列表，组词与按住重复不触发', t => {
  const f = fixture(t, [p('text')]); f.select('text')
  const e = f.key('。', { code: 'Period', altKey: true })
  assert.equal(e.defaultPrevented, true)
  assert.equal(f.api.document.elements[0].kind, 'list')
  f.key('.', { code: 'Period', altKey: true })
  assert.equal(f.api.document.elements[0].kind, 'paragraph')
  assert.equal(f.key('。', { code: 'Period', ctrlKey: true }).defaultPrevented, true)
  assert.equal(f.api.document.elements[0].kind, 'list')
  f.key('.', { code: 'Period', ctrlKey: true, repeat: true })
  assert.equal(f.api.document.elements[0].kind, 'list')
  f.key('Process', { code: 'Period', keyCode: 229, ctrlKey: true })
  assert.equal(f.api.document.elements[0].kind, 'paragraph')
  f.key('Process', { code: 'Period', keyCode: 229, ctrlKey: true, isComposing: true })
  f.key('。', { code: 'Period', altKey: true, isComposing: true })
  assert.equal(f.api.document.elements[0].kind, 'paragraph')
})

test('零缩进增加一档，已有一档或多档缩进加列表时文字位置不变，取消后保留位置', t => {
  const f = fixture(t, [p('zero'), p('one', 1), p('many', 24)])
  for (const [id, extra] of [['zero', 0], ['one', 0], ['many', 23]]) {
    f.select(id); f.api.exec('bullet')
    const at = f.api.editor.state.doc.resolve(f.pos(id))
    assert.equal(at.parent.attrs.indent, extra)
    assert.equal(at.parent.firstChild.attrs.indent, 0)
    f.api.exec('bullet')
    assert.equal(f.api.editor.state.doc.nodeAt(f.pos(id)).attrs.indent, extra + 1)
  }
})

test('选中的列表子集可越过前后的普通段落，连续移动保留缩进、文字选区及内容', t => {
  const f = fixture(t, [p('before'), list('L', [item('a'), item('b'), item('c')]), p('after')])
  f.select('a-text', 'b-text')
  const selectionText = () => f.api.editor.state.doc.textBetween(f.api.editor.state.selection.from, f.api.editor.state.selection.to, '\n')
  const selected = selectionText()
  f.api.exec('moveParagraph', -1)
  assert.ok(f.pos('b-text') < f.pos('before'))
  assert.equal(selectionText(), selected)
  assert.equal(f.api.document.elements[0].kind, 'list')
  assert.deepEqual(f.api.document.elements[0].children.map(n => n.id), ['a', 'b'])
  assert.equal(f.api.exec('moveParagraph', -1), false)
  f.api.exec('moveParagraph', 1)
  f.api.exec('moveParagraph', 1)
  f.api.exec('moveParagraph', 1)
  assert.ok(f.pos('a-text') > f.pos('after'))
  assert.equal(selectionText(), selected)
  assert.equal(f.api.exec('moveParagraph', 1), false)
  const texts = []; f.api.editor.state.doc.descendants(n => { if (n.isTextblock) texts.push(n.textContent) })
  assert.deepEqual(texts, ['before', 'c-text', 'after', 'a-text', 'b-text'])
})

test('深层子项跨越祖先时携带折叠子树并保持绝对缩进，撤回内容可完整恢复', t => {
  const child = { ...item('child', [p('detail'), list('deep', [item('leaf')])]), collapsed: true }
  const f = fixture(t, [p('before'), list('outer', [item('parent', [list('inner', [child, item('sibling')])])]), p('after')])
  const before = f.api.document
  const column = id => {
    const at = f.api.editor.state.doc.resolve(f.pos(id)); let value = at.nodeAfter.attrs.indent || 0
    for (let d = 1; d <= at.depth; d++) {
      const n = at.node(d)
      if (['bulletList', 'orderedList'].includes(n.type.name)) value++
      if (n.type.name === 'listItem') value += n.attrs.indent || 0
    }
    return value
  }
  f.select('child-text'); const cols = ['child-text', 'detail', 'leaf-text'].map(column)
  f.api.exec('moveParagraph', -1)
  assert.ok(f.pos('child-text') < f.pos('parent-text'))
  assert.deepEqual(['child-text', 'detail', 'leaf-text'].map(column), cols)
  assert.ok(f.el.querySelector('[data-element-id="detail"]').classList.contains('outline-folded'))
  f.api.exec('moveParagraph', -1)
  assert.ok(f.pos('leaf-text') < f.pos('before'))
  assert.deepEqual(['child-text', 'detail', 'leaf-text'].map(column), cols)
  assert.deepEqual(fromEditor(toEditor(f.api.document)), f.api.document)
  f.api.setDocument(before)
  assert.deepEqual(f.api.document, before)
})

test('跨列表移动保留编号起点、文字格式、图片与未涉及的表格', t => {
  const bold = p('styled'); bold.runs[0].format = { bold: true, color: '#123456' }
  const image = { id: 'picture', kind: 'image', src: '/api/note-assets/' + 'b'.repeat(64) + '.png' }
  const table = { id: 'table', kind: 'table', children: [{ id: 'row', kind: 'row', children: [
    { id: 'cell', kind: 'cell', children: [p('cell-text')] },
  ] }] }
  const f = fixture(t, [p('before'), { ...list('numbered', [
    { id: 'styled-item', kind: 'item', children: [bold, image] }, item('two'),
  ], true), start: 7 }, table])
  const originalTable = f.api.document.elements.at(-1)
  f.select('styled'); f.api.exec('moveParagraph', -1)
  assert.equal(f.api.document.elements[0].ordered, true)
  assert.equal(f.api.document.elements[0].start, 7)
  assert.deepEqual(f.api.document.elements[0].children[0].children[0].runs[0].format, bold.runs[0].format)
  assert.equal(f.api.document.elements[0].children[0].children[1].src, image.src)
  assert.deepEqual(f.api.document.elements.at(-1), originalTable)
})

test('浅深色显示调整文字对比度而不改写颜色、图片或触发保存', t => {
  const f = fixture(t, [{ ...p('colored'), runs: [
    { text: '黑色文字', format: { color: '#000000' } },
    { text: '黄色高亮', format: { color: '#eeeeee', highlight: '#fff59d' } },
  ] }, { id: 'image', kind: 'image', src: '/api/note-assets/' + 'a'.repeat(64) + '.png', alt: '原图' }])
  const before = f.api.document, changes = f.changes.length
  f.api.setAppearance({ background: '#212121', foreground: '#eeeeee' })
  assert.ok(f.el.querySelector('.outline-contrast'))
  assert.notEqual(f.el.querySelector('.outline-contrast').style.getPropertyValue('--outline-readable-ink'), '#000000')
  assert.equal(f.el.querySelector('img').getAttribute('src'), before.elements[1].src)
  f.api.setAppearance({ background: '#ffffff', foreground: '#252525' })
  assert.equal(f.changes.length, changes)
  assert.deepEqual(f.api.document, before)
})

test('逐行下移插入 1 和 2 之间，再移动到 2 和 3 之间，保留列表缩进与选区', t => {
  const f = fixture(t, [list('english-list', [item('english')]), p('111'), list('numbers', [item('222'), item('333')])])
  const order = () => { const out = []; f.api.editor.state.doc.descendants(n => { if (n.isTextblock) out.push(n.attrs.id) }); return out }
  f.select('english-text')
  f.key('ArrowDown', { altKey: true, shiftKey: true })
  assert.deepEqual(order(), ['111', 'english-text', '222-text', '333-text'])
  const at = f.api.editor.state.doc.resolve(f.pos('english-text'))
  assert.equal(at.parent.type.name, 'listItem')
  assert.equal(at.parent.attrs.indent, 0)
  assert.equal(f.api.editor.state.doc.textBetween(f.api.editor.state.selection.from, f.api.editor.state.selection.to), 'english-text')
  f.key('ArrowDown', { altKey: true, shiftKey: true })
  assert.deepEqual(order(), ['111', '222-text', 'english-text', '333-text'])
  f.key('ArrowUp', { altKey: true, shiftKey: true })
  assert.deepEqual(order(), ['111', 'english-text', '222-text', '333-text'])
})

test('经过展开的列表父项时只经过该行，折叠父项则跳过隐藏内容', t => {
  const f = fixture(t, [list('L', [item('moving'), item('parent', [list('children', [item('child')])])])])
  f.select('moving-text'); f.api.exec('moveParagraph', 1)
  assert.ok(f.pos('moving-text') > f.pos('parent-text') && f.pos('moving-text') < f.pos('child-text'))
  f.api.setDocument(normalizeDocument({ version: 1, elements: [list('L', [item('moving'),
    { ...item('parent', [list('children', [item('child')])]), collapsed: true }])] }))
  f.select('moving-text'); f.api.exec('moveParagraph', 1)
  assert.ok(f.pos('moving-text') > f.pos('child-text'))
  f.api.exec('moveParagraph', -1)
  assert.ok(f.pos('moving-text') < f.pos('parent-text'))
})

test('句号键仅在 keyup 被识别也能触发，一次按下松开不重复切换', t => {
  const f = fixture(t, [p('text')]); f.select('text')
  f.key('Process', { keyCode: 229, ctrlKey: true })
  assert.equal(f.api.document.elements[0].kind, 'paragraph')
  assert.equal(f.keyup('.', { code: 'Period', ctrlKey: true }).defaultPrevented, true)
  assert.equal(f.api.document.elements[0].kind, 'list')
  f.key('.', { code: 'Period', ctrlKey: true }); f.keyup('.', { code: 'Period', ctrlKey: true })
  assert.equal(f.api.document.elements[0].kind, 'paragraph')
  // Some input methods suppress keydown entirely.
  f.keyup('。', { code: 'Period', ctrlKey: true })
  assert.equal(f.api.document.elements[0].kind, 'list')
  f.key('Process', { keyCode: 229, ctrlKey: true })
  f.keyup('Control'); f.keyup('.', { code: 'Period' })
  assert.equal(f.api.document.elements[0].kind, 'paragraph')
  f.key('Process', { keyCode: 229, ctrlKey: true, isComposing: true })
  f.keyup('.', { code: 'Period', ctrlKey: true })
  assert.equal(f.api.document.elements[0].kind, 'paragraph', '组词期间按下的键，结束组词后松开也不触发')
  f.key('.', { code: 'Period' }); f.keyup('.', { code: 'Period' })
  assert.equal(f.api.document.elements[0].kind, 'paragraph', '普通标点不触发快捷键')
})

const table = (empty = false) => ({ id: 'table', kind: 'table', children: [{ id: 'row', kind: 'row', children: [
  { id: 'cell-a', kind: 'cell', children: [{ ...p('a'), runs: empty ? [] : [{ text: '甲' }] }] },
  { id: 'cell-b', kind: 'cell', children: [{ ...p('b'), runs: empty ? [] : [{ text: '乙' }] }] },
] }] })

for (const key of ['Delete', 'Backspace']) test(`${key} 删除空表格、选中的整表与图片，不误删普通单元格中的非空表格`, t => {
  const f = fixture(t, [p('before'), table(), p('after')])
  const original = f.api.document
  f.api.editor.commands.setTextSelection(f.pos('a') + 1)
  // Browser text deletion remains native; our custom handler must not remove the table.
  f.key(key)
  assert.ok(f.api.document.elements.some(n => n.kind === 'table'))
  f.api.setDocument(original)
  f.api.editor.commands.setTextSelection(f.pos('a') + 1)
  f.key('Escape')
  assert.equal(f.api.editor.state.selection.node?.type.name, 'table')
  f.key(key)
  assert.deepEqual(f.api.document.elements.map(n => n.id), ['before', 'after'])
  f.api.setDocument(original)
  f.el.querySelector('.outline-table-select').click()
  f.key(key)
  assert.deepEqual(f.api.document.elements.map(n => n.id), ['before', 'after'])
  f.api.setDocument(normalizeDocument({ version: 1, elements: [table(true)] }))
  f.api.editor.commands.setTextSelection(f.pos('a') + 1)
  f.key(key)
  assert.equal(f.api.document.elements.some(n => n.kind === 'table'), false)
  f.api.setDocument(normalizeDocument({ version: 1, elements: [p('before'),
    { id: 'image', kind: 'image', src: '/api/note-assets/' + 'a'.repeat(64) + '.png' }, p('after')] }))
  f.api.editor.commands.setNodeSelection(f.pos('image'))
  f.key(key)
  assert.deepEqual(f.api.document.elements.map(n => n.id), ['before', 'after'])
})

test('选择部分单元格只清空内容，整表选择可删除，输入法期间 Delete 不删除对象', t => {
  const f = fixture(t, [table()])
  f.api.editor.commands.setCellSelection({ anchorCell: f.pos('cell-a') })
  f.key('Delete')
  assert.equal(f.api.document.elements[0].kind, 'table')
  assert.equal(documentText(f.api.document), '\t乙')
  f.api.editor.commands.setNodeSelection(f.pos('table'))
  f.key('Delete', { isComposing: true })
  assert.equal(f.api.document.elements[0].kind, 'table')
  f.api.editor.commands.setCellSelection({ anchorCell: f.pos('cell-a'), headCell: f.pos('cell-b') })
  f.key('Delete')
  assert.equal(f.api.document.elements.some(n => n.kind === 'table'), false)
})
