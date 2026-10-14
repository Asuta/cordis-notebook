import { validateHierarchy } from './hierarchy.js'

/**
 * Public notebook service. Filter storage and save scheduling stay private.
 * @param {import('cordis').Context} ctx
 * @param {import('@cordis-notebook/host').ClientSDK} sdk
 * @param {{storage: Storage, draftKey: string, autosaveMs?: number}} options
 */
export async function createNotebook(ctx, sdk, { storage, draftKey, autosaveMs = 600 }) {
  const filters = new Set()
  let draft, restoring = false, hierarchyConflict = false
  let timer, queue = Promise.resolve(), activeAction = Promise.resolve(), revision = 0, stopped = false, holds = 0, actionBusy = false
  const snapshots = new WeakMap()
  let listVersion = 0, visibleVersion = -1, visibleNotes = [], visibleSource
  const invalidate = note => { if (note) snapshots.delete(note); listVersion++ }
  const copy = note => {
    if (!note) return undefined
    if (!snapshots.has(note)) snapshots.set(note, ctx.noteFormats.snapshot(note))
    return snapshots.get(note)
  }
  const report = error => sdk.toast(error.message || String(error))
  // Browser-only recovery metadata is never included in the note API patch.
  const draftJSON = note => JSON.stringify({ ...note, ...(hierarchyConflict ? { __hierarchyConflict: true } : {}) })
  // Notifications cannot turn a completed disk write into a failed save.
  const publish = (name, value) => { void ctx.parallel(name, value).catch(error => report(new Error('插件通知失败：' + (error.errors?.map(e => e.message).join('；') || error.message)))) }
  const model = sdk.provide('notebook', {
    notes: [], selected: null, dirty: false, conflict: false, status: '✓ 已保存到本地',
    get conflictMessage() { return hierarchyConflict ? '草稿的父页面关系已失效。正文已保留，可以另存为顶层副本。' : '这篇笔记已在其他页面更新。本页修改已保留，可以另存为副本。' },
    get busy() { return actionBusy || holds > 0 },
    get editable() { return !draft?.id && !!ctx.noteFormats.get(ctx.noteFormats.typeOf(this.current())) },
    notify(reason = 'status') {
      if (reason === 'filters') listVersion++
      if (!stopped) publish('notebook/changed', Object.freeze({ reason, selectedId: this.selected, dirty: this.dirty, busy: this.busy }))
    },
    observe(owner, handler, options = {}) {
      const dispose = owner.on('notebook/changed', event => { if (!options.reasons || options.reasons.includes(event.reason)) return handler(event) })
      handler(); return dispose
    },
    current() { return copy(this.notes.find(n => n.id === this.selected)) },
    visible() {
      if (visibleVersion !== listVersion || visibleSource !== this.notes) {
        visibleNotes = this.notes.map(copy).filter(note => [...filters].every(item => item.predicate(note))).sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.order ?? -1) - (b.order ?? -1) || b.updatedAt.localeCompare(a.updatedAt))
        visibleVersion = listVersion; visibleSource = this.notes
      }
      return [...visibleNotes]
    },
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
      actionBusy = true; this.notify('busy')
      const task = (async () => {
        try {
          const rejection = await ctx.serial('notebook/before-action')
          if (rejection !== undefined && rejection !== null && rejection !== false) throw Error(String(rejection))
          await this.flush(); if (!stopped) return await action()
        }
        finally { actionBusy = false; await retryDraft(); this.notify('selection') }
      })()
      activeAction = task.catch(() => {})
      return task
    },
    choose(id) { return this.perform(async () => { this.selected = id; revision++ }) },
    reorder(ids) { return this.perform(async () => { const notes = await ctx.notesApi.request('/order', 'PUT', { ids }); if (stopped) return; this.notes = notes }) },
    create(type = 'plain', fields = {}, { select = true } = {}) { return this.perform(async () => { const note = await ctx.notesApi.request('', 'POST', { type, fields }); if (stopped) return; this.notes.unshift(note); invalidate(); if (select) this.selected = note.id; revision++; return copy(note) }) },
    updateNote(id, patch, expectedRevision) { return this.perform(async () => {
      const original = this.notes.find(note => note.id === id)
      if (!original || original.revision !== expectedRevision) throw Error('页面或版本已变化，请刷新后重试')
      const next = ctx.noteFormats.update(original, patch)
      const rejection = await ctx.serial('notebook/before-save', ctx.noteFormats.snapshot(next))
      if (rejection !== undefined && rejection !== null && rejection !== false) throw Error(String(rejection))
      if (stopped) return
      const saved = await ctx.notesApi.request('/' + id, 'PATCH', { ...patch, revision: expectedRevision })
      if (stopped) return saved
      this.notes = this.notes.map(note => note.id === id ? saved : note); invalidate(); revision++
      publish('notebook/saved', copy(saved)); return copy(saved)
    }) },
    importNotes(action) { return this.perform(async () => {
      const created = await action()
      if (stopped) return created
      this.notes = [...created, ...this.notes]; invalidate(); this.selected = created[0]?.id || this.selected; revision++
      return created.map(copy)
    }) },
    restoreNote(action) { return this.perform(async () => {
      const restored = await action(this.current())
      if (stopped) return restored
      this.notes = [restored, ...this.notes.filter(note => note.id !== restored.id)]
      invalidate(); this.selected = restored.id; revision++
      this.status = '✓ 已恢复并保存，原有版本保留在历史记录中'
      return copy(restored)
    }) },
    remove() { if (!this.current()) return Promise.resolve(); return this.perform(async () => { const note = this.current(); const result = await ctx.notesApi.request('/' + note.id, 'DELETE', { revision: note.revision ?? 0 }); if (stopped) return; const reparented = new Map((result.reparented || []).map(note => [note.id, note])); this.notes = this.notes.filter(n => n.id !== note.id).map(n => reparented.get(n.id) || n); this.selected = this.notes[0]?.id || null }) },
    saveCopy() {
      if (this.busy || stopped || !this.current()) return Promise.resolve()
      clearTimeout(timer); actionBusy = true; this.notify('busy')
      const task = (async () => { try {
        await queue
        const original = this.current(), patch = ctx.noteFormats.patch(original)
        // Recovery copies start at the root: another tab may have deleted the
        // draft's old parent, which must not prevent rescuing its content.
        const saved = await ctx.notesApi.request('', 'POST', { type: ctx.noteFormats.typeOf(original), fields: { ...patch, ...(patch.parentId != null ? { parentId: null } : {}), title: (original.title || '无标题笔记').slice(0, 190) + '（副本）' } })
        if (stopped) return
        this.notes = [saved, ...this.notes]; this.selected = saved.id; revision++
        this.dirty = false; this.conflict = false; hierarchyConflict = false; this.status = '✓ 已保存副本，原笔记的新版本仍保留'
        try { storage.removeItem(draftKey) } catch { report(Error('副本已保存，浏览器草稿清理失败')) }
        // Refresh the original too; a read failure must not undo the durable copy.
        try { this.notes = await ctx.notesApi.request('') } catch { report(Error('副本已保存，列表刷新失败，请稍后刷新页面')) }
      } finally { actionBusy = false; this.notify('selection') } })()
      activeAction = task.catch(() => {})
      return task
    },
    edit(patch) {
      const note = this.notes.find(n => n.id === this.selected); if (!note || stopped || this.busy) return
      if (draft?.id) throw new Error('未恢复草稿已保留，请先启用对应格式插件再编辑')
      if (Object.hasOwn(patch, 'parentId')) validateHierarchy(this.notes, { ...note, parentId: patch.parentId })
      Object.assign(note, ctx.noteFormats.update(note, patch))
      note.updatedAt = new Date().toISOString(); revision++; this.dirty = true; this.status = '正在编辑…'
      invalidate(note)
      try { storage.setItem(draftKey, draftJSON(note)) } catch { sdk.toast('浏览器草稿备份不可用，请保持页面打开直到保存完成。') }
      this.notify('edit'); clearTimeout(timer); if (!this.conflict) timer = setTimeout(() => this.flush().catch(report), autosaveMs)
    },
    flush() {
      clearTimeout(timer)
      const task = queue.then(async () => {
        if (stopped || !this.dirty || !this.current()) return
        if (this.conflict) throw Object.assign(Error('笔记版本冲突，请先另存为副本'), { status: 409, code: 'NOTE_REVISION_CONFLICT' })
        const note = this.current(), version = revision; this.status = '正在保存…'; this.notify()
        try {
          const rejection = await ctx.serial('notebook/before-save', note)
          if (rejection !== undefined && rejection !== null && rejection !== false) throw new Error(String(rejection))
          if (stopped) return
          const saved = await ctx.notesApi.request('/' + note.id, 'PATCH', { ...ctx.noteFormats.patch(note), revision: note.revision ?? 0 })
          if (stopped) return
          const current = this.notes.find(n => n.id === note.id)
          // A newer local draft is now based on our successful write, not its old revision.
          if (current) { current.revision = saved.revision ?? current.revision ?? 0; invalidate(current) }
          if (version === revision) { Object.assign(current, saved); this.dirty = false; this.status = '✓ 已保存到本地'; try { storage.removeItem(draftKey) } catch {} }
          else if (current) { try { storage.setItem(draftKey, draftJSON(current)) } catch {} }
          publish('notebook/saved', copy(saved))
        } catch (error) { this.conflict = error.status === 409 && error.code === 'NOTE_REVISION_CONFLICT'; this.status = this.conflict ? '版本冲突 · 本页修改已保留，请另存为副本' : '保存失败 · 草稿已保留，点击重试'; throw error } finally { this.notify() }
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
    request.hold(() => { holds--; model.notify('busy'); return retryDraft() })
    model.notify('busy')
    await activeAction
    await model.flush()
  })
  model.notes = await ctx.notesApi.request(''); model.selected = model.notes[0]?.id || null
  try { draft = JSON.parse(storage.getItem(draftKey)) } catch (error) { sdk.toast('草稿恢复失败：' + error.message) }
  function retryDraft() {
    if (!stopped && !model.busy && draft?.id) return activeAction = restoreDraft().catch(report)
  }
  async function restoreDraft() {
    if (!draft?.id || restoring || stopped || model.busy || model.dirty || !ctx.noteFormats.get(ctx.noteFormats.typeOf(draft))) return
    restoring = true; holds++; model.notify('busy')
    try {
      const patch = ctx.noteFormats.patch(draft)
      let note = model.notes.find(note => note.id === draft.id)
      if (note && ctx.noteFormats.typeOf(note) !== ctx.noteFormats.typeOf(draft)) throw new Error('草稿与笔记格式不一致')
      // Validate before any orphan-note creation or mutation.
      const restored = ctx.noteFormats.update(draft, patch)
      hierarchyConflict = draft.__hierarchyConflict === true
      try { validateHierarchy(model.notes, { ...note, ...restored }) }
      catch {
        // Keep the draft body visible without inserting an invalid parent edge.
        // Preserve the original browser draft until a recovery copy is durable.
        hierarchyConflict = true
        restored.parentId = note?.parentId ?? null
        validateHierarchy(model.notes, { ...note, ...restored })
      }
      if (!note) {
        note = await ctx.notesApi.request('', 'POST', { type: ctx.noteFormats.typeOf(draft) })
        if (stopped) return
        model.notes.unshift(note)
      }
      const expected = draft.revision ?? 0
      model.conflict = hierarchyConflict || !!model.notes.find(n => n.id === draft.id) && expected !== (note.revision ?? 0)
      Object.assign(note, ctx.noteFormats.patch(restored), { content: restored.content, revision: model.conflict ? expected : note.revision ?? 0 })
      invalidate(note)
      model.selected = note.id; model.dirty = true; revision++
      model.status = hierarchyConflict ? '草稿层级已变化 · 正文已保留，请另存为副本' : model.conflict ? '草稿与已保存版本冲突，请另存为副本' : '已恢复未保存草稿，点击状态保存'; draft = null
    } catch (error) { sdk.toast('草稿恢复失败：' + error.message) }
    finally { restoring = false; holds--; model.notify('selection') }
  }
  await restoreDraft()
  ctx.noteFormats.observe(ctx, () => {
    if (draft?.id && !ctx.noteFormats.get(ctx.noteFormats.typeOf(draft))) model.status = '未恢复草稿已保留，请启用格式：' + ctx.noteFormats.typeOf(draft)
    model.notify()
    retryDraft()
  })
  return model
}
