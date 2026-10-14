import { applyOperations } from './operations.js'
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const string = { type: 'string' }
const fields = { type: { ...string, description: '转换目标类型：文字/表格需同时提供新 text/content；image/video/audio/file/divider 不传正文，媒体地址放 props.url；equation 用 props.expression，tableOfContents 不传正文，callout 可用 text 和 props.tone。' }, text: { ...string, description: '替换文字正文为纯文本，清除原正文样式；与 content 互斥。' }, content: { description: 'BlockNote 原生行内内容数组，或 tableContent 表格对象；先用 includeContent:true 读取。' }, props: { type: 'object', description: '合并更新原生属性，例如标题 level、待办 checked、媒体 url/caption；公式 expression；提示框 tone(info/warning/success)。' } }
const position = { targetId: string, placement: { type: 'string', enum: ['start', 'end', 'before', 'after', 'inside'] } }
async function revision(note) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(note))))].map(b => b.toString(16).padStart(2, '0')).join('')
}
export default function(ctx, sdk) {
  const model = ctx.notebook, service = ctx.blockNoteDocument
  let disposed = false
  ctx.effect(() => () => { disposed = true })
  const current = () => {
    if (disposed || sdk.signal?.aborted) throw Error('BlockNote 工具已停用')
    const note = model.current()
    if (!note || note.type !== 'blocknote') throw Error('请先打开 BlockNote 页面，或 notebook_create({type:"blocknote"}) 创建')
    return note
  }
  const describe = async (note, full = false) => {
    const snapshot = structuredClone(note)
    const walk = blocks => blocks.map(block => ({ id: block.id, type: block.type, props: block.props,
      text: service.text({ version: 1, blocks: [{ ...block, children: [] }] }),
      ...(full && block.content !== undefined ? { content: block.content } : {}), children: walk(block.children) }))
    return { id: snapshot.id, title: snapshot.title, revision: await revision(snapshot), blocks: walk(snapshot.document.blocks) }
  }
  sdk.agent.register({ name: 'notebook_blocknote_read', description: '读取当前 BlockNote 页面原生块树、稳定 ID、文字、props 与修改所需 revision，包含未保存草稿。includeContent:true 还返回富文本/表格 content。旧 block 格式使用 notebook_blocks_read。',
    inputSchema: object({ includeContent: { type: 'boolean' } }) }, ({ includeContent = false }) => describe(current(), includeContent))
  sdk.agent.register({ name: 'notebook_blocknote_edit', description: '按 ID 原子编辑当前 BlockNote 页面并保存。提供刚读取的 id/revision；批次任一操作非法则全部不应用。insert/update/remove/move；inside 嵌套，start/end 顶层。props 合并属性；文字 text 会清除该块原有文字样式，富文本或表格使用原生 content。不是旧 OutlineDocument。保存失败保留草稿；版本过期先重读，不盲目重试。结构编辑重置局部撤销历史，选区修改优先 replace_selection。示例 operations:[{op:"insert",block:{type:"checkListItem",text:"检查保存",props:{checked:false}}}]。',
    inputSchema: object({ id: string, revision: string, operations: { type: 'array', minItems: 1, maxItems: 100, items: { oneOf: [
      object({ op: { const: 'insert' }, block: object({ id: string, ...fields }), ...position }, ['op', 'block']),
      object({ op: { const: 'update' }, blockId: string, patch: object(fields) }, ['op', 'blockId', 'patch']),
      object({ op: { const: 'remove' }, blockId: string }, ['op', 'blockId']),
      object({ op: { const: 'move' }, blockId: string, ...position }, ['op', 'blockId', 'placement']),
    ] } } }, ['id', 'revision', 'operations']) }, async args => {
    if (model.busy || !model.editable || model.conflict) throw Error('当前不可编辑，请等待或解决保存冲突')
    const rejection = await ctx.serial('notebook/before-action')
    if (rejection !== undefined && rejection !== null && rejection !== false) throw Error(String(rejection))
    const before = current(), serialized = JSON.stringify(before)
    if (args.id !== before.id || await revision(before) !== args.revision || JSON.stringify(current()) !== serialized || model.busy || !model.editable || model.conflict) throw Error('笔记已变化，请重新读取后修改')
    const result = applyOperations(service, before.document, args.operations)
    model.edit({ document: result.document }); await model.flush()
    if (current().id !== args.id) throw Error('笔记已切换，修改已提交，请重新打开确认')
    return { ...await describe(current()), insertedIds: result.insertedIds }
  })
}
