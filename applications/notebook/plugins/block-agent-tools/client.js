import { applyOperations } from './operations.js'
import { editSchema, readSchema } from './schema.js'

// Same whole-note revision protocol as notebook_read/notebook_update.
async function revision(note) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(note)))
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
}
export default function(ctx, sdk) {
  const model = ctx.notebook, service = ctx.blockDocument
  const current = () => {
    if (sdk.signal?.aborted) throw Error('块页面工具已停用，请重新读取工具列表')
    const note = model.current()
    if (!note || note.type !== 'block') throw Error('请先用 notebook_open 打开块页面，或 notebook_create({type:"block"}) 创建')
    return note
  }
  const describe = async (note, includeBody = false) => {
    const snapshot = structuredClone(note)
    const walk = blocks => blocks.map(block => ({
      id: block.id, type: block.type, text: service.text({ version: 1, blocks: [{ ...block, children: [] }] }),
      ...(block.type === 'heading' ? { level: block.body.elements[0].level } : {}),
      checked: block.checked, collapsed: block.collapsed,
      ...(includeBody ? { body: block.body } : {}), children: walk(block.children),
    }))
    return { id: snapshot.id, title: snapshot.title, revision: await revision(snapshot), blocks: walk(snapshot.document.blocks) }
  }
  sdk.agent.register({ name: 'notebook_blocks_read', inputSchema: readSchema,
    description: '读取当前已打开块页面的块树（ID、类型、文字、状态和 children）与 revision，包含未保存草稿。编辑富文本/表格时 includeBody:true。修改用 notebook_blocks_edit，无需重写整个 document。' },
  ({ includeBody = false }) => describe(current(), includeBody))
  sdk.agent.register({ name: 'notebook_blocks_edit', inputSchema: editSchema,
    description: '按稳定块 ID 编辑已打开的块页面。必须提供刚读取的 id/revision；operations 按顺序全部校验后一次应用并保存。insert 插入；update 改正文/待办 checked/折叠 collapsed，保留子块；remove 删除该块及整个子树；move 保留子树，inside 嵌套，移到父块 after 或页面 start/end 可取消嵌套。返回新 revision、块树和 insertedIds。旧版本被拒绝后先重读再决定修改，不能盲目重试；保存失败会保留草稿。结构编辑会重置编辑器局部撤销历史，选区改写优先 replace_selection。示例 operations:[{op:"insert",block:{id:"task-1",type:"todo",text:"检查结果"},targetId:"已有块ID",placement:"after"},{op:"update",blockId:"task-1",patch:{checked:true}}]。' },
  async args => {
    if (model.busy || !model.editable || model.conflict) throw Error('编辑器当前不可修改；请等待操作完成或解决保存冲突')
    const before = current(), serialized = JSON.stringify(before)
    if (args.id !== before.id) throw Error('请先打开目标笔记并重新读取')
    if (await revision(before) !== args.revision || JSON.stringify(current()) !== serialized || model.busy || !model.editable || model.conflict) throw Error('笔记已变化，请重新读取后修改')
    const result = applyOperations(service, before.document, args.operations)
    model.edit({ document: result.document })
    await model.flush()
    const saved = current()
    if (saved.id !== args.id) throw Error('笔记已切换；修改已提交，请重新打开目标笔记确认')
    return { ...await describe(saved), insertedIds: result.insertedIds }
  })
}
