import type { Context } from 'cordis'
import type { Note, NotePatch } from '@cordis-notebook/notes/data'
import type { Validation } from '@cordis-notebook/host'
export interface NotebookChange {
  readonly reason: 'edit' | 'selection' | 'filters' | 'status'
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
  readonly busy: boolean
  readonly editable: boolean
  readonly status: string
  current(): Note | undefined
  visible(): Note[]
  /** Immediate first call; later calls carry a change event. Owned by owner. */
  observe(owner: Context, handler: (event?: NotebookChange) => void): () => boolean
  registerFilter(owner: Context, key: string, predicate: NoteFilter): FilterRegistration
  choose(id: string): Promise<void>
  reorder(ids: string[]): Promise<void>
  create(type?: string): Promise<void>
  remove(): Promise<void>
  edit(patch: NotePatch): void
  flush(): Promise<void>
}

import type {} from '@cordis-notebook/host'
declare module '@cordis-notebook/host' { interface ClientServices { notebook: NotebookService } }
declare module 'cordis' { interface Events {
    /** @mode parallel */
    'notebook/changed'(event: NotebookChange): void | Promise<void>
    /** Return a message or throw to reject. No recursive flush() here.
     * @mode serial
     */
    'notebook/before-save'(note: Note): Validation | Promise<Validation>
    /** @mode parallel */
    'notebook/saved'(note: Note): void | Promise<void>
} }
