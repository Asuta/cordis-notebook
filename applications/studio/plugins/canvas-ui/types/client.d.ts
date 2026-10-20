import type { Context } from 'cordis'
import type { ClientSDK } from '@cordis-notebook/host'
import type { CanvasNode, CanvasBoard, CanvasState, CanvasOperation, EditResult } from '@cordis-studio/canvas/data'
import type {} from '@cordis-notebook/host'
export interface CardView {
  id: string; label: string; icon: string; input?: boolean; output?: boolean; height?: number
  preserveDOM?: boolean | ((node: CanvasNode) => boolean)
  render(node: CanvasNode, card: HTMLElement, view: CanvasUI): void
  actions?: { label: string; run(node: CanvasNode, view: CanvasUI): unknown }[]
  selectionActions?(nodes: CanvasNode[], view: CanvasUI): SelectionAction[]
  selectionGroup?(node: CanvasNode, view: CanvasUI): CanvasNode[] | null
}
export interface SelectionAction {
  id?: string; label: string; title?: string; disabled?: boolean
  run(nodes: CanvasNode[], view: CanvasUI): unknown
}
export interface ReferencePasteTarget {
  boardId: string; nodeId: string; refKey: string
  valid?(): boolean
  clear?(): void
  apply(assetId: string): Promise<void> | void
}
export interface CanvasUI {
  root: HTMLElement; empty: HTMLElement; side: HTMLElement; stage: HTMLElement; assetsList: HTMLElement; assetPanel: HTMLElement; assetHeader: HTMLElement; assetCount: HTMLElement; assetsTools: HTMLElement; cards: HTMLElement
  el: ClientSDK['el']
  button(label: string, callback: (event?: Event) => unknown, className?: string): HTMLButtonElement
  field(node: CanvasNode, property: string, area?: boolean): HTMLInputElement | HTMLTextAreaElement
  beginEditing(input: HTMLElement): void
  endEditing(input: HTMLElement): void
  register(owner: Context, definition: CardView): () => unknown
  menu(owner: Context, definition: { id: string; label: string; order?: number; className?: string; run(): unknown }): () => unknown
  settings(owner: Context, definition: { id: string; title: string; description?: string; scope?: string; render?(container: HTMLElement): void | (() => void); refresh?(): unknown }): () => unknown
  extend(owner: Context, id: string, extension: { refresh?(): void; card?(node: CanvasNode, card: HTMLElement, view: CanvasUI): void; dispose?(): void }): () => unknown
  render(): void
  board(): CanvasBoard
  boardId(): string
  state(): CanvasState
  add(type: string, fields?: Record<string, unknown>, options?: { fit?: boolean }): Promise<string>
  select(nodeIds: string[]): void
  arrangeNodes(nodeIds: string[], options?: { after?: string; gap?: number }): Promise<void>
  syncRenderedNode(id: string, patch: Record<string, unknown>): boolean
  edit(operations: CanvasOperation[], options?: { expectedRevision?: number; history?: boolean; targetBoard?: string }): Promise<EditResult>
  flush(): Promise<void>
  refresh(): Promise<void>
  execute(id: string, args?: Record<string, unknown>, source?: 'user' | 'agent'): Promise<unknown>
  api<T = unknown>(path: string, body?: unknown): Promise<T>
  imageUrl(id: string, thumbnail?: boolean): string
  openMedia(assetId: string): void
  setPasteTarget(target: ReferencePasteTarget | null): void
  clearPasteTarget(): void
  focusReference(target: ReferencePasteTarget): void
  position(): { x: number; y: number }
  coordinates(event: { clientX: number; clientY: number }): { x: number; y: number }
  safe(callback: (event: any) => unknown): (event?: any) => Promise<void>
}
declare module '@cordis-notebook/host' { interface ClientServices { canvasUI: CanvasUI } }
