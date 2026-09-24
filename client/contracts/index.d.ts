import type { Context } from 'cordis'

export interface TextBlock {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly text: string
}
export interface Note {
  readonly type?: string
  readonly [field: string]: unknown
  readonly blocks?: readonly TextBlock[]
  readonly id: string
  readonly title: string
  readonly content: string
  readonly pinned: boolean
  readonly createdAt: string
  readonly updatedAt: string
}
export type NotePatch = Partial<Pick<Note, 'title' | 'content' | 'pinned' | 'blocks'>> & Record<string, unknown>
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
  register(owner: Context, format: NoteFormat): () => unknown
  get(type: string): Readonly<NoteFormat> | undefined
  list(): Readonly<NoteFormat>[]
  observe(owner: Context, handler: () => void): () => unknown
  create(type?: string): NotePatch & { type: string }
  update(note: Note, patch: NotePatch): Note
  patch(note: Note): NotePatch
}
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
  readonly editable: boolean
  readonly status: string
  current(): Note | undefined
  visible(): Note[]
  /** Immediate first call; later calls carry a change event. Owned by owner. */
  observe(owner: Context, handler: (event?: NotebookChange) => void): () => boolean
  registerFilter(owner: Context, key: string, predicate: NoteFilter): FilterRegistration
  choose(id: string): Promise<void>
  create(type?: string): Promise<void>
  remove(): Promise<void>
  edit(patch: NotePatch): void
  flush(): Promise<void>
}
export interface StopChange {
  readonly reason: 'disable' | 'reload' | 'switch' | 'configure'
  /** Direct operation targets. All preparation listeners may protect their state. */
  readonly targets: readonly string[]
}
export interface StopRequest extends StopChange {
  /** Register before awaiting work. Runs after success, rejection or failure. */
  hold(release: () => void | Promise<void>): void
}
export interface ClientSDK {
  /** Aborted on startup timeout or activation disposal. */
  readonly signal: AbortSignal
  readonly config: Readonly<Record<string, string | number | boolean>>
  onConfig(callback: (config: Readonly<Record<string, string | number | boolean>>, signal: AbortSignal) => void | Promise<void>): () => unknown
  provide<T extends object>(name: string, value: T): T
  toast(message: string): void
  el<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Record<string, unknown>, text?: string): HTMLElementTagNameMap[K]
}
export interface ConfigField {
  type: 'string' | 'number' | 'boolean'
  label: string
  description?: string
  default: string | number | boolean
  min?: number
  max?: number
  step?: number
  integer?: boolean
  maxLength?: number
  options?: readonly { label: string; value: string | number | boolean }[]
}
export interface ConfigSchema { mode: 'live' | 'restart'; fields: Record<string, ConfigField> }
declare module 'cordis' {
  interface Context {
    notebook: NotebookService
    noteFormats: NoteFormats
    notesApi: {
      request(path?: string, method?: 'GET'): Promise<Note[]>
      request(path: string, method: 'POST', data?: { type?: string }): Promise<Note>
      request(path: string, method: 'PATCH', data?: NotePatch): Promise<Note>
      request(path: string, method: 'DELETE'): Promise<unknown>
    }
    shell: { mount(owner: Context, name: string, node: HTMLElement): HTMLElement }
    noteListUI: { mount(owner: Context, name: 'filters', node: HTMLElement): HTMLElement }
    editorHost: { register(owner: Context, type: string, node: HTMLElement): () => unknown }
  }
  interface Events {
    /** @mode parallel */
    'notebook/changed'(event: NotebookChange): void | Promise<void>
    /** Return a message or throw to reject. No recursive flush() here.
     * @mode serial
     */
    'notebook/before-save'(note: Note): Validation | Promise<Validation>
    /** @mode parallel */
    'notebook/saved'(note: Note): void | Promise<void>
    /** @mode serial */
    'plugins/before-stop'(request: StopRequest): Validation | Promise<Validation>
  }
}
