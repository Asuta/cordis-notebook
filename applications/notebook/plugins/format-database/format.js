export const databaseFormat = {
  type: 'database', label: '数据库页面', icon: 'Table', editor: 'database', editorLayout: 'wide',
  fields: ['database'], defaults: () => ({ database: { version: 1, view: 'table' } }),
  normalize({ database }) {
    if (!database || typeof database !== 'object' || Array.isArray(database) || database.version !== 1
      || !['table', 'board'].includes(database.view) || Object.keys(database).some(key => !['version', 'view'].includes(key))) throw Error('数据库页面配置无效')
    return { database: { version: 1, view: database.view } }
  },
  toText: () => '',
}
