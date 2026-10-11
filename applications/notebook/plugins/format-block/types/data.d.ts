import type { OutlineDocument } from '@cordis-notebook/rich-text/data'
export type BlockType = 'paragraph' | 'heading' | 'bullet' | 'number' | 'todo' | 'toggle' | 'quote' | 'callout' | 'code' | 'divider' | 'image' | 'table'
export interface PageBlock {
  readonly id: string
  readonly type: BlockType
  readonly body: OutlineDocument
  readonly checked: boolean
  readonly collapsed: boolean
  readonly children: readonly PageBlock[]
}
export interface BlockDocument { readonly version: 1; readonly blocks: readonly PageBlock[] }
export interface BlockDocumentService {
  normalize(input: unknown): BlockDocument
  create(type?: Exclude<BlockType, 'image'>, text?: string, id?: string): PageBlock
  create(type: 'image', src: string, id?: string): PageBlock
  text(doc: BlockDocument): string
  toEditor(doc: BlockDocument): unknown
  fromEditor(json: unknown): BlockDocument
}
