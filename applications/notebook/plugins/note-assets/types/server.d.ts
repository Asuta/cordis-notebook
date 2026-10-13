export interface NoteAssetsServer { readonly directory: string; validate(data: string, expected?: string): string; read(src: string): Promise<{src:string; data:string}>; write(data:string, expected?:string): Promise<{src:string}> }

import type {} from '@cordis-notebook/host'
declare module '@cordis-notebook/host' { interface ServerServices { noteAssets: NoteAssetsServer } }
