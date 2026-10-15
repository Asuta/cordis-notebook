import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../server/server.js'
import { normalizeDatabase, normalizeFilter, queryRows, validateRows } from '../applications/notebook/plugins/format-database/schema.js'
import { blockNoteDocument as blocks } from '../applications/notebook/plugins/format-blocknote/document.js'
import { applyOperations } from '../applications/notebook/plugins/blocknote-agent-tools/operations.js'

const fields = [{ id: 'f_budget', name: '预算', type: 'number' }, { id: 'f_priority', name: '优先级', type: 'select', options: ['高', '低'] }, { id: 'f_review', name: '已审核', type: 'checkbox' }]
const config = () => normalizeDatabase({ version: 1, view: 'table', fields })
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-db-contract-'))
  const app = await createApp({ port: 0, dataDir: dir, file: join(dir, 'notes.json') })
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }) })
  const request = async (path, body) => { const response = await fetch('http://127.0.0.1:' + app.server.address().port + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, data: await response.json() } }
  return { app, request }
}

test('数据库字段和命名视图校验：类型、重复 ID、选项、筛选引用和范围', () => {
  const db = config()
  assert.equal(db.views.length, 2); assert.equal(db.activeViewId, 'table')
  validateRows(db, [{ properties: { custom: { f_budget: 0, f_priority: '高', f_review: false } } }])
  for (const custom of [{ f_budget: '100' }, { f_budget: Infinity }, { f_priority: '中' }, { f_review: 'false' }]) assert.throws(() => validateRows(db, [{ properties: { custom } }]))
  for (const invalid of [[...fields, fields[0]], [{ id: ['f_bad'], name: '坏字段', type: 'text' }], [{ id: '__proto__', name: '坏字段', type: 'text' }], [{ id: 'f_select', name: '选择', type: 'select', options: ['高', '高'] }]]) assert.throws(() => normalizeDatabase({ version: 1, fields: invalid }))
  assert.throws(() => normalizeDatabase({ ...db, views: [] }))
  assert.throws(() => normalizeDatabase({ ...db, activeViewId: 'missing' }))
  assert.throws(() => normalizeFilter({ rules: [{ field: 'missing', operator: 'eq', value: 1 }] }, fields))
  assert.throws(() => normalizeFilter({ rules: [{ field: 'f_budget', operator: 'contains', value: 1 }] }, fields))
  assert.throws(() => normalizeFilter({ from: '2026-02-30' }, fields))
  assert.throws(() => normalizeFilter({ from: '2026-10-20', to: '2026-10-10' }, fields))
  assert.throws(() => normalizeFilter({ rules: [{ field: 'f_budget', operator: 'gte' }] }, fields))
})

test('保存的视图按自定义类型筛选排序，零和 false 不是空值，模板不会成为记录', () => {
  const notes = [
    { id: 'a', title: '零', parentId: 'db', updatedAt: '2026-10-01', properties: { custom: { f_budget: 0, f_review: false } } },
    { id: 'b', title: '十', parentId: 'db', updatedAt: '2026-10-01', properties: { custom: { f_budget: 10, f_review: true } } },
    { id: 'c', title: '二', parentId: 'db', updatedAt: '2026-10-01', properties: { custom: { f_budget: 2 } } },
    { id: 'd', title: '空', parentId: 'db', updatedAt: '2026-10-01' },
    { id: 'template', title: '模板', parentId: 'db', template: { databaseId: 'db' } },
  ]
  assert.deepEqual(queryRows(notes, 'db', { sort: 'f_budget', direction: 'asc' }, fields).map(note => note.id), ['a', 'c', 'b', 'd'])
  assert.deepEqual(queryRows(notes, 'db', { rules: [{ field: 'f_review', operator: 'eq', value: false }] }, fields).map(note => note.id), ['a'])
  assert.deepEqual(queryRows(notes, 'db', { rules: [{ field: 'f_budget', operator: 'empty' }] }, fields).map(note => note.id), ['d'])
  assert.deepEqual(queryRows(notes, 'db', { rules: [{ field: 'f_budget', operator: 'gte', value: 2 }], sort: 'f_budget', direction: 'desc' }, fields).map(note => note.id), ['b', 'c'])
  assert.deepEqual(notes.map(note => note.id), ['a', 'b', 'c', 'd', 'template'])
})

test('数据库字段变更与记录校验在服务器原子执行，重命名和部分更新保留值', async t => {
  const { app } = await fixture(t), notes = app.ctx.notes
  const db = await notes.create({ type: 'database', fields: { title: '项目库', database: config() } })
  await assert.rejects(notes.create({ id: db.id, fields: { title: '不能覆盖原页面' } }), { status: 409 })
  await assert.rejects(notes.create({ id: '../invalid' }), { status: 400 })
  const proposedId = crypto.randomUUID()
  assert.equal((await notes.create({ id: proposedId, fields: { title: '预检使用稳定 ID' } })).id, proposedId)
  let row = await notes.create({ type: 'blocknote', fields: { parentId: db.id, properties: { custom: { f_budget: 200, f_priority: '高' } } } })
  const original = notes.list()
  await assert.rejects(notes.update(row.id, { properties: { custom: { f_budget: '错误' } } }, 0), /预算/)
  await assert.rejects(notes.update(db.id, { database: { ...db.database, fields: fields.map(field => field.id === 'f_budget' ? { ...field, type: 'checkbox' } : field) } }, 0), /预算/)
  assert.deepEqual(notes.list(), original)
  const renamed = await notes.update(db.id, { database: { ...db.database, fields: fields.map(field => field.id === 'f_budget' ? { ...field, name: '金额' } : field) } }, 0)
  row = await notes.update(row.id, { properties: { custom: { f_budget: 0 } } }, row.revision)
  assert.deepEqual(row.properties.custom, { f_budget: 0, f_priority: '高' })
  row = await notes.update(row.id, { properties: { custom: { f_priority: null } } }, row.revision)
  assert.equal(row.properties.custom.f_budget, 0); assert.equal(row.properties.custom.f_priority, null)
  await assert.rejects(notes.update(db.id, { database: db.database }, 0), { status: 409 })
  await notes.update(db.id, { database: { ...renamed.database, fields: renamed.database.fields.filter(field => field.id !== 'f_budget') } }, renamed.revision)
  assert.equal(notes.list().find(note => note.id === row.id).properties.custom.f_budget, 0, '删除字段保留历史值')
})

test('完整备份恢复数据库字段、视图、模板范围及正文引用；模板历史和独立副本保留', async t => {
  const source = await fixture(t), target = await fixture(t), notes = source.app.ctx.notes
  const db = await notes.create({ type: 'database', fields: { title: '数据库', database: config() } })
  const ref = { ...blocks.create('databaseView', '', 'embed'), props: { databaseId: db.id, viewId: 'board' } }
  const page = await notes.create({ type: 'blocknote', fields: { title: '项目主页', document: { version: 1, blocks: [ref] } } })
  const template = await notes.create({ type: 'blocknote', fields: { title: '任务模板', document: { version: 1, blocks: [blocks.create('paragraph', '原模板正文', 'p')] }, properties: { custom: { f_budget: 30 } }, template: { databaseId: db.id } } })
  const backup = (await source.request('/api/notebook-backup')).data
  const restored = await target.request('/api/notebook-restore', backup)
  assert.equal(restored.status, 200, JSON.stringify(restored.data))
  const importedDb = restored.data.notes.find(note => note.title === db.title), importedPage = restored.data.notes.find(note => note.title === page.title), importedTemplate = restored.data.notes.find(note => note.title === template.title)
  assert.notEqual(importedDb.id, db.id)
  assert.deepEqual(importedDb.database, db.database)
  assert.equal(importedPage.document.blocks[0].props.databaseId, importedDb.id)
  assert.equal(importedPage.document.blocks[0].props.viewId, 'board')
  assert.equal(importedTemplate.template.databaseId, importedDb.id)
  assert.deepEqual(target.app.ctx.noteFormats.references(importedTemplate), [importedDb.id])
  const copy = await notes.create({ type: 'blocknote', fields: { ...source.app.ctx.noteFormats.patch(template), parentId: db.id, template: null } })
  await notes.update(template.id, { document: { version: 1, blocks: [blocks.create('paragraph', '模板已修改', 'p')] } }, 0)
  assert.equal(notes.list().find(note => note.id === copy.id).content, '原模板正文')
  assert.equal(notes.history(template.id).length, 1)
  await assert.rejects(notes.create({ fields: { parentId: template.id } }), /模板/)
  await assert.rejects(notes.update(template.id, { parentId: db.id }, 1), /模板/)
  await notes.remove(template.id, 1)
  const restoredTemplate = await notes.restoreTrash(notes.trash()[0].id)
  assert.equal(restoredTemplate.template.databaseId, db.id)
})

test('Agent 数据库块操作不接受文字，嵌套引用均可重映射且保留视图 ID', () => {
  const { document } = applyOperations(blocks, { version: 1, blocks: [blocks.create('paragraph', '原文', 'p')] }, [{ op: 'insert', block: { id: 'db', type: 'databaseView', props: { databaseId: 'db-source', viewId: 'table' } } }])
  assert.deepEqual(blocks.references(document), ['db-source'])
  assert.equal(blocks.remapReferences(document, { 'db-source': 'db-copy' }).blocks[1].props.databaseId, 'db-copy')
  assert.equal(blocks.remapReferences(document, { 'db-source': 'db-copy' }).blocks[1].props.viewId, 'table')
  assert.throws(() => applyOperations(blocks, document, [{ op: 'update', blockId: 'db', patch: { text: '不允许' } }]))
  assert.throws(() => applyOperations(blocks, document, [{ op: 'update', blockId: 'db', patch: { props: { databaseId: '../invalid' } } }]))
})
