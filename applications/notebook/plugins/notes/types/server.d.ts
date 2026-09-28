import type { Note, NotePatch } from './data'
export interface NotesService { list(): Note[]; create(input?: {type?:string}): Promise<Note>; update(id:string, patch:NotePatch): Promise<Note>; remove(id:string): Promise<{ok:true}>; reorder(ids:string[]): Promise<Note[]> }

import type {} from '@cordis-notebook/host'
declare module '@cordis-notebook/host' { interface ServerServices { notes: NotesService } }
