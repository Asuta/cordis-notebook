import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultBlockSpecs } from '@blocknote/core'
import { blockNoteDocument as service, blockTypes } from '../../format-blocknote/document.js'
import { applyOperations } from '../../blocknote-agent-tools/operations.js'
import { createBlockDocument } from '../../format-block/document.js'
import { documentService } from '../../rich-text/document.js'
import { convertLegacy } from '../migration.js'

const doc = (...blocks) => ({ version: 1, blocks })
const text = value => [{ type: 'text', text: value, styles: {} }]

test('存储校验覆盖已安装的 BlockNote 原生 schema，默认属性往返保留', () => {
  assert.deepEqual([...blockTypes].sort(), Object.keys(defaultBlockSpecs).sort())
  for (const type of blockTypes) {
    const block = service.create(type, '', type)
    block.props = Object.fromEntries(Object.entries(defaultBlockSpecs[type].config.propSchema).filter(([, spec]) => spec.default !== undefined).map(([key, spec]) => [key, spec.default]))
    assert.deepEqual(service.normalize(doc(block)), doc(block))
  }
})

test('嵌套、链接、样式、表格合并和媒体说明参与派生正文且保存独立副本', () => {
  const a = service.create('heading', '', 'a'); a.props.level = 2
  a.content = [{ type: 'text', text: '标题', styles: { bold: true } }, { type: 'link', href: 'https://example.com', content: text('链接') }]
  a.children = [service.create('checkListItem', '任务', 'child')]; a.children[0].props.checked = true
  const table = service.create('table', '', 'table')
  table.content = { type: 'tableContent', columnWidths: [null, 100], headerRows: 1, rows: [{ cells: [{ type: 'tableCell', props: { colspan: 2, rowspan: 1 }, content: text('跨列') }] }] }
  const image = service.create('image', '/api/note-assets/a.png', 'image'); image.props.caption = '图片说明'
  const input = doc(a, table, image), copy = service.normalize(input)
  assert.deepEqual(copy, input)
  assert.equal(service.text(copy), '标题链接\n任务\n跨列\n图片说明')
  copy.blocks[0].content[0].styles.bold = false
  assert.equal(input.blocks[0].content[0].styles.bold, true)
})

test('拒绝会被编辑器静默丢弃的数据、重复 ID、不安全链接和超限正文', () => {
  const a = service.create('paragraph', 'a', 'a')
  for (const invalid of [
    doc(a, a), doc({ ...a, type: 'unknown' }), doc({ ...a, props: { checked: true } }),
    doc({ ...a, content: [{ type: 'link', href: 'javascript:alert(1)', content: text('x') }] }),
    doc({ ...a, type: 'codeBlock', content: [{ type: 'text', text: 'x', styles: { bold: true } }] }),
    doc({ ...a, content: text('x'.repeat(200001)) }),
  ]) assert.throws(() => service.normalize(invalid))
})

test('纵向合并保留可重载的行结构，整行覆盖、跨表格或超出列数会被拒绝', () => {
  const table = service.create('table', '', 'table')
  table.content.rows = [{ cells: [{ type: 'tableCell', props: { colspan: 2, rowspan: 2 }, content: text('合并') }, []] }, { cells: [[]] }]
  assert.deepEqual(service.normalize(doc(table)), doc(table))
  table.content.rows[0].cells[0].props.rowspan = 3
  assert.throws(() => service.normalize(doc(table)), /范围/)
  table.content.rows[0].cells[0].props.rowspan = 1
  table.content.rows[0].cells.push({ type: 'tableCell', props: { colspan: 20 }, content: [] })
  assert.throws(() => service.normalize(doc(table)), /范围/)
  table.content.rows[1].cells = []
  assert.throws(() => service.normalize(doc(table)), /整行/)
})

test('原子操作按 ID 移动子树、修改状态与正文，错误批次不影响输入', () => {
  const a = service.create('paragraph', 'a', 'a'), b = service.create('checkListItem', '任务', 'b')
  const input = doc(a, b), before = structuredClone(input)
  const result = applyOperations(service, input, [
    { op: 'update', blockId: 'b', patch: { props: { checked: true } } },
    { op: 'move', blockId: 'b', placement: 'inside', targetId: 'a' },
    { op: 'insert', placement: 'start', block: { id: 'heading', type: 'heading', text: '新标题', props: { level: 2 } } },
  ])
  assert.deepEqual(input, before)
  assert.deepEqual(result.insertedIds, ['heading'])
  assert.equal(result.document.blocks[1].children[0].props.checked, true)
  for (const bad of [
    { op: 'update', blockId: 'a', patch: { type: null, text: 'x' } },
    { op: 'move', blockId: 'a', placement: 'inside', targetId: 'b' },
    { op: 'insert', block: { id: 'a' } },
    { op: 'remove', blockId: 'missing' },
  ]) {
    const original = structuredClone(result.document)
    assert.throws(() => applyOperations(service, result.document, [{ op: 'update', blockId: 'heading', patch: { text: '不应部分保存' } }, bad]))
    assert.deepEqual(result.document, original)
  }
  const empty = applyOperations(service, doc(a), [{ op: 'remove', blockId: 'a' }]).document
  assert.equal(empty.blocks.length, 1)
  assert.equal(service.text(empty), '')
})

test('旧块复制保留富文本、嵌套、待办和原始文档，降级明确提示', () => {
  const legacy = createBlockDocument(documentService)
  const a = legacy.create('heading', '标题', 'a'); a.body.elements[0].level = 3
  const b = legacy.create('todo', '任务', 'b'); b.checked = true
  b.body.elements[0].runs[0].format = { bold: true, color: '#123456', superscript: true }
  a.children.push(b)
  const c = legacy.create('callout', '提醒', 'c')
  const input = doc(a, c), before = structuredClone(input), converted = convertLegacy(input)
  const copy = service.normalize(converted.document)
  assert.deepEqual(input, before)
  assert.equal(copy.blocks[0].props.level, 3)
  assert.equal(copy.blocks[0].children[0].props.checked, true)
  assert.equal(copy.blocks[0].children[0].content[0].styles.bold, true)
  assert.equal(copy.blocks[1].type, 'quote')
  assert.equal(service.text(copy), '标题\n任务\n提醒')
  assert.equal(converted.warnings.length, 2)
})
