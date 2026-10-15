import type { Context } from 'cordis'
import type { Note, NotePatch } from '@cordis-notebook/notes/data'
import type { Validation } from '@cordis-notebook/host'
export interface NotebookChange {
  readonly reason: 'edit' | 'selection' | 'filters' | 'status' | 'busy'
  readonly selectedId: string | null
  readonly dirty: boolean
  readonly busy: boolean
}
export type NoteFilter = (note: Note) => boolean
export interface FilterRegistration {
  update(predicate: NoteFilter): void
  dispose(): unknown
}
export interface NotebookService {
  readonly notes: readonly Note[]
  readonly selected: string | null
  readonly dirty: boolean
  readonly conflict: boolean
  readonly conflictMessage: string
  readonly busy: boolean
  readonly editable: boolean
  readonly status: string
  current(): Note | undefined
  visible(): Note[]
  /** Immediate first call; later calls carry a change event. Owned by owner. */
  observe(owner: Context, handler: (event?: NotebookChange) => void, options?: { reasons?: readonly NotebookChange['reason'][] }): () => boolean
  registerFilter(owner: Context, key: string, predicate: NoteFilter): FilterRegistration
  choose(id: string): Promise<void>
  reorder(ids: string[]): Promise<void>
  create(type?: string, fields?: NotePatch, options?: {select?: boolean}): Promise<Note | undefined>
  updateNote(id: string, patch: NotePatch, expectedRevision: number): Promise<Note | undefined>
  /** Flush and hold edits while an importer atomically appends new notes. */
  importNotes(action: () => Promise<Note[]>): Promise<Note[] | undefined>
  remove(): Promise<void>
  removeNote(id: string, expectedRevision: number): Promise<{ok: true} | undefined>
  /** Flush and hold editing while restoring a durable note from history or trash. */
  restoreNote(action: (current: Note | undefined) => Promise<Note>): Promise<Note | undefined>
  edit(patch: NotePatch): void
  flush(): Promise<void>
  saveCopy(): Promise<void>
}

import type {} from '@cordis-notebook/host'
declare module '@cordis-notebook/host' { interface ClientServices { notebook: NotebookService } }
declare module 'cordis' { interface Events {
    /** @mode serial */
    'notebook/before-action'(): Validation | Promise<Validation>
    /** @mode parallel */
    'notebook/changed'(event: NotebookChange): void | Promise<void>
    /** Called before create and save; new pages have their proposed stable ID.
     * Return a message or throw to reject. No recursive flush() here.
     * @mode serial
     */
    'notebook/before-save'(note: Note): Validation | Promise<Validation>
    /** @mode parallel */
    'notebook/saved'(note: Note): void | Promise<void>
} }
