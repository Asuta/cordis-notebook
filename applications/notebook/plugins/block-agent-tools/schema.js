import { placements, types } from './operations.js'
export const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const string = { type: 'string' }, id = { type: 'string', pattern: '^[\\w:-]{1,100}$' }
const fields = {
  type: { type: 'string', enum: types },
  text: { type: 'string', description: '替换整个块正文为纯文字，会清除原正文格式；与 body 互斥。图片块传已上传的 /api/note-assets/... 地址；表格/分割线不用 text。' },
  body: { type: 'object', description: '完整 OutlineDocument：{version:1,elements:[...]}，与 text 互斥；通过 notebook_blocks_read({includeBody:true}) 读取原结构后修改。不是 Tiptap JSON。' },
  level: { type: 'integer', minimum: 1, maximum: 3, description: '标题级别，仅 heading 使用。' },
  checked: { type: 'boolean', description: '仅 todo：是否已完成。' },
  collapsed: { type: 'boolean', description: '仅 toggle：是否折叠。' },
}
const position = {
  targetId: { ...id, description: 'before/after/inside 的目标块 ID；start/end 不传。' },
  placement: { type: 'string', enum: placements, description: 'before/after 放在目标同级前/后，inside 放到目标子块末尾并展开；start/end 放到页面顶层首/尾。insert 默认 end。' },
}
export const readSchema = object({ includeBody: { type: 'boolean', description: '默认 false，返回块 ID、类型、文字和子树；富文本/表格编辑时用 true 额外返回每块的 body。' } })
export const editSchema = object({
  id: string, revision: string,
  operations: { type: 'array', minItems: 1, maxItems: 100, items: { oneOf: [
    object({ op: { const: 'insert' }, block: object({ id: { ...id, description: '可省略自动生成；同批后续操作要引用新块时提供唯一 ID。' }, ...fields }), ...position }, ['op', 'block']),
    object({ op: { const: 'update' }, blockId: id, patch: { ...object(fields), minProperties: 1 } }, ['op', 'blockId', 'patch']),
    object({ op: { const: 'remove' }, blockId: id }, ['op', 'blockId']),
    object({ op: { const: 'move' }, blockId: id, ...position }, ['op', 'blockId', 'placement']),
  ] } },
}, ['id', 'revision', 'operations'])
