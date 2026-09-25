import type { NoteFormats } from './data'
export type { NoteFormat, NoteFormats } from './data'

import type {} from '@cordis-notebook/host'
declare module '@cordis-notebook/host' { interface ClientServices { noteFormats: NoteFormats } }
