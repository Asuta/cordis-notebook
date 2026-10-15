import type { Context } from 'cordis'
import type { Note, NotePatch } from '@cordis-notebook/notes/data'
export interface NoteFormat {
  readonly type: string
  readonly label: string
  readonly icon?: string
  readonly editor: string
  /** Editor shell presentation; omitted or unrecognized values use the standard layout. */
  readonly editorLayout?: 'standard' | 'wide'
  /** Legacy custom hook. Builtin formats use editorLayout instead. */
  readonly editorClass?: string
  /** 格式拥有的源码字段：plain 为 content；markdown 为 markdown；freeform 为 blocks/page/version。 */
  readonly fields: readonly string[]
  defaults(): Record<string, unknown>
  normalize(data: Readonly<Record<string, unknown>>): Record<string, unknown>
  /** 搜索/摘要用的派生纯文本，写入 Note.content；不承诺保留 Markdown 空行或自由页面块结构。 */
  toText(data: Readonly<Record<string, unknown>>): string
  references?(data: Readonly<Record<string, unknown>>): readonly string[]
  remapReferences?(data: Readonly<Record<string, unknown>>, ids: Readonly<Record<string, string>>): Record<string, unknown>
  /** Validate child records and database-scoped templates before an atomic write. */
  validateChildren?(note: Note, children: readonly Pick<Note, 'id' | 'title' | 'type' | 'parentId' | 'properties' | 'template'>[]): void
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
  references(note: Note): string[]
  remapReferences(note: Note, ids: Readonly<Record<string, string>>): Note
  validateCollection(notes: readonly Note[], previous?: readonly Note[]): void
}
export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T
