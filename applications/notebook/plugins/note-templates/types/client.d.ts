import type { Note } from '@cordis-notebook/notes/data'
export interface NoteTemplates {
  list(databaseId?: string): { id: string; title: string; type?: string; revision: number; databaseId: string | null }[]
  save(input: { sourceId: string; revision: number; name: string; databaseId?: string | null }): Promise<Note | undefined>
  apply(input: { templateId: string; revision: number; title?: string; parentId?: string | null; select?: boolean }): Promise<Note | undefined>
  remove(input: { templateId: string; revision: number }): Promise<{ok: true} | undefined>
  open(): void
}
import type {} from '@cordis-notebook/host'
declare module '@cordis-notebook/host' { interface ClientServices { noteTemplates: NoteTemplates } }
