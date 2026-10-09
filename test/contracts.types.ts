import type { ClientContext } from '@cordis-notebook/host'
import type {} from '@cordis-notebook/markdown/client'
import type {} from '@cordis-notebook/note-formats/client'
import type {} from '@cordis-notebook/theme-engine/client'
import type { Note } from '@cordis-notebook/notes/data'
import type { NotebookService } from '@cordis-notebook/notebook/client'
import type { ClientSDK, ConfigSchema } from '@cordis-notebook/host'

declare const ctx: ClientContext
const html: string = ctx.markdown.render('# 标题')
const plain: string = ctx.markdown.toText(html)
const kind: string = ctx.noteFormats.typeOf()
const snapshot = ctx.noteFormats.snapshot({ nested: { text: plain }, kind })
// @ts-expect-error Snapshots are deeply read-only.
snapshot.nested.text = 'changed'
// @ts-expect-error Markdown accepts source strings only.
ctx.markdown.render({ source: '' })
ctx.themeEngine.apply(ctx, { id: 'sample', name: '示例', colors: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] })
ctx.themeEngine.apply(ctx, { id: 'named', name: '命名配色', colors: { background: '#000000', surface: '#111111', panel: '#222222', text: '#ffffff', muted: '#cccccc', border: '#333333', accent: '#eeeeee', selected: '#333333', onAccent: '#000000' } })
// @ts-expect-error Named palettes require the foreground on accent backgrounds.
ctx.themeEngine.apply(ctx, { id: 'invalid', name: '缺少按钮文字', colors: { background: '#000000', surface: '#111111', panel: '#222222', text: '#ffffff', muted: '#cccccc', border: '#333333', accent: '#eeeeee', selected: '#333333' } })
// @ts-expect-error Theme palettes must supply all eight colors.
ctx.themeEngine.apply(ctx, { id: 'sample', name: '示例', colors: ['red'] })
const notebook: NotebookService = ctx.notebook
const editable: boolean = notebook.editable
// @ts-expect-error Editability is a read-only service property.
notebook.editable = editable
ctx.on('notebook/changed', change => {
  // @ts-expect-error Read editability from the service, not the change event.
  console.log(change.editable)
})
ctx.parallel('notebook/changed', { reason: 'status', selectedId: null, dirty: false, busy: false })
const filter = notebook.registerFilter(ctx, 'sample', note => note.pinned)
filter.update(note => note.title.includes('hello'))
notebook.observe(ctx, change => { if (change) console.log(change.reason) })
ctx.on('notebook/before-save', async note => note.title ? undefined : '请填写标题')
ctx.on('notebook/saved', note => { console.log(note.content) })
ctx.on('plugins/before-stop', request => { request.hold(() => {}); console.log(request.targets) })
declare const saved: Note
ctx.parallel('notebook/saved', saved)
// @ts-expect-error Saved snapshots cannot be mutated.
saved.content = 'changed'
// @ts-expect-error Filter storage is not a public service API.
notebook.filters.set('sample', () => true)
// @ts-expect-error Invalid business event payload.
ctx.parallel('notebook/saved', { title: 'missing fields' })
// @ts-expect-error Filter callbacks must return a boolean.
filter.update(note => note.title)
// @ts-expect-error Validation returns a message, not an arbitrary object.
ctx.on('notebook/before-save', () => ({ error: 'wrong' }))

declare const sdk: ClientSDK
const settings: ConfigSchema = { mode: 'live', fields: { length: { type: 'number', label: '长度', default: 120, min: 1 } } }
sdk.onConfig((config, signal) => { if (!signal.aborted) console.log(config.length, settings.mode) })
// @ts-expect-error Configuration is immutable; changes must use the manager.
sdk.config.length = 200
// @ts-expect-error Only declared application modes are supported.
const invalid: ConfigSchema = { mode: 'silently-replace', fields: {} }
