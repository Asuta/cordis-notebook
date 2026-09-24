import { Context } from 'cordis'
import type { Note, NotebookService, ClientSDK, ConfigSchema } from '../client/contracts'

declare const ctx: Context
const notebook: NotebookService = ctx.notebook
const filter = notebook.registerFilter(ctx, 'sample', note => note.pinned)
filter.update(note => note.title.includes('hello'))
notebook.observe(ctx, change => { if (change) console.log(change.reason) })
ctx.on('notebook/before-save', async note => note.title ? undefined : '请填写标题')
ctx.on('notebook/saved', note => { console.log(note.content) })
ctx.on('plugins/before-stop', request => { request.hold(() => {}); console.log(request.targets) })
declare const saved: Note
ctx.emit('notebook/saved', saved)
// @ts-expect-error Saved snapshots cannot be mutated.
saved.content = 'changed'
// @ts-expect-error Filter storage is not a public service API.
notebook.filters.set('sample', () => true)
// @ts-expect-error Invalid business event payload.
ctx.emit('notebook/saved', { title: 'missing fields' })
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
