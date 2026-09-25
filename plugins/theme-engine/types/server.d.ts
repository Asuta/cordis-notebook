import type { Context } from 'cordis'
export interface ThemeEngineServer { activate(owner:Context, id:string): void }

import type {} from '@cordis-notebook/host'
declare module '@cordis-notebook/host' { interface ServerServices { themeEngine: ThemeEngineServer } }
