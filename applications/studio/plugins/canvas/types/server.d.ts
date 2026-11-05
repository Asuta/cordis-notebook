import type { Context } from 'cordis'
import type { Registry, CardType, CanvasState, CanvasBoard, CanvasAsset, CanvasOperation, EditResult } from './data'
import type {} from '@cordis-notebook/host'
export interface RecordTransaction<T> {
  records: T[]
  board(id: string): CanvasBoard | undefined
  edit(id: string, operations: CanvasOperation[]): void
}
export interface CanvasDocuments {
  types: Registry<CardType>
  snapshots: Registry<{ id: string; read(): Record<string, unknown>; revision?(): unknown }>
  read(): CanvasState
  edit(boardId: string, revision: number, operations: CanvasOperation[]): Promise<EditResult>
  addBoard(title: string): Promise<CanvasBoard>
  addImage(bytes: Buffer, name?: string): Promise<CanvasAsset>
  addVideo(bytes: Buffer, name?: string): Promise<CanvasAsset>
  media(id: string): Promise<Buffer>
  image(id: string, thumbnail?: boolean): Promise<Buffer>
  /** Callback is synchronous; network and image decoding must happen outside the transaction. */
  records<T extends object = Record<string, unknown>>(namespace: string): { read(): T[]; change<R>(callback: (transaction: RecordTransaction<T>) => R extends PromiseLike<unknown> ? never : R): Promise<R> }
  observe(owner: Context, callback: (board: CanvasBoard) => void | Promise<void>): () => unknown
  /** Server-only, one-time compatibility bridge. Never send this result to the client. */
  legacyPixelConfig(): Promise<{ baseUrl: string; model: string; apiKey: string } | null>
}
declare module '@cordis-notebook/host' { interface ServerServices { canvasDocuments: CanvasDocuments } }
