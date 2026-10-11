import type { BlockDocumentService } from './data'
import type {} from '@cordis-notebook/host'
declare module '@cordis-notebook/host' { interface ServerServices { blockDocument: BlockDocumentService } }
