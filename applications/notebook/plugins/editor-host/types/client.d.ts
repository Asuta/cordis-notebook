import type { Context } from 'cordis'
export interface EditorHost {
  /** Optional editor-owned location for the host's title/date controls. */
  register(owner:Context, type:string, node:HTMLElement, options?: { headingTarget?: HTMLElement }):()=>unknown
}

import type {} from '@cordis-notebook/host'
declare module '@cordis-notebook/host' { interface ClientServices { editorHost: EditorHost } }
