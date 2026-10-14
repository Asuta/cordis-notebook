import { Service } from 'cordis'
import { randomUUID } from 'node:crypto'
import { assertHierarchy } from './hierarchy.js'
import { loadArchive, recordVersions } from './archive.js'

const byOrder = (a, b) => Number(b.pinned) - Number(a.pinned) || (a.order ?? -1) - (b.order ?? -1) || b.updatedAt.localeCompare(a.updatedAt)

export class Notes extends Service {
  constructor(ctx) {
    super(ctx, 'notes')
    this.items = []
    this.archive = { history: [], trash: [] }
    this.queue = Promise.resolve()
  }
  async load() {
    const state = loadArchive(await this.ctx.storage.read())
    this.items = state.notes; this.archive = state.archive
    if (!Array.isArray(this.items)) throw new Error('笔记数据格式错误')
    for (const note of this.items) {
      if (note.revision === undefined) note.revision = 0
      if (!Number.isSafeInteger(note.revision) || note.revision < 0) throw new Error('笔记版本无效，原文件已保留')
    }
  }
  list() { return structuredClone(this.items).sort(byOrder) }
  mutate(action) {
    const task = this.queue.then(async () => {
      const next = structuredClone(this.items)
      const archive = structuredClone(this.archive)
      const result = await action(next, archive)
      assertHierarchy(next)
      recordVersions(this.items, next, archive)
      await this.ctx.storage.write({ format: 'cordis-notebook-store', version: 1, notes: next, ...archive })
      this.items = next; this.archive = archive
      return structuredClone(result)
    })
    this.queue = task.catch(() => {})
    return task
  }
  create(input = {}) {
    return this.mutate(items => {
      const now = new Date().toISOString()
      const note = { ...this.ctx.noteFormats.create(input?.type), id: randomUUID(), createdAt: now, updatedAt: now, revision: 0 }
      if (input?.fields !== undefined) Object.assign(note, this.ctx.noteFormats.update(note, input.fields))
      items.push(note)
      return note
    })
  }
  importMany(input, beforeSave = async () => {}) {
    return this.mutate(async items => {
      if (!Array.isArray(input) || !input.length || input.length > 1000) throw Object.assign(Error('一次可恢复 1–1000 篇笔记'), { status: 400 })
      const ids = new Map()
      for (const note of input) {
        if (!note || typeof note.id !== 'string' || !/^[\w:-]{1,100}$/.test(note.id) || ids.has(note.id)) throw Object.assign(Error('备份中的笔记 ID 无效或重复'), { status: 400 })
        ids.set(note.id, randomUUID())
      }
      const now = new Date().toISOString(), created = input.map(original => {
        const type = this.ctx.noteFormats.typeOf(original)
        const restored = this.ctx.noteFormats.remapReferences(original, Object.fromEntries(ids))
        const fields = this.ctx.noteFormats.patch(restored)
        if (original.parentId != null && !ids.has(original.parentId)) throw Object.assign(Error('备份缺少父页面，请备份完整页面树'), { status: 400 })
        fields.parentId = original.parentId == null ? null : ids.get(original.parentId)
        return { ...this.ctx.noteFormats.update(this.ctx.noteFormats.create(type), fields),
          id: ids.get(original.id), createdAt: now, updatedAt: now, revision: 0 }
      })
      assertHierarchy(created)
      // Resources are written only after every note has passed validation. A
      // failed resource write leaves the note collection unchanged.
      await beforeSave(created)
      items.push(...created)
      return structuredClone(created)
    })
  }
  update(id, patch, expectedRevision) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Object.assign(new Error('笔记格式错误'), { status: 400 })
    return this.mutate(items => {
      const note = items.find(item => item.id === id)
      if (!note) throw Object.assign(new Error('笔记不存在'), { status: 404 })
      this.checkRevision(note, expectedRevision)
      Object.assign(note, this.ctx.noteFormats.update(note, patch))
      note.updatedAt = new Date().toISOString()
      note.revision++
      return note
    })
  }
  checkRevision(note, expected) {
    // Omitted only by trusted in-process callers; HTTP always passes a value.
    if (expected !== undefined && (!Number.isSafeInteger(expected) || expected !== note.revision))
      throw Object.assign(new Error('笔记已在其他页面更新，本页修改已保留，请另存为副本'), { status: 409, code: 'NOTE_REVISION_CONFLICT' })
  }
  remove(id, expectedRevision) {
    return this.mutate((items, archive) => {
      const index = items.findIndex(item => item.id === id)
      if (index < 0) throw Object.assign(new Error('笔记不存在'), { status: 404 })
      this.checkRevision(items[index], expectedRevision)
      const removed = items[index], reparented = []
      archive.trash.push({ id: randomUUID(), note: structuredClone(removed), deletedAt: new Date().toISOString() })
      for (const note of items) if (note.parentId === id) {
        note.parentId = removed.parentId ?? null; note.revision++; note.updatedAt = new Date().toISOString()
        reparented.push(structuredClone(note))
      }
      items.splice(index, 1)
      return reparented.length ? { ok: true, reparented } : { ok: true }
    })
  }
  reorder(ids) {
    return this.mutate(items => {
      if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw Object.assign(new Error('排序参数格式错误'), { status: 400 })
      if (new Set(ids).size !== ids.length) throw Object.assign(new Error('排序包含重复笔记'), { status: 400 })
      const index = new Map(items.map(item => [item.id, item]))
      if (ids.length !== items.length || ids.some(id => !index.has(id))) throw Object.assign(new Error('排序必须包含全部笔记'), { status: 400 })
      ids.forEach((id, i) => { index.get(id).order = i })
      return structuredClone(items).sort(byOrder)
    })
  }
  history(id) { return structuredClone(this.archive.history.filter(entry => entry.note.id === id).reverse()) }
  trash() { return structuredClone(this.archive.trash).reverse() }
  restoreVersion(id, versionId, revision) {
    return this.mutate((items, archive) => {
      const current = items.find(note => note.id === id)
      if (!current) throw Object.assign(Error('笔记不存在，请先从回收站恢复'), { status: 404 })
      this.checkRevision(current, revision)
      const entry = archive.history.find(entry => entry.id === versionId && entry.note.id === id)
      if (!entry) throw Object.assign(Error('历史版本已不存在，请刷新列表'), { status: 404 })
      const restored = this.restoreFields(entry.note, items)
      const next = { ...restored, revision: current.revision + 1, updatedAt: new Date().toISOString() }
      items[items.indexOf(current)] = next
      return next
    })
  }
  restoreTrash(entryId) {
    return this.mutate((items, archive) => {
      const index = archive.trash.findIndex(entry => entry.id === entryId)
      if (index < 0) throw Object.assign(Error('回收站记录已不存在'), { status: 404 })
      const original = archive.trash[index].note
      if (items.some(note => note.id === original.id)) throw Object.assign(Error('相同 ID 的笔记已存在'), { status: 409 })
      const note = { ...this.restoreFields(original, items), revision: original.revision + 1, updatedAt: new Date().toISOString() }
      items.push(note); archive.trash.splice(index, 1)
      return note
    })
  }
  restoreFields(original, items) {
    const note = this.ctx.noteFormats.update(original, this.ctx.noteFormats.patch(original))
    // A former parent may now be absent or inside this page's subtree.
    try { assertHierarchy([...items.filter(item => item.id !== note.id), note]) }
    catch { note.parentId = null }
    return note
  }
  purgeTrash(entryId) {
    return this.mutate((items, archive) => {
      const entry = archive.trash.find(entry => entry.id === entryId)
      if (!entry) throw Object.assign(Error('回收站记录已不存在'), { status: 404 })
      archive.trash = archive.trash.filter(item => item !== entry)
      archive.history = archive.history.filter(item => item.note.id !== entry.note.id)
      return { ok: true }
    })
  }
}

export const notes = { inject: ['storage', 'noteFormats'], async apply(ctx) { const service = new Notes(ctx); await service.load(); ctx.effect(() => () => service.queue) } }
