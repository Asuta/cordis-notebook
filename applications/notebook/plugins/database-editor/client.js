import { createDatabaseUI, mountDatabase } from './view.jsx'
export default function(ctx, sdk) {
  const root = sdk.el('div', { class: 'database-editor' }), schema = ctx.databaseSchema
  ctx.editorHost.register(ctx, 'database', root)
  const ui = sdk.provide('databaseUI', createDatabaseUI(ctx, sdk))
  mountDatabase(ctx, sdk, root, ui)
  let disposed = false
  ctx.effect(() => () => { disposed = true })
  const database = id => {
    if (disposed) throw Error('数据库工具已停用')
    const note = ctx.notebook.notes.find(note => note.id === id)
    if (note?.type !== 'database' || note.template) throw Error('请指定数据库页面，或 notebook_create({type:"database"}) 创建')
    return note
  }
  const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
  const string = { type: 'string' }, integer = { type: 'integer' }
  const value = { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }, { type: 'array', items: string }] }
  const properties = object({ status: { enum: ['todo', 'doing', 'done'] }, tags: { type: 'array', items: string }, date: { type: ['string', 'null'] }, custom: { type: 'object', additionalProperties: value } })
  const filter = { query: string, status: { enum: ['', 'todo', 'doing', 'done'] }, tag: string, from: string, to: string, sort: string, direction: { enum: ['asc', 'desc'] }, rules: { type: 'array', items: object({ field: string, operator: { enum: ['empty', 'notEmpty', 'eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte'] }, value }, ['field', 'operator']) } }
  sdk.agent.register({ name: 'notebook_database_read', description: '读取数据库配置 revision、自定义 fields、命名 views 和真实子页记录。viewId 默认当前视图；使用保存的筛选排序，可用参数覆盖。custom 以稳定字段 ID 为键。记录可 notebook_open 打开正文。', inputSchema: object({ id: string, viewId: string, ...filter }) }, ({ id = ctx.notebook.selected, viewId, ...overrides } = {}) => {
    const note = database(id), config = schema.normalize(note.database)
    const view = config.views.find(view => view.id === (viewId || config.activeViewId))
    if (!view) throw Error('视图不存在')
    return { id, revision: note.revision, ...config, selectedViewId: view.id, rows: schema.queryRows(ctx.notebook.notes, id, { ...view.filter, ...overrides }, config.fields).map(row => ({ id: row.id, title: row.title, type: row.type, revision: row.revision, properties: row.properties || { status: 'todo', tags: [], date: null } })) }
  })
  sdk.agent.register({ name: 'notebook_database_configure', description: '修改数据库自定义字段和命名视图。必须传刚读取的 id/revision；fields/views 提供完整数组，省略的数组保留。字段 ID 用 f_ 开头并保持稳定；改名保留值，删除字段移除其筛选条件后提交。不兼容的类型/选项变更会拒绝。布局 table/board；activeViewId 选择默认视图。', inputSchema: object({
    id: string, revision: integer, activeViewId: string,
    fields: { type: 'array', items: object({ id: string, name: string, type: { enum: schema.fieldTypes }, options: { type: 'array', items: string } }, ['id', 'name', 'type']) },
    views: { type: 'array', items: object({ id: string, name: string, layout: { enum: ['table', 'board'] }, filter: object(filter) }, ['id', 'name', 'layout']) },
  }, ['id', 'revision']) }, async ({ id, revision, ...patch }) => {
    const note = database(id)
    if (note.revision !== revision) throw Error('数据库版本已变化，请重新读取')
    if (!Object.keys(patch).length) throw Error('请提供字段或视图修改')
    return ctx.notebook.updateNote(id, { database: schema.normalize({ ...schema.normalize(note.database), ...patch }) }, revision)
  })
  sdk.agent.register({ name: 'notebook_database_write', description: '在数据库里创建记录或更新标题/属性并保存。create 默认 BlockNote；update 需要 rowId 和刚读取的记录 revision。properties 支持部分更新，custom 使用 fields 中的字段 ID；null 清空单个值。修改数据库结构或视图请用 notebook_database_configure。模板使用 notebook_template_apply。', inputSchema: object({ databaseId: string, action: { enum: ['create', 'update'] }, rowId: string, revision: integer, type: string, title: string, properties }, ['databaseId', 'action']) }, async args => {
    const note = database(args.databaseId), config = schema.normalize(note.database), model = ctx.notebook
    if (model.busy || model.conflict) throw Error('当前不可修改，请等待保存或解决冲突')
    if (Object.keys(args.properties?.custom || {}).some(id => !config.fields.some(field => field.id === id))) throw Error('custom 包含不存在的字段，请先读取数据库字段')
    const fields = { ...(args.title !== undefined ? { title: args.title } : {}), ...(args.properties !== undefined ? { properties: args.properties } : {}) }
    schema.validateRows(config, [{ properties: args.properties }])
    if (args.action === 'create') return model.create(args.type || 'blocknote', { ...fields, parentId: args.databaseId }, { select: false })
    const row = model.notes.find(note => !note.template && note.id === args.rowId && note.parentId === args.databaseId)
    if (args.action !== 'update' || !row || !Number.isSafeInteger(args.revision)) throw Error('记录或 revision 无效')
    return model.updateNote(row.id, fields, args.revision)
  })
}
