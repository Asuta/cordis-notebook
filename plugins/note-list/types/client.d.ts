import type { Context } from 'cordis'
export interface NoteListUI { mount(owner:Context, name:'filters', node:HTMLElement):HTMLElement }

import type {} from '@cordis-notebook/host'
declare module '@cordis-notebook/host' { interface ClientServices { noteListUI: NoteListUI } }
