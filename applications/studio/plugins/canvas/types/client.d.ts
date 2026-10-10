import type { Context } from 'cordis'
import type { CanvasState, CanvasBoard, CanvasOperation, EditResult, Registry, CanvasAsset } from './data'
import type {} from '@cordis-notebook/host'
export interface CanvasAction { id: string; label: string; schema?: Record<string, unknown>; mutates?: boolean; run(args: Record<string, unknown>): unknown | Promise<unknown> }
export interface CanvasSession {
  readonly state: CanvasState
  readonly boardId: string
  readonly stopped: boolean
  readonly held: boolean
  editing: boolean
  viewport: CanvasBoard['viewport']
  actions: Registry<CanvasAction>
  board(): CanvasBoard
  read(): { board: CanvasBoard; boards: { id: string; title: string }[]; assets: CanvasState['assets']; jobs: CanvasState['jobs']; types: NonNullable<CanvasState['types']>; providers: NonNullable<CanvasState['providers']>; actions: Pick<CanvasAction, 'id' | 'label' | 'schema'>[]; dirty: boolean }
  editable(): boolean
  edit(operations: CanvasOperation[], options?: { expectedRevision?: number; history?: boolean; targetBoard?: string }): Promise<EditResult>
  execute(id: string, args?: Record<string, unknown>, source?: 'user' | 'agent'): Promise<unknown>
  flush(): Promise<void>
  refresh(): Promise<void>
  choose(id: string): Promise<void>
  newBoard(title?: string): Promise<CanvasBoard>
  importImage(input: { path: string }): Promise<CanvasAsset>
  rememberAsset(asset: CanvasAsset): CanvasAsset
  imageUrl(id: string, thumbnail?: boolean): string
  api<T = unknown>(path: string, body?: unknown): Promise<T>
  attachView(owner: Context, view: { render(): void; dragging(): boolean; status?(message: string): void; choose?(): void; hold?(value: boolean): void }): () => unknown
}
declare module '@cordis-notebook/host' { interface ClientServices { canvasSession: CanvasSession } }
