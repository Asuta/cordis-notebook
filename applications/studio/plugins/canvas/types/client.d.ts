import type { Context } from 'cordis'
import type { CanvasState, CanvasBoard, CanvasNode, CanvasOperation, EditResult, Registry, CanvasAsset, HistoryOperation } from './data'
import type {} from '@cordis-notebook/host'
export interface CanvasAction { id: string; label: string; schema?: Record<string, unknown>; mutates?: boolean; run(args: Record<string, unknown>): unknown | Promise<unknown> }
export interface CanvasDraft { before: CanvasNode; patch: Record<string, unknown> }
export interface CanvasSession {
  readonly state: CanvasState
  readonly boardId: string
  readonly stopped: boolean
  readonly held: boolean
  editing: boolean
  viewport: CanvasBoard['viewport']
  renderedTitle: string
  readonly titleDraftId: string
  actions: Registry<CanvasAction>
  readonly drafts: Map<string, CanvasDraft>
  undo: Map<string, HistoryOperation[][]>
  redo: Map<string, HistoryOperation[][]>
  draft(node: CanvasNode, key: string, value: unknown): void
  board(): CanvasBoard
  read(): { board: CanvasBoard; boards: { id: string; title: string }[]; assets: CanvasState['assets']; jobs: CanvasState['jobs']; types: NonNullable<CanvasState['types']>; providers: NonNullable<CanvasState['providers']>; actions: Pick<CanvasAction, 'id' | 'label' | 'schema'>[]; dirty: boolean }
  editable(): boolean
  /** Applies locally immediately; defaults to awaiting durable confirmation. */
  edit(operations: CanvasOperation[], options?: { expectedRevision?: number; history?: boolean; targetBoard?: string; repaint?: boolean; waitForSave?: boolean }): Promise<EditResult>
  prepareEdit(): Promise<void>
  historyStep(back: boolean): Promise<EditResult | undefined>
  readonly saveError: string | null
  readonly pendingEdits: number
  retrySave(): Promise<void>
  exportPending(): Record<string, unknown>
  execute(id: string, args?: Record<string, unknown>, source?: 'user' | 'agent'): Promise<unknown>
  flush(): Promise<void>
  refresh(options?: { fresh?: boolean }): Promise<void>
  choose(id: string): Promise<void>
  newBoard(title?: string): Promise<CanvasBoard>
  duplicateBoard(id: string): Promise<CanvasBoard>
  renameBoard(id: string, title: string): Promise<void>
  importImage(input: { path: string }): Promise<CanvasAsset>
  rememberAsset(asset: CanvasAsset): CanvasAsset
  imageUrl(id: string, thumbnail?: boolean): string
  mediaKind(asset?: CanvasAsset): 'image' | 'video'
  mediaUrl(asset: CanvasAsset): string
  uploadMedia(file: File, signal?: AbortSignal, progress?: (percent: number) => void): Promise<CanvasAsset>
  api<T = unknown>(path: string, body?: unknown): Promise<T>
  saveViewport(): Promise<void>
  discardDrafts(): Promise<void>
  attachView(owner: Context, view: { render(): void; dragging(): boolean; status?(message: string): void; choose?(): void; hold?(value: boolean): void; syncRenderedNode?(id: string, patch: Record<string, unknown>): boolean }): () => unknown
}
declare module '@cordis-notebook/host' { interface ClientServices { canvasSession: CanvasSession } }
