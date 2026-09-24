/**
 * Public notebook service. Filter storage and save scheduling stay private.
 * @param {import('cordis').Context} ctx
 * @param {import('../contracts').ClientSDK} sdk
 * @param {{storage: Storage, draftKey: string, autosaveMs?: number}} options
 */
export async function createNotebook(ctx, sdk, { storage, draftKey, autosaveMs = 600 }) {
  const filters = new Set()
  let timer, queue = Promise.resolve(), activeAction = Promise.resolve(), revision = 0, stopped = false, holds = 0, actionBusy = false
  const copy = note => note && Object.freeze({ ...note })
  const report = error => sdk.toast(error.message || String(error))
  // Notifications cannot turn a completed disk write into a failed save.
  const publish = (name, value) => { void ctx.parallel(name, value).catch(error => report(new Error('插件通知失败：' + (error.errors?.map(e => e.message).join('；') || error.message)))) }
  const model = sdk.provide('notebook', {
    notes: [], selected: null, dirty: false, status: '✓ 已保存到本地',
    get busy() { return actionBusy || holds > 0 },
    notify(reason = 'status') {
      if (!stopped) publish('notebook/changed', Object.freeze({ reason, selectedId: this.selected, dirty: this.dirty, busy: this.busy }))
    },
    observe(owner, handler) { const dispose = owner.on('notebook/changed', handler); handler(); return dispose },
    current() { return copy(this.notes.find(n => n.id === this.selected)) },
    visible() { return this.notes.map(copy).filter(note => [...filters].every(item => item.predicate(note))).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt)) },
    registerFilter(owner, key, predicate) {
      if (typeof key !== 'string' || !key || typeof predicate !== 'function') throw new TypeError('过滤器需要名称和判断函数')
      if ([...filters].some(item => item.owner === owner && item.key === key)) throw new Error('重复注册过滤器：' + key)
      const item = { owner, key, predicate }
      const dispose = owner.effect(() => {
        filters.add(item); this.notify('filters')
        return () => { filters.delete(item); this.notify('filters') }
      })
      return Object.freeze({
        update: predicate => {
          if (!filters.has(item) || stopped) throw new Error('过滤器已释放：' + key)
          if (typeof predicate !== 'function') throw new TypeError('过滤器需要判断函数')
          item.predicate = predicate; this.notify('filters')
        },
        dispose,
      })
    },
    perform(action) {
      if (this.busy || stopped) return Promise.resolve()
      actionBusy = true; this.notify()
      const task = (async () => {
        try { await this.flush(); if (!stopped) await action() }
        finally { actionBusy = false; this.notify('selection') }
      })()
      activeAction = task.catch(() => {})
      return task
    },
    choose(id) { return this.perform(async () => { this.selected = id; revision++ }) },
    create() { return this.perform(async () => { const note = await ctx.notesApi.request('', 'POST'); if (stopped) return; this.notes.unshift(note); this.selected = note.id; revision++ }) },
    remove() { if (!this.current()) return Promise.resolve(); return this.perform(async () => { const id = this.selected; await ctx.notesApi.request('/' + id, 'DELETE'); if (stopped) return; this.notes = this.notes.filter(n => n.id !== id); this.selected = this.notes[0]?.id || null }) },
    edit(patch) {
      const note = this.notes.find(n => n.id === this.selected); if (!note || stopped || this.busy) return
      for (const key of ['title', 'content', 'pinned']) if (Object.hasOwn(patch, key)) note[key] = patch[key]
      note.updatedAt = new Date().toISOString(); revision++; this.dirty = true; this.status = '正在编辑…'
      try { storage.setItem(draftKey, JSON.stringify(note)) } catch { sdk.toast('浏览器草稿备份不可用，请保持页面打开直到保存完成。') }
      this.notify('edit'); clearTimeout(timer); timer = setTimeout(() => this.flush().catch(report), autosaveMs)
    },
    flush() {
      clearTimeout(timer)
      const task = queue.then(async () => {
        if (stopped || !this.dirty || !this.current()) return
        const note = this.current(), version = revision; this.status = '正在保存…'; this.notify()
        try {
          const rejection = await ctx.serial('notebook/before-save', note)
          if (rejection !== undefined && rejection !== null && rejection !== false) throw new Error(String(rejection))
          if (stopped) return
          const saved = await ctx.notesApi.request('/' + note.id, 'PATCH', { title: note.title, content: note.content, pinned: note.pinned })
          if (stopped) return
          if (version === revision) { Object.assign(this.notes.find(n => n.id === note.id), saved); this.dirty = false; this.status = '✓ 已保存到本地'; try { storage.removeItem(draftKey) } catch {} }
          publish('notebook/saved', copy(saved))
        } catch (error) { this.status = '保存失败 · 草稿已保留，点击重试'; throw error } finally { this.notify() }
      })
      queue = task.catch(() => {})
      return task.then(() => this.dirty && !stopped ? this.flush() : undefined)
    },
  })
  // Register cleanup immediately, including for startup failures and provider loss.
  // Disposal only releases resources: never veto or start a new save here.
  ctx.effect(() => () => { stopped = true; clearTimeout(timer); filters.clear() })
  ctx.on('plugins/before-stop', async request => {
    holds++
    request.hold(() => { holds--; model.notify() })
    model.notify()
    await activeAction
    await model.flush()
  })
  model.notes = await ctx.notesApi.request(''); model.selected = model.notes[0]?.id || null
  try {
    const draft = JSON.parse(storage.getItem(draftKey))
    if (draft?.id) {
      const note = model.notes.find(n => n.id === draft.id)
      if (note) { Object.assign(note, draft); model.selected = note.id; model.dirty = true; model.status = '已恢复未保存草稿，点击状态保存' }
      else if (typeof draft.content === 'string' && typeof draft.title === 'string') { const restored = await ctx.notesApi.request('', 'POST'); Object.assign(restored, { title: draft.title, content: draft.content }); model.notes.unshift(restored); model.selected = restored.id; model.dirty = true; model.status = '已将遗留草稿恢复为新笔记，点击保存' }
    }
  } catch (error) { sdk.toast('草稿恢复失败：' + error.message) }
  return model
}
