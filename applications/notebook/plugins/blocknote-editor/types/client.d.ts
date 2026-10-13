import type { Note } from '@cordis-notebook/notes/data'

export type BlockNoteTransferFormat = 'markdown' | 'html' | 'json'
export interface BlockNoteIO {
  /** Validate a converted native document before passing it to notebook.create/edit. */
  parse(format: BlockNoteTransferFormat, source: string): { version: 1; blocks: Record<string, unknown>[] }
  /** Markdown/HTML are lossy. JSON includes the cordis-note envelope. */
  export(note: Note, format: BlockNoteTransferFormat): string
}
import type {} from '@cordis-notebook/host'
declare module '@cordis-notebook/host' { interface ClientServices { blockNoteIO: BlockNoteIO } }
