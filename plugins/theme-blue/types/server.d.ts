import type { ThemeSelection } from '@cordis-notebook/theme-engine/data'
export type { ThemeSelection } from '@cordis-notebook/theme-engine/data'

import type {} from '@cordis-notebook/host'
declare module '@cordis-notebook/host' { interface ServerServices { theme: ThemeSelection } }
