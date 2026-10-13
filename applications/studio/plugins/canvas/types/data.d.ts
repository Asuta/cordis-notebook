import type { Context } from 'cordis'
export interface CanvasNode { id: string; type: string; title: string; x: number; y: number; width?: number; height?: number; groupId?: string; [field: string]: unknown }
export interface CanvasBoard { id: string; title: string; revision: number; viewport: { x: number; y: number; zoom: number }; nodes: CanvasNode[]; edges: { id: string; from: string; to: string }[] }
export interface CanvasAsset { id: string; name: string; width: number; height: number; createdAt: number }
export interface CanvasState { version: number; boards: CanvasBoard[]; assets: Record<string, CanvasAsset>; jobs: Record<string, unknown>[]; types?: Omit<CardType, 'validate' | 'resolve' | 'defaults'>[]; providers?: Record<string, unknown>[] }
export interface Registry<T extends { id: string }> {
  register(owner: Context, definition: T): () => unknown
  get(id: string): Readonly<T> | undefined
  require(id: string): Readonly<T>
  list(): Readonly<T>[]
  observe(owner: Context, callback: () => void): () => unknown
}
export interface CardType {
  id: string; label: string; fields: readonly string[]; output?: string; accepts?: readonly string[]
  defaults(): Record<string, unknown>
  validate(node: Readonly<CanvasNode>, assets: Readonly<Record<string, CanvasAsset>>): void
  resolve?(node: Readonly<CanvasNode>): { text?: string; assetId?: string }
}
export type CanvasOperation =
  | { type: 'add'; node: Partial<CanvasNode> & { id: string; type: string } }
  | { type: 'update'; id: string; patch: Record<string, unknown>; unset?: string[] }
  | { type: 'remove'; ids: string[] }
  | { type: 'connect'; id: string; from: string; to: string }
  | { type: 'disconnect'; id: string }
  | { type: 'reorder'; id: string; edges: string[] }
  | { type: 'rename'; title: string }
  | { type: 'viewport'; viewport: CanvasBoard['viewport'] }
  | { type: 'restore'; nodes: CanvasNode[]; edges: CanvasBoard['edges']; nodePositions?: number[]; edgePositions?: number[] }
export type HistoryOperation = CanvasOperation & { expected?: unknown }
export interface EditResult { board: CanvasBoard; inverse: HistoryOperation[] }
