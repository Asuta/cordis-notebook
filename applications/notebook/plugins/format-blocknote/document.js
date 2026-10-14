// Versioned envelope around BlockNote's public block JSON. Both processes use
// this validator; editor/DOM implementation code is never needed by storage.
export const blockTypes = ['paragraph', 'heading', 'bulletListItem', 'numberedListItem', 'checkListItem', 'toggleListItem', 'quote', 'codeBlock', 'divider', 'table', 'image', 'video', 'audio', 'file', 'callout', 'equation', 'tableOfContents']
const record = value => value && typeof value === 'object' && !Array.isArray(value)
const idPattern = /^[\w:-]{1,100}$/
const styles = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'textColor', 'backgroundColor'])
const common = ['textColor', 'backgroundColor', 'textAlignment']
const propsByType = {
  callout: ['tone'], equation: ['expression'],
  heading: ['level', 'isToggleable'], numberedListItem: ['start'], checkListItem: ['checked'],
  codeBlock: ['language'], image: ['name', 'url', 'caption', 'showPreview', 'previewWidth'],
  video: ['name', 'url', 'caption', 'showPreview', 'previewWidth'], audio: ['name', 'url', 'caption', 'showPreview'], file: ['name', 'url', 'caption'],
}
const baseProps = { equation: [], tableOfContents: [], codeBlock: [], divider: [], table: ['textColor'], quote: ['textColor', 'backgroundColor'],
  image: ['textAlignment', 'backgroundColor'], video: ['textAlignment', 'backgroundColor'], audio: ['backgroundColor'], file: ['backgroundColor'] }
function object(value, allowed, label) {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key))) throw Error(label + '无效或包含未知字段')
}
function url(value, media = false) {
  if (typeof value !== 'string' || value.length > 4096 || (value && !/^(https?:\/\/|\/api\/note-(?:assets|files)\/)/i.test(value) && (media || !/^(mailto:|#)/i.test(value)))) throw Error('链接地址无效')
  return value
}
export function normalizeDocument(input) {
  object(input, ['version', 'blocks'], 'BlockNote 文档')
  if (input.version !== 1 || !Array.isArray(input.blocks)) throw Error('BlockNote 文档版本或结构无效')
  const ids = new Set(); let count = 0, length = 0
  const text = value => {
    if (typeof value !== 'string' || (length += value.length) > 200000) throw Error('笔记内容无效或超过 200000 字符')
    return value
  }
  const readStyles = value => {
    object(value, [...styles], '文字样式')
    for (const [key, entry] of Object.entries(value)) {
      if (key.endsWith('Color') ? typeof entry !== 'string' || entry.length > 100 : typeof entry !== 'boolean') throw Error('文字样式值无效')
    }
    return { ...value }
  }
  const inline = (items, textOnly = false) => {
    if (!Array.isArray(items) || items.length > 10000) throw Error('行内正文无效')
    return items.map(item => {
      if (++count > 20000) throw Error('文档节点过多')
      if (item?.type === 'text') { object(item, ['type', 'text', 'styles'], '文字片段'); return { type: 'text', text: text(item.text), styles: readStyles(item.styles || {}) } }
      // BlockNote links contain StyledText only, never custom inline nodes.
      if (textOnly) throw Error('链接内部只支持文字片段')
      if (item?.type === 'math') {
        object(item, ['type', 'props'], '行内公式'); object(item.props, ['expression'], '公式属性')
        if (typeof item.props.expression !== 'string' || item.props.expression.length > 4096) throw Error('公式最多 4096 字符')
        return { type: 'math', props: { expression: text(item.props.expression) } }
      }
      if (item?.type === 'link') { object(item, ['type', 'href', 'content'], '链接'); return { type: 'link', href: url(item.href), content: inline(item.content, true) } }
      if (item?.type === 'pageLink') {
        object(item, ['type', 'props'], '页面引用'); object(item.props, ['noteId', 'title'], '页面引用属性')
        if (typeof item.props.noteId !== 'string' || !idPattern.test(item.props.noteId) || typeof item.props.title !== 'string' || item.props.title.length > 200) throw Error('页面引用无效')
        return { type: 'pageLink', props: { noteId: item.props.noteId, title: text(item.props.title) } }
      }
      throw Error('不支持的行内内容')
    })
  }
  const table = content => {
    object(content, ['type', 'rows', 'columnWidths', 'headerRows', 'headerCols'], '表格')
    if (content.type !== 'tableContent' || !Array.isArray(content.rows) || !content.rows.length || content.rows.length > 100) throw Error('表格最多 100 行')
    const result = { type: 'tableContent', rows: content.rows.map(row => {
      object(row, ['cells'], '表格行')
      if (!Array.isArray(row.cells) || row.cells.length > 20) throw Error('表格最多 20 列')
      // BlockNote 0.55 cannot recreate a tableRow with no own cells from JSON.
      // Reject before saving so a UI merge or Agent edit cannot strand the note.
      if (!row.cells.length) throw Error('暂不支持覆盖整行的纵向合并，请在每行保留至少一个单元格')
      return { cells: row.cells.map(cell => {
        if (Array.isArray(cell)) return inline(cell)
        object(cell, ['type', 'props', 'content'], '单元格')
        if (cell.type !== 'tableCell') throw Error('单元格类型无效')
        object(cell.props || {}, [...common, 'colspan', 'rowspan'], '单元格属性')
        for (const key of ['colspan', 'rowspan']) if (cell.props?.[key] !== undefined && (!Number.isInteger(cell.props[key]) || cell.props[key] < 1 || cell.props[key] > (key === 'colspan' ? 20 : 100))) throw Error('单元格跨度无效')
        for (const key of common) if (cell.props?.[key] !== undefined && (typeof cell.props[key] !== 'string' || cell.props[key].length > 100)) throw Error('单元格样式无效')
        return { type: 'tableCell', props: { ...cell.props }, content: inline(cell.content) }
      }) }
    }) }
    const occupied = result.rows.map(() => new Set())
    let columns = 0
    for (const [rowIndex, row] of result.rows.entries()) {
      let column = 0
      for (const cell of row.cells) {
        while (occupied[rowIndex].has(column)) column++
        const width = cell.props?.colspan || 1, height = cell.props?.rowspan || 1
        if (column + width > 20 || rowIndex + height > result.rows.length) throw Error('合并单元格超出表格范围')
        for (let r = rowIndex; r < rowIndex + height; r++) for (let c = column; c < column + width; c++) {
          if (occupied[r].has(c)) throw Error('合并单元格重叠')
          occupied[r].add(c)
        }
        column += width; columns = Math.max(columns, column)
      }
      if (!occupied[rowIndex].size) throw Error('空表格行需要由上方合并单元格覆盖')
    }
    if (content.columnWidths !== undefined) {
      if (!Array.isArray(content.columnWidths) || content.columnWidths.length > 20 || content.columnWidths.some(width => width !== null && width !== undefined && (!Number.isFinite(width) || width < 0 || width > 10000))) throw Error('表格列宽无效')
      result.columnWidths = content.columnWidths.map(width => width ?? null)
    }
    for (const key of ['headerRows', 'headerCols']) if (content[key] !== undefined) {
      if (!Number.isInteger(content[key]) || content[key] < 0 || content[key] > (key === 'headerRows' ? content.rows.length : columns)) throw Error('表头无效')
      result[key] = content[key]
    }
    return result
  }
  const walk = (items, depth = 0) => {
    if (!Array.isArray(items) || depth > 12) throw Error('块最多嵌套 12 层')
    return items.map(block => {
      object(block, ['id', 'type', 'props', 'content', 'children'], 'BlockNote 块')
      if (typeof block.id !== 'string' || !idPattern.test(block.id) || ids.has(block.id) || ids.size >= 1000) throw Error('块 ID 重复、无效或超过 1000 个块')
      ids.add(block.id)
      if (!blockTypes.includes(block.type)) throw Error('不支持的 BlockNote 块类型：' + block.type)
      const props = block.props || {}
      object(props, [...(baseProps[block.type] || common), ...(propsByType[block.type] || [])], '块属性')
      for (const [key, value] of Object.entries(props)) {
        if (['checked', 'isToggleable', 'showPreview'].includes(key)) { if (typeof value !== 'boolean') throw Error('块状态必须是布尔值') }
        else if (['level', 'start', 'previewWidth'].includes(key)) { if (!Number.isFinite(value) || value < 0 || value > 100000 || key === 'level' && ![1, 2, 3, 4, 5, 6].includes(value)) throw Error('块数值属性无效') }
        else if (typeof value !== 'string' || value.length > 4096) throw Error('块文字属性无效')
        if (key === 'url') url(value, true)
        if (key === 'tone' && !['info', 'warning', 'success'].includes(value)) throw Error('提示框类型无效')
        if (key === 'textAlignment' && !['left', 'center', 'right', 'justify'].includes(value)) throw Error('对齐方式无效')
      }
      const result = { id: block.id, type: block.type, props: { ...props }, children: walk(block.children || [], depth + 1) }
      if (block.type === 'table') result.content = table(block.content)
      else if (['image', 'video', 'audio', 'file', 'divider', 'equation', 'tableOfContents'].includes(block.type)) {
        if (block.content !== undefined) throw Error('此块不接受文字正文')
      } else {
        result.content = inline(block.content || [])
        if (block.type === 'codeBlock' && result.content.some(item => item.type !== 'text' || Object.keys(item.styles).length)) throw Error('代码块只接受无样式的纯文本')
      }
      return result
    })
  }
  const result = { version: 1, blocks: walk(input.blocks) }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 1750000) throw Error('文档超过保存大小限制，请拆分笔记')
  return result
}
export const createBlock = (type = 'paragraph', text = '', id = crypto.randomUUID()) => {
  const block = { id, type, props: {}, children: [] }
  if (type === 'table') block.content = { type: 'tableContent', rows: Array.from({ length: 3 }, () => ({ cells: [[], [], []] })) }
  else if (['image', 'video', 'audio', 'file'].includes(type)) block.props.url = text
  else if (type === 'equation') block.props.expression = text
  else if (!['divider', 'tableOfContents'].includes(type)) block.content = [{ type: 'text', text, styles: {} }]
  return normalizeDocument({ version: 1, blocks: [block] }).blocks[0]
}
export function documentText(document) {
  const inline = items => items.map(item => item.type === 'link' ? inline(item.content) : item.type === 'pageLink' ? item.props.title || '页面引用' : item.type === 'math' ? item.props.expression : item.text).join('')
  const walk = blocks => blocks.flatMap(block => [
    block.type === 'table' ? block.content.rows.map(row => row.cells.map(cell => inline(Array.isArray(cell) ? cell : cell.content)).join('\t')).join('\n')
      : Array.isArray(block.content) ? inline(block.content) : block.props.expression || block.props.caption || block.props.name || '',
    ...walk(block.children),
  ])
  return walk(document.blocks).join('\n')
}
function visitReferences(document, visit) {
  const walk = value => {
    if (!value || typeof value !== 'object') return
    if (value.type === 'pageLink') visit(value.props)
    else for (const child of Object.values(value)) if (typeof child === 'object') walk(child)
  }
  walk(document)
}
export const blockNoteDocument = { normalize: normalizeDocument, create: createBlock, text: documentText,
  references(document) { const ids = new Set(); visitReferences(document, props => ids.add(props.noteId)); return [...ids] },
  remapReferences(document, ids) { const result = normalizeDocument(document); visitReferences(result, props => { if (Object.hasOwn(ids, props.noteId)) props.noteId = ids[props.noteId] }); return result },
}
