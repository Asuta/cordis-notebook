import type { Context } from 'cordis'
import type { ClientSDK } from '@cordis-notebook/host'
import type { CanvasNode, CanvasBoard, CanvasState, CanvasOperation, EditResult } from '@cordis-studio/canvas/data'
import type {} from '@cordis-notebook/host'
export interface CardView {
  id: string; label: string; icon: string; input?: boolean; output?: boolean; height?: number
  render(node: CanvasNode, card: HTMLElement, view: CanvasUI): void
  actions?: { label: string; run(node: CanvasNode, view: CanvasUI): unknown }[]
}
export interface CanvasUI {
  root: HTMLElement; empty: HTMLElement; side: HTMLElement; stage: HTMLElement; assetsList: HTMLElement; cards: HTMLElement
  el: ClientSDK['el']
  button(label: string, callback: (event?: Event) => unknown, className?: string): HTMLButtonElement
  field(node: CanvasNode, property: string, area?: boolean): HTMLInputElement | HTMLTextAreaElement
  register(owner: Context, definition: CardView): () => unknown
  menu(owner: Context, definition: { id: string; label: string; order?: number; className?: string; run(): unknown }): () => unknown
  extend(owner: Context, id: string, extension: { refresh?(): void; dispose?(): void }): () => unknown
  render(): void
  board(): CanvasBoard
  boardId(): string
  state(): CanvasState
  add(type: string, fields?: Record<string, unknown>): Promise<string>
  edit(operations: CanvasOperation[], options?: { expectedRevision?: number; history?: boolean; targetBoard?: string }): Promise<EditResult>
  flush(): Promise<void>
  refresh(): Promise<void>
  execute(id: string, args?: Record<string, unknown>, source?: 'user' | 'agent'): Promise<unknown>
  api<T = unknown>(path: string, body?: unknown): Promise<T>
  imageUrl(id: string, thumbnail?: boolean): string
  position(): { x: number; y: number }
  coordinates(event: { clientX: number; clientY: number }): { x: number; y: number }
  safe(callback: (event: any) => unknown): (event?: any) => Promise<void>
}
declare module '@cordis-notebook/host' { interface ClientServices { canvasUI: CanvasUI } }
