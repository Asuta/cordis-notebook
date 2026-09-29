import type { Context } from 'cordis'
import type { OutlineDocument, RichDocumentService } from './data'
export interface RichEditor {
  captureSelection(): { from: number; to: number; text: string; document: string; content: OutlineDocument } | null
  replaceSelection(snapshot: { from: number; to: number; document: string }, content: string | OutlineDocument): boolean
  readonly document: OutlineDocument
  readonly composing: boolean
  focus(where?: 'start' | 'end' | number): unknown
  setDocument(doc: OutlineDocument): void
  setEditable(value: boolean): void
  /** Adjust rendering contrast only; the document's stored colors are unchanged. */
  setAppearance(value: { background: string; foreground: string }): void
  exec(command: string, value?: unknown): boolean
  status(): Record<string, unknown>
  destroy(): unknown
}
export interface RichTextService extends RichDocumentService {
  mount(owner: Context, element: HTMLElement, options: {
    document: OutlineDocument; editable?: boolean
    appearance?: { background: string; foreground: string }
    change(doc: OutlineDocument, reason: 'paste' | 'text'): void
    selection?(): void; focus?(): void; blur?(): void; boundary?(): void
    undo?(): void; redo?(): void; selectContainer?(): void; link?(): void
    images?(files: File[]): unknown; error?(error: Error): void
  }): RichEditor
}

import type {} from '@cordis-notebook/host'
declare module '@cordis-notebook/host' { interface ClientServices { richText: RichTextService } }
