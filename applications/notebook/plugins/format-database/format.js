import { normalizeDatabase, validateRows } from './schema.js'
export const databaseFormat = {
  type: 'database', label: '数据库页面', icon: 'Table', editor: 'database', editorLayout: 'wide',
  fields: ['database'], defaults: () => ({ database: { version: 1, view: 'table' } }),
  normalize: ({ database }) => ({ database: normalizeDatabase(database) }),
  validateChildren: (note, children) => validateRows(note.database, children),
  toText: () => '',
}
