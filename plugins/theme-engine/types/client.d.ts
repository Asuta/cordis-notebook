import type { Context } from 'cordis'
import type { ThemePreset } from './data'
export interface ThemeEngine {
  /** Styles are owned by the consuming theme context. */
  apply(owner: Context, preset: ThemePreset): () => unknown
}

import type {} from '@cordis-notebook/host'
declare module '@cordis-notebook/host' { interface ClientServices { themeEngine: ThemeEngine } }
