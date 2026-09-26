import type { Context } from 'cordis'
export interface ShellService { mount(owner:Context, name:string, node:HTMLElement):HTMLElement; showEditor():void; readonly main:HTMLElement }

import type {} from '@cordis-notebook/host'
declare module '@cordis-notebook/host' { interface ClientServices { shell: ShellService } }
