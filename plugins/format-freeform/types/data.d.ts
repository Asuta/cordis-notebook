import type { OutlineDocument } from '@cordis-notebook/rich-text/data'
import type { Note } from '@cordis-notebook/notes/data'
export interface TextBlock {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly text: string
  readonly outline?: OutlineDocument
}
export interface FreeformNote extends Note { readonly type: "freeform"; readonly blocks: readonly TextBlock[] }
