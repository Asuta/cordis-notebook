export interface NoteAssetsServer { readonly directory: string }

import type {} from '@cordis-notebook/host'
declare module '@cordis-notebook/host' { interface ServerServices { noteAssets: NoteAssetsServer } }
