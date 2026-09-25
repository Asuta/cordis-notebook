import type { MarkdownService } from './data'
export type { MarkdownService } from './data'

import type {} from '@cordis-notebook/host'
declare module '@cordis-notebook/host' { interface ClientServices { markdown: MarkdownService } }
