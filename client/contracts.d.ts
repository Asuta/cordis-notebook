import type { Context } from 'cordis'

export interface Note {
  readonly id: string
  readonly title: string
  readonly content: string
  readonly pinned: boolean
  readonly createdAt: string
  readonly updatedAt: string
}
export type NotePatch = Partial<Pick<Note, 'title' | 'content' | 'pinned'>>
export type Validation = void | string | false | null
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
  readonly status: string
  current(): Note | undefined
  visible(): Note[]
  /** Immediate first call; later calls carry a change event. Owned by owner. */
  observe(owner: Context, handler: (event?: NotebookChange) => void): () => boolean
  registerFilter(owner: Context, key: string, predicate: NoteFilter): FilterRegistration
  choose(id: string): Promise<void>
  create(): Promise<void>
  remove(): Promise<void>
  edit(patch: NotePatch): void
  flush(): Promise<void>
}
export interface StopChange {
  readonly reason: 'disable' | 'reload' | 'switch'
  /** Direct operation targets. All preparation listeners may protect their state. */
  readonly targets: readonly string[]
}
export interface StopRequest extends StopChange {
  /** Register before awaiting work. Runs after success, rejection or failure. */
  hold(release: () => void | Promise<void>): void
}
export interface ClientSDK {
  provide<T extends object>(name: string, value: T): T
  toast(message: string): void
  el<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Record<string, unknown>, text?: string): HTMLElementTagNameMap[K]
}
declare module 'cordis' {
  interface Context {
    notebook: NotebookService
    notesApi: {
      request(path?: string, method?: 'GET'): Promise<Note[]>
      request(path: string, method: 'POST' | 'PATCH', data?: NotePatch): Promise<Note>
      request(path: string, method: 'DELETE'): Promise<unknown>
    }
    shell: { mount(owner: Context, name: string, node: HTMLElement): HTMLElement }
    noteListUI: { mount(owner: Context, name: 'filters', node: HTMLElement): HTMLElement }
  }
  interface Events {
    'notebook/changed'(event: NotebookChange): void | Promise<void>
    /** Return a message or throw to reject. No recursive flush() here. */
    'notebook/before-save'(note: Note): Validation | Promise<Validation>
    'notebook/saved'(note: Note): void | Promise<void>
    'plugins/before-stop'(request: StopRequest): Validation | Promise<Validation>
  }
}
