import { mountDatabase } from './view.jsx'
import { queryRows } from './query.js'
export default function(ctx, sdk) {
  const root = sdk.el('div', { class: 'database-editor' })
  ctx.editorHost.register(ctx, 'database', root)
  mountDatabase(ctx, sdk, root)
  let disposed = false
  ctx.effect(() => () => { disposed = true })
  const database = id => {
    if (disposed) throw Error('数据库工具已停用')
    const note = ctx.notebook.notes.find(note => note.id === id)
    if (note?.type !== 'database') throw Error('请指定数据库页面，或 notebook_create({type:"database"}) 创建')
    return note
  }
  const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
  const string = { type: 'string' }
  const properties = object({ status: { enum: ['todo', 'doing', 'done'] }, tags: { type: 'array', items: string }, date: { type: ['string', 'null'] } })
  sdk.agent.register({ name: 'notebook_database_read', description: '读取数据库页面及其直接子页记录、数值 revision、状态(todo/doing/done)、标签和日期。记录就是实际笔记，notebook_open 可打开正文。支持标题搜索及筛选排序。', inputSchema: object({ id: string, query: string, status: { enum: ['', 'todo', 'doing', 'done'] }, tag: string, from: string, to: string, sort: { enum: ['updated', 'title', 'date'] } }) }, ({ id = ctx.notebook.selected, ...filter } = {}) => {
    const note = database(id)
    return { id, view: note.database.view, rows: queryRows(ctx.notebook.notes, id, filter).map(row => ({ id: row.id, title: row.title, type: row.type, revision: row.revision, properties: row.properties || { status: 'todo', tags: [], date: null } })) }
  })
  sdk.agent.register({ name: 'notebook_database_write', description: '在数据库里创建记录或更新记录标题/属性并保存。create 默认创建 BlockNote 子页；update 需要 rowId 和刚读取的数值 revision。properties 支持部分更新。切换视图用 notebook_update 更新 database:{version:1,view:"table"或"board"}。', inputSchema: object({ databaseId: string, action: { enum: ['create', 'update'] }, rowId: string, revision: { type: 'integer' }, type: string, title: string, properties }, ['databaseId', 'action']) }, async args => {
    database(args.databaseId)
    const model = ctx.notebook
    if (model.busy || model.conflict) throw Error('当前不可修改，请等待保存或解决冲突')
    const fields = { ...(args.title !== undefined ? { title: args.title } : {}), ...(args.properties !== undefined ? { properties: args.properties } : {}) }
    if (args.action === 'create') return model.create(args.type || 'blocknote', { ...fields, parentId: args.databaseId }, { select: false })
    const row = model.notes.find(note => note.id === args.rowId && note.parentId === args.databaseId)
    if (args.action !== 'update' || !row || !Number.isSafeInteger(args.revision)) throw Error('记录或 revision 无效')
    return model.updateNote(row.id, fields, args.revision)
  })
}
