import type { Note } from '@cordis-notebook/notes/data'
export type FieldType = 'text' | 'number' | 'select' | 'multiSelect' | 'checkbox' | 'date' | 'url'
export interface DatabaseField { id: string; name: string; type: FieldType; options?: string[] }
export interface DatabaseRule { field: string; operator: 'empty' | 'notEmpty' | 'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte'; value?: string | number | boolean | string[] }
export interface DatabaseFilter { query: string; status: string; tag: string; from: string; to: string; sort: string; direction: 'asc' | 'desc'; rules: DatabaseRule[] }
export interface DatabaseView { id: string; name: string; layout: 'table' | 'board'; filter: DatabaseFilter }
export interface DatabaseConfig { version: 1; view: 'table' | 'board'; fields: DatabaseField[]; views: DatabaseView[]; activeViewId: string }
export interface DatabaseSchema {
  normalize(input: unknown): DatabaseConfig
  filter(input?: unknown, fields?: DatabaseField[]): DatabaseFilter
  validateRows(database: unknown, rows: readonly Pick<Note, 'properties'>[]): void
  queryRows(notes: readonly Note[], databaseId: string, filter?: Partial<DatabaseFilter>, fields?: DatabaseField[]): Note[]
  fieldValue(row: Note, id: string): unknown
  readonly fieldTypes: readonly FieldType[]
  readonly statuses: readonly (readonly [string, string])[]
  defaultFilter(): DatabaseFilter
}
import type {} from '@cordis-notebook/host'
declare module '@cordis-notebook/host' { interface ClientServices { databaseSchema: DatabaseSchema } }
