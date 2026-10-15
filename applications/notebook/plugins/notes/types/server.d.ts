import type { Note, NotePatch } from './data'
export interface NoteHistoryEntry { id: string; note: Note; capturedAt: string; reason: string }
export interface NoteTrashEntry { id: string; note: Note; deletedAt: string }
export interface NotesService {
  history(id: string): NoteHistoryEntry[]
  trash(): NoteTrashEntry[]
  restoreVersion(id: string, versionId: string, revision: number): Promise<Note>
  restoreTrash(entryId: string): Promise<Note>
  purgeTrash(entryId: string): Promise<{ok: true}>
}
export interface NotesService { list(): Note[]; create(input?: {type?:string; fields?:NotePatch; id?:string}): Promise<Note>; update(id:string, patch:NotePatch, expectedRevision?:number): Promise<Note>; remove(id:string, expectedRevision?:number): Promise<{ok:true; reparented?: Note[]}>; reorder(ids:string[]): Promise<Note[]>; importMany(notes: Note[], beforeSave?: (created: Note[]) => Promise<void>): Promise<Note[]> }

import type {} from '@cordis-notebook/host'
declare module '@cordis-notebook/host' { interface ServerServices { notes: NotesService } }
