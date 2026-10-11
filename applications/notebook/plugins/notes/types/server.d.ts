import type { Note, NotePatch } from './data'
export interface NotesService { list(): Note[]; create(input?: {type?:string; fields?:NotePatch}): Promise<Note>; update(id:string, patch:NotePatch, expectedRevision?:number): Promise<Note>; remove(id:string, expectedRevision?:number): Promise<{ok:true}>; reorder(ids:string[]): Promise<Note[]> }

import type {} from '@cordis-notebook/host'
declare module '@cordis-notebook/host' { interface ServerServices { notes: NotesService } }
