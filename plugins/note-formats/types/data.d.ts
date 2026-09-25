import type { Context } from 'cordis'
import type { Note, NotePatch } from '@cordis-notebook/notes/data'
export interface NoteFormat {
  readonly type: string
  readonly label: string
  readonly icon?: string
  readonly editor: string
  readonly editorClass?: string
  readonly fields: readonly string[]
  defaults(): Record<string, unknown>
  normalize(data: Readonly<Record<string, unknown>>): Record<string, unknown>
  toText(data: Readonly<Record<string, unknown>>): string
}
export interface NoteFormats {
  typeOf(note?: { readonly type?: string }): string
  snapshot<T>(value: T): DeepReadonly<T>
  register(owner: Context, format: NoteFormat): () => unknown
  get(type: string): Readonly<NoteFormat> | undefined
  list(): Readonly<NoteFormat>[]
  observe(owner: Context, handler: () => void): () => unknown
  create(type?: string): NotePatch & { type: string }
  update(note: Note, patch: NotePatch): Note
  patch(note: Note): NotePatch
}
export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T
