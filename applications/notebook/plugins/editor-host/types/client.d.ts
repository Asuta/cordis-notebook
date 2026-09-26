import type { Context } from 'cordis'
export interface EditorHost { register(owner:Context, type:string, node:HTMLElement):()=>unknown }

import type {} from '@cordis-notebook/host'
declare module '@cordis-notebook/host' { interface ClientServices { editorHost: EditorHost } }
