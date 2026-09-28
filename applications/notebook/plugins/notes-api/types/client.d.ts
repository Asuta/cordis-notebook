import type { Note, NotePatch } from '@cordis-notebook/notes/data'
export interface NotesApi {
  request(path?:string, method?:'GET'): Promise<Note[]>
  request(path:string, method:'POST', data?:{type?:string}): Promise<Note>
  request(path:string, method:'PATCH', data?:NotePatch): Promise<Note>
  request(path:string, method:'PUT', data?:{ids:string[]}): Promise<Note[]>
  request(path:string, method:'DELETE'): Promise<unknown>
}

import type {} from '@cordis-notebook/host'
declare module '@cordis-notebook/host' { interface ClientServices { notesApi: NotesApi } }
