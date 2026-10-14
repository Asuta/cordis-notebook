const object = properties => ({ type: 'object', properties, additionalProperties: false })
const string = { type: 'string' }
export async function revision(note) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(note)))
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
}
export default function (ctx, sdk) {
  const model = ctx.notebook
  const register = (name, description, inputSchema, execute) => sdk.agent.register({ name, description, inputSchema }, execute)
  register('notebook_list', '列出本页面笔记及当前打开的笔记；parentId 为父页面 ID，null 表示顶层。包含本页未保存的状态。', object({}), () => ({ selected: model.selected, dirty: model.dirty, notes: model.notes.map(({ id, title, type, parentId }) => ({ id, title, type, parentId: parentId ?? null })) }))
  register('notebook_read', '读取指定笔记（缺省为当前笔记）及修改所需的 revision。', object({ id: string }), async ({ id }) => {
    const note = id ? model.notes.find(n => n.id === id) : model.current()
    if (!note) throw Error('笔记不存在')
    const snapshot = structuredClone(note)
    return { note: snapshot, revision: await revision(snapshot), selected: model.selected, dirty: model.dirty }
  })
  register('notebook_open', '先保存当前笔记，再打开指定笔记。', { ...object({ id: string }), required: ['id'] }, async ({ id }) => {
    if (model.busy) throw Error('编辑器正在处理其他操作')
    if (!model.notes.some(n => n.id === id)) throw Error('笔记不存在')
    await model.choose(id); return { selected: model.selected }
  })
  register('notebook_create', '创建并打开笔记，type 可为 plain、markdown、freeform、blocknote（BlockNote 页面）或 database（数据库页面）。parentId 指定父页面，省略则在顶层创建。', object({ type: string, title: string, parentId: { type: ['string', 'null'] } }), async ({ type = 'plain', title, parentId = null }) => {
    if (model.busy) throw Error('编辑器正在处理其他操作')
    await model.create(type, { parentId })
    // Keep title changes on the guarded save path, including draft recovery
    // when a before-save hook rejects the new title.
    if (title !== undefined) model.edit({ title })
    await model.flush(); return { note: model.current() }
  })
  register('notebook_update', '修改已打开笔记。必须传入 notebook_read 返回的 revision；BlockNote 局部修改优先 notebook_blocknote_read/edit；只改选区使用 replace_selection。', {
    ...object({ id: string, revision: string, patch: { type: 'object', description: 'title/parentId/properties 等通用字段；properties 支持状态 status、标签 tags、日期 date。数据库视图 database:{version:1,view:table或board}，记录是直接子页；普通笔记正文 content，Markdown 源码 markdown，自由页面 blocks/page/version；BlockNote 用 document:{version:1,blocks:[...]}，块结构为原生 props/content/children。非 plain 的 content 是派生纯文本，不能用于修改正文。' } }), required: ['id', 'revision', 'patch'],
  }, async args => {
    if (model.busy || !model.editable) throw Error('编辑器当前不可修改')
    const rejection = await ctx.serial('notebook/before-action')
    if (rejection !== undefined && rejection !== null && rejection !== false) throw Error(String(rejection))
    const before = model.current(), serialized = JSON.stringify(before)
    if (!before || args.id !== before.id) throw Error('请先打开目标笔记并重新读取')
    if (await revision(before) !== args.revision || JSON.stringify(model.current()) !== serialized || model.busy) throw Error('笔记已变化，请重新读取后修改')
    model.edit(args.patch); await model.flush(); return { note: model.current(), revision: await revision(model.current()) }
  })
}
