import { Service } from 'cordis'
import { randomUUID } from 'node:crypto'

const byOrder = (a, b) => Number(b.pinned) - Number(a.pinned) || (a.order ?? -1) - (b.order ?? -1) || b.updatedAt.localeCompare(a.updatedAt)

export class Notes extends Service {
  constructor(ctx) {
    super(ctx, 'notes')
    this.items = []
    this.queue = Promise.resolve()
  }
  async load() {
    this.items = await this.ctx.storage.read()
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
      const result = action(next)
      await this.ctx.storage.write(next)
      this.items = next
      return result
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
    return this.mutate(items => {
      const index = items.findIndex(item => item.id === id)
      if (index < 0) throw Object.assign(new Error('笔记不存在'), { status: 404 })
      this.checkRevision(items[index], expectedRevision)
      items.splice(index, 1)
      return { ok: true }
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
}

export const notes = { inject: ['storage', 'noteFormats'], async apply(ctx) { const service = new Notes(ctx); await service.load(); ctx.effect(() => () => service.queue) } }
