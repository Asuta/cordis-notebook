// Copy conversion, never an in-place rewrite. Every downgrade is reported and
// the original remains the authoritative lossless copy.
export function convertLegacy(document) {
  const warnings = new Set(), ids = new Set()
  const id = value => { const next = value && !ids.has(value) ? value : crypto.randomUUID(); ids.add(next); return next }
  const runs = items => (items || []).map(run => {
    const format = run.format || {}, styles = {}
    for (const key of ['bold', 'italic', 'underline', 'strike', 'code']) if (format[key]) styles[key] = true
    if (format.color) styles.textColor = format.color
    if (format.highlight) styles.backgroundColor = format.highlight
    if (format.font || format.size || format.superscript || format.subscript) warnings.add('部分字号、字体和上下标已按普通样式复制')
    const text = { type: 'text', text: run.text, styles }
    return format.link ? { type: 'link', href: format.link, content: [text] } : text
  })
  const plain = element => element.runs ? element.runs.map(run => run.text).join('') : element.kind === 'image' ? element.alt || element.src : (element.children || []).map(plain).join('\n')
  const inline = elements => elements.flatMap((element, index) => {
    if (!element.runs) warnings.add('表格中的复杂子块已按文字复制')
    return [...(index ? [{ type: 'text', text: '\n', styles: {} }] : []), ...(element.runs ? runs(element.runs) : [{ type: 'text', text: plain(element), styles: {} }])]
  })
  function elementBlocks(element) {
    const base = { id: id(element.id), props: {}, children: [] }
    if (element.align) base.props.textAlignment = element.align
    if (element.kind === 'image') return [{ ...base, type: 'image', props: { url: element.src, caption: element.alt || '', ...(element.width ? { previewWidth: element.width } : {}) } }]
    if (element.kind === 'rule') return [{ ...base, type: 'divider' }]
    if (element.kind === 'table') {
      if (element.children.some(row => row.children.some(cell => cell.width || cell.colwidth || cell.header))) warnings.add('表格列宽及部分表头样式由新编辑器重新布局')
      const rows = element.children.map(row => ({ cells: row.children.map(cell => ({ type: 'tableCell', props: { colspan: cell.colspan || 1, rowspan: cell.rowspan || 1 }, content: inline(cell.children) })) }))
      return [{ ...base, type: 'table', content: { type: 'tableContent', rows, ...(element.children[0]?.children.every(cell => cell.header) ? { headerRows: 1 } : {}) } }]
    }
    if (element.kind === 'list') return element.children.flatMap(item => {
      const blocks = item.children.flatMap(elementBlocks)
      if (!blocks.length) return []
      if (!Array.isArray(blocks[0].content)) blocks.unshift({ id: id(), type: 'paragraph', props: {}, content: [], children: [] })
      delete blocks[0].props.level
      blocks[0].type = element.ordered ? 'numberedListItem' : 'bulletListItem'
      blocks[0].children.push(...blocks.splice(1)); return blocks
    })
    if (element.kind === 'quote') {
      const blocks = element.children.flatMap(elementBlocks)
      if (blocks[0]?.content && Array.isArray(blocks[0].content)) { blocks[0].type = 'quote'; delete blocks[0].props.level; delete blocks[0].props.textAlignment }
      return blocks
    }
    const type = { heading: 'heading', code: 'codeBlock', paragraph: 'paragraph' }[element.kind]
    if (!type) throw Error('暂不能复制此正文结构：' + element.kind)
    if (type === 'codeBlock') {
      if (element.align || element.runs.some(run => Object.keys(run.format || {}).length)) warnings.add('代码块按纯文本复制')
      return [{ ...base, type, props: {}, content: [{ type: 'text', text: plain(element), styles: {} }] }]
    }
    return [{ ...base, type, ...(type === 'heading' ? { props: { ...base.props, level: element.level || 1 } } : {}), content: runs(element.runs) }]
  }
  const types = { paragraph: 'paragraph', heading: 'heading', bullet: 'bulletListItem', number: 'numberedListItem', todo: 'checkListItem', toggle: 'toggleListItem', quote: 'quote', callout: 'quote', code: 'codeBlock', divider: 'divider', image: 'image', table: 'table' }
  function convert(blocks) {
    return blocks.flatMap(block => {
      const body = block.body.elements.flatMap(elementBlocks)
      if (!body.length) throw Error('旧块正文为空')
      body[0].id = id(block.id)
      if (Array.isArray(body[0].content) && block.type !== 'paragraph') {
        body[0].type = types[block.type] || body[0].type
        if (body[0].type !== 'heading') delete body[0].props.level
        if (body[0].type === 'quote') delete body[0].props.textAlignment
      }
      if (block.type === 'todo') body[0].props.checked = !!block.checked
      if (block.type === 'callout') warnings.add('提示块已复制为引用块')
      if (block.collapsed) warnings.add('折叠块内容已保留，折叠状态由新编辑器管理')
      body[0].children.push(...convert(block.children || []))
      return body
    })
  }
  return { document: { version: 1, blocks: convert(document.blocks) }, warnings: [...warnings] }
}
