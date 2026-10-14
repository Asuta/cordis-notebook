export interface NoteAssetsClient { upload(file:File): Promise<string>; uploadAttachment(file:File): Promise<string> }

import type {} from '@cordis-notebook/host'
declare module '@cordis-notebook/host' { interface ClientServices { noteAssets: NoteAssetsClient } }
