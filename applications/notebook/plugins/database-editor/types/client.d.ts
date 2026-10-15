export interface DatabaseViewProps { databaseId: string; viewId?: string; embedded?: boolean; readOnly?: boolean; onViewChange?: (viewId: string) => void }
export interface DatabaseUI { readonly View: (props: DatabaseViewProps) => unknown }
import type {} from '@cordis-notebook/host'
declare module '@cordis-notebook/host' { interface ClientServices { databaseUI: DatabaseUI } }
