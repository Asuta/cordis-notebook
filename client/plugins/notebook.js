export const inject = ['shell']
export default async function (ctx, sdk) {
  let tabId = sessionStorage.getItem('cordis-tab-id')
  if (!tabId) { tabId = crypto.randomUUID(); sessionStorage.setItem('cordis-tab-id', tabId) }
  const events = new EventTarget(), draftKey = 'cordis-notebook-draft-v2-' + tabId
  let timer, queue = Promise.resolve(), revision = 0, stopped = false
  const model = { notes: await sdk.request('/api/notes'), selected: null, dirty: false, status: '✓ 已保存到本地', filters: new Map(), busy: false,
    addEventListener: (...args) => events.addEventListener(...args), removeEventListener: (...args) => events.removeEventListener(...args),
    notify() { events.dispatchEvent(new Event('change')) }, current() { return this.notes.find(n => n.id === this.selected) },
    visible() { return this.notes.filter(note => [...this.filters.values()].every(fn => fn(note))).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt)) },
    async perform(action) { if (this.busy) return; this.busy = true; this.notify(); try { await this.flush(); await action() } finally { this.busy = false; this.notify() } },
    async choose(id) { return this.perform(async () => { this.selected = id; revision++ }) },
    async create() { return this.perform(async () => { const note = await sdk.request('/api/notes', 'POST'); this.notes.unshift(note); this.selected = note.id; revision++ }) },
    async remove() { if (!this.current()) return; return this.perform(async () => { const id = this.selected; await sdk.request('/api/notes/' + id, 'DELETE'); this.notes = this.notes.filter(n => n.id !== id); this.selected = this.notes[0]?.id || null }) },
    edit(patch) {
      const note = this.current(); if (!note || stopped || this.busy) return
      Object.assign(note, patch, { updatedAt: new Date().toISOString() }); revision++; this.dirty = true; this.status = '正在编辑…'
      try { localStorage.setItem(draftKey, JSON.stringify(note)) } catch { sdk.toast('浏览器草稿备份不可用，请保持页面打开直到保存完成。') }
      this.notify(); clearTimeout(timer); timer = setTimeout(() => this.flush().catch(error => sdk.toast(error.message)), 600)
    },
    flush() {
      clearTimeout(timer)
      const task = queue.then(async () => {
        if (!this.dirty || !this.current()) return
        const note = { ...this.current() }, version = revision; this.status = '正在保存…'; this.notify()
        try {
          const saved = await sdk.request('/api/notes/' + note.id, 'PATCH', { title: note.title, content: note.content, pinned: note.pinned })
          if (version === revision) { Object.assign(this.current(), saved); this.dirty = false; this.status = '✓ 已保存到本地'; try { localStorage.removeItem(draftKey) } catch {} }
        } catch (error) { this.status = '保存失败 · 草稿已保留，点击重试'; throw error } finally { this.notify() }
      }); queue = task.catch(() => {}); return task.then(() => this.dirty ? this.flush() : undefined)
    },
  }
  model.selected = model.notes[0]?.id || null
  try { const draft = JSON.parse(localStorage.getItem(draftKey)); if (draft?.id) {
    const note = model.notes.find(n => n.id === draft.id)
    if (note) { Object.assign(note, draft); model.selected = note.id; model.dirty = true; model.status = '已恢复未保存草稿，点击状态保存' }
    else if (typeof draft.content === 'string' && typeof draft.title === 'string') { const restored = await sdk.request('/api/notes', 'POST'); Object.assign(restored, { title: draft.title, content: draft.content }); model.notes.unshift(restored); model.selected = restored.id; model.dirty = true; model.status = '已将遗留草稿恢复为新笔记，点击保存' }
  } } catch (error) { sdk.toast('草稿恢复失败：' + error.message) }
  const service = sdk.provide('notebook', model), status = sdk.el('button', { class: 'save-status' }); sdk.mount('status', status)
  sdk.watch(service, () => { status.textContent = service.status }); sdk.listen(status, 'click', () => service.flush().catch(error => sdk.toast(error.message)))
  sdk.guard(async () => { service.busy = true; service.notify(); try { await service.flush() } finally { service.busy = false; service.notify() } })
  sdk.listen(window, 'beforeunload', event => { if (service.dirty) { event.preventDefault(); event.returnValue = '' } })
  sdk.listen(document, 'keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 's') { event.preventDefault(); service.flush().catch(error => sdk.toast(error.message)) } })
  sdk.effect(() => () => { stopped = true; clearTimeout(timer) })
}
