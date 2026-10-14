import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from 'cordis'
import { Notes } from '../applications/notebook/plugins/notes/server.js'
import { noteFormats } from '../applications/notebook/plugins/note-formats/server.js'
import { formatPlain } from '../applications/notebook/plugins/format-plain/server.js'

async function fixture(t, initial = []) {
  const ctx = new Context(); let disk = structuredClone(initial), failing = false
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(owner => { Object.assign(new Service(owner, 'storage'), {
    read: async () => structuredClone(disk), write: async value => { if (failing) throw Error('模拟磁盘写入失败'); disk = structuredClone(value) },
  }) })
  await ctx.plugin(noteFormats); const format = ctx.plugin(formatPlain); await format
  const notes = new Notes(ctx); await notes.load()
  return { ctx, notes, format, disk: () => structuredClone(disk), fail: value => { failing = value } }
}

test('旧文件迁移；版本预览、恢复、撤回恢复和重启保持完整内容', async t => {
  const f = await fixture(t, [{ id: 'legacy', title: '旧页', content: '旧正文', pinned: false, createdAt: '2026-01-01', updatedAt: '2026-01-01' }])
  const saved = await f.notes.update('legacy', { content: '新正文' }, 0)
  const [version] = f.notes.history('legacy')
  assert.equal(version.note.content, '旧正文')
  assert.equal(f.disk().format, 'cordis-notebook-store')
  await assert.rejects(f.notes.restoreVersion('legacy', version.id, 0), { code: 'NOTE_REVISION_CONFLICT' })
  const restored = await f.notes.restoreVersion('legacy', version.id, saved.revision)
  assert.equal(restored.content, '旧正文'); assert.equal(restored.revision, 2)
  assert.equal(f.notes.history('legacy')[0].note.content, '新正文')
  const reopened = await fixture(t, f.disk())
  assert.deepEqual(reopened.notes.list(), f.notes.list())
  assert.deepEqual(reopened.notes.history('legacy'), f.notes.history('legacy'))
})

test('磁盘失败不改变正文、历史或回收站；恢复及永久删除同样原子', async t => {
  const f = await fixture(t), note = await f.notes.create({ fields: { content: '珍贵正文' } })
  const original = f.disk(); f.fail(true)
  await assert.rejects(f.notes.update(note.id, { content: '失败更新' }, 0), /磁盘/)
  await assert.rejects(f.notes.remove(note.id, 0), /磁盘/)
  assert.deepEqual(f.disk(), original); assert.deepEqual(f.notes.list(), [note]); assert.deepEqual(f.notes.trash(), [])
  f.fail(false); await f.notes.remove(note.id, 0)
  const [entry] = f.notes.trash(); f.fail(true)
  await assert.rejects(f.notes.restoreTrash(entry.id), /磁盘/)
  await assert.rejects(f.notes.purgeTrash(entry.id), /磁盘/)
  assert.deepEqual(f.notes.list(), []); assert.equal(f.notes.trash().length, 1)
  f.fail(false); const restored = await f.notes.restoreTrash(entry.id)
  assert.equal(restored.id, note.id); assert.equal(restored.revision, 1); assert.equal(restored.content, '珍贵正文')
  await assert.rejects(f.notes.update(note.id, { content: '删除前旧标签页' }, 0), { code: 'NOTE_REVISION_CONFLICT' })
  await f.notes.remove(note.id, 1); await f.notes.purgeTrash(f.notes.trash()[0].id)
  assert.deepEqual(f.notes.trash(), []); assert.deepEqual(f.notes.history(note.id), [])
})

test('恢复保留 ID 和引用；无效父关系降为顶层，停用格式不会丢失回收站数据', async t => {
  const f = await fixture(t), parent = await f.notes.create(), child = await f.notes.create({ fields: { parentId: parent.id } })
  await f.notes.remove(child.id, 0); const [entry] = f.notes.trash()
  await f.notes.remove(parent.id, 0)
  await f.format.dispose()
  await assert.rejects(f.notes.restoreTrash(entry.id), /格式/)
  assert.equal(f.notes.trash().length, 2)
  await f.ctx.plugin(formatPlain)
  const restored = await f.notes.restoreTrash(entry.id)
  assert.equal(restored.parentId, null); assert.equal(restored.id, child.id)
})

test('历史恢复不会引入父子循环，恢复前版本仍可查看；历史保留最近 50 条', async t => {
  const f = await fixture(t), parent = await f.notes.create(), child = await f.notes.create({ fields: { parentId: parent.id } })
  await f.notes.update(child.id, { parentId: null }, 0)
  const [version] = f.notes.history(child.id)
  await f.notes.update(parent.id, { parentId: child.id }, 0)
  const restored = await f.notes.restoreVersion(child.id, version.id, 1)
  assert.equal(restored.parentId, null)
  for (let i = 0; i < 55; i++) await f.notes.update(child.id, { content: String(i) })
  assert.equal(f.notes.history(child.id).length, 50)
  assert.equal(f.notes.history(child.id)[0].note.content, '53')
})
