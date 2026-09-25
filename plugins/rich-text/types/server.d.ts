import type { RichDocumentService } from './data'
export type RichTextServer = RichDocumentService

import type {} from '@cordis-notebook/host'
declare module '@cordis-notebook/host' { interface ServerServices { richText: RichTextServer } }
