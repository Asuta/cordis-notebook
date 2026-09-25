export interface StorageService { readonly file:string; read():Promise<unknown>; write(items:unknown):Promise<void> }

import type {} from '@cordis-notebook/host'
declare module '@cordis-notebook/host' { interface ServerServices { storage: StorageService } }
