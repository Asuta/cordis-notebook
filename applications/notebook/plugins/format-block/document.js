// The persisted format belongs to the application, never to Tiptap.
export const blockTypes = ['paragraph', 'heading', 'bullet', 'number', 'todo', 'toggle', 'quote', 'callout', 'code', 'divider', 'image', 'table']
export function createBlockDocument(rich) {
  const normalize = input => {
    if (!input || input.version !== 1 || !Array.isArray(input.blocks)) throw Error('块页面版本或结构无效')
    const ids = new Set()
    let count = 0, length = 0
    const read = (blocks, depth) => {
      if (!Array.isArray(blocks) || depth > 12) throw Error('块页面最多嵌套 12 层')
      return blocks.map(block => {
        if (++count > 1000) throw Error('块页面最多包含 1000 个块')
        if (!block || !/^[\w:-]{1,100}$/.test(block.id || '') || ids.has(block.id)) throw Error('块 ID 无效或重复')
        ids.add(block.id)
        if (!blockTypes.includes(block.type)) throw Error('不支持的块类型')
        const body = rich.normalize(block.body)
        if (!body.elements.length) throw Error('块正文不能为空，请使用空段落')
        length += rich.text(body).length + 1
        if (length > 200000) throw Error('笔记内容过长')
        const expected = { heading: 'heading', code: 'code', divider: 'rule', image: 'image', table: 'table' }[block.type]
        if (expected && (body.elements.length !== 1 || body.elements[0].kind !== expected)) throw Error('块类型与正文不一致')
        return { id: block.id, type: block.type, body, checked: !!block.checked,
          collapsed: block.type === 'toggle' && !!block.collapsed, children: read(block.children || [], depth + 1) }
      })
    }
    const result = { version: 1, blocks: read(input.blocks, 0) }
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 1750000) throw Error('页面格式数据过多，请拆分笔记')
    return result
  }
  const create = (type = 'paragraph', text = '', id = crypto.randomUUID()) => {
    let element
    if (type === 'image') {
      if (!/^\/api\/note-assets\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/i.test(text))
        throw Error('图片块需要已上传的本地资源地址')
      element = { id: id + '-image', kind: 'image', src: text, alt: '', width: 640, height: 360 }
    } else if (type === 'table') {
      element = {
        id: id + '-table', kind: 'table', children: Array.from({ length: 3 }, (_, row) => ({
          id: `${id}-row-${row}`, kind: 'row', children: Array.from({ length: 3 }, (_, column) => ({
            id: `${id}-cell-${row}-${column}`, kind: 'cell', children: [{ id: `${id}-cell-${row}-${column}-paragraph`, kind: 'paragraph', runs: [{ text: '' }] }],
          })),
        })),
      }
    } else {
      const kind = { heading: 'heading', code: 'code', divider: 'rule' }[type] || 'paragraph'
      element = { id: id + '-text', kind, runs: [{ text }], ...(kind === 'heading' ? { level: 1 } : {}) }
    }
    return normalize({ version: 1, blocks: [{ id, type, body: { version: 1, elements: [element] } }] }).blocks[0]
  }
  const text = doc => {
    const walk = blocks => blocks.flatMap(block => [rich.text(block.body), ...walk(block.children)])
    return walk(doc.blocks).join('\n')
  }
  const toEditor = input => {
    const doc = normalize(input)
    const node = block => ({ type: 'pageBlock', attrs: { id: block.id, kind: block.type, checked: block.checked, collapsed: block.collapsed },
      content: [...rich.toEditor(block.body).content, ...(block.children.length ? [{ type: 'blockChildren', content: block.children.map(node) }] : [])] })
    return { type: 'doc', content: (doc.blocks.length ? doc.blocks : [create()]).map(node) }
  }
  const fromEditor = json => {
    const node = n => {
      if (n.type !== 'pageBlock') throw Error('块页面缺少块容器')
      const children = (n.content || []).filter(c => c.type === 'blockChildren')
      if (children.length > 1) throw Error('块页面层级无效')
      return { id: n.attrs?.id, type: n.attrs?.kind, checked: n.attrs?.checked, collapsed: n.attrs?.collapsed,
        body: rich.fromEditor({ type: 'doc', content: (n.content || []).filter(c => c.type !== 'blockChildren') }),
        children: (children[0]?.content || []).map(node) }
    }
    return normalize({ version: 1, blocks: (json.content || []).map(node) })
  }
  return { normalize, create, text, toEditor, fromEditor }
}
