import { Service } from 'cordis'
import { randomUUID } from 'node:crypto'

export class Notes extends Service {
  constructor(ctx) {
    super(ctx, 'notes')
    this.items = []
    this.queue = Promise.resolve()
  }
  async load() {
    this.items = await this.ctx.storage.read()
    if (!Array.isArray(this.items)) throw new Error('笔记数据格式错误')
  }
  list() { return structuredClone(this.items).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt)) }
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
  create() {
    return this.mutate(items => {
      const now = new Date().toISOString()
      const note = { id: randomUUID(), title: '', content: '', pinned: false, createdAt: now, updatedAt: now }
      items.push(note)
      return note
    })
  }
  update(id, patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Object.assign(new Error('笔记格式错误'), { status: 400 })
    return this.mutate(items => {
      const note = items.find(item => item.id === id)
      if (!note) throw Object.assign(new Error('笔记不存在'), { status: 404 })
      for (const key of ['title', 'content']) {
        if (key in patch) {
          if (typeof patch[key] !== 'string' || patch[key].length > (key === 'title' ? 200 : 200000)) throw Object.assign(new Error('笔记内容过长或格式错误'), { status: 400 })
          note[key] = patch[key]
        }
      }
      if ('pinned' in patch) {
        if (typeof patch.pinned !== 'boolean') throw Object.assign(new Error('置顶格式错误'), { status: 400 })
        note.pinned = patch.pinned
      }
      note.updatedAt = new Date().toISOString()
      return note
    })
  }
  remove(id) {
    return this.mutate(items => {
      const index = items.findIndex(item => item.id === id)
      if (index < 0) throw Object.assign(new Error('笔记不存在'), { status: 404 })
      items.splice(index, 1)
      return { ok: true }
    })
  }
}
