// Application-owned document model, inspired by MS-ONE outlines and text runs.
// It is deliberately independent of both the .one binary encoding and Tiptap JSON.
const textTypes = new Set(['paragraph', 'heading', 'code'])
const childrenTypes = {
  quote: ['paragraph', 'heading', 'code', 'list', 'quote', 'image'],
  list: ['item'],
  item: ['paragraph', 'heading', 'list', 'quote', 'image'],
  table: ['row'],
  row: ['cell'],
  cell: ['paragraph', 'heading', 'list', 'quote', 'image', 'code'],
}
const blockTypes = ['paragraph', 'heading', 'code', 'quote', 'list', 'table', 'image', 'rule']
const color = (value) =>
  typeof value === 'string' && /^(#[0-9a-f]{3,8}|rgb\([\d\s,.%]+\))$/i.test(value) ? value : undefined
export const safeLink = (value) =>
  typeof value === 'string' && /^(https?:\/\/|mailto:|#)/i.test(value.trim()) ? value.trim().slice(0, 4096) : null
export const safeImage = (value) =>
  typeof value === 'string' && /^\/api\/note-assets\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(value) ? value : null
const number = (v, min, max, fallback) => (Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback)
export function normalizeDocument(input) {
  if (!input || input.version !== 1 || !Array.isArray(input.elements)) throw Error('富文本文档版本或结构无效')
  let count = 0,
    length = 0
  const ids = new Set()
  const read = (items, allowed, depth = 0) => {
    if (!Array.isArray(items) || depth > 16) throw Error('富文本层级过深或内容无效')
    return items.map((value, index) => {
      if (++count > 10000 || !value || !allowed.includes(value.kind)) throw Error('富文本节点类型或数量无效')
      let id = typeof value.id === 'string' && /^[\w:-]{1,100}$/.test(value.id) ? value.id : `element-${count}`
      if (ids.has(id)) id = `${id.slice(0, 80)}-${count}-${index}`
      ids.add(id)
      const node = { id, kind: value.kind }
      if (textTypes.has(node.kind)) {
        node.indent = Math.round(number(value.indent, 0, 8, 0))
        node.align = ['left', 'center', 'right', 'justify'].includes(value.align) ? value.align : 'left'
        node.tag = ['todo', 'important', 'question', 'definition', 'idea'].includes(value.tag) ? value.tag : null
        node.checked = !!value.checked
        node.collapsed = !!value.collapsed
        if (node.kind === 'heading') node.level = Math.round(number(value.level, 1, 6, 1))
        if (!Array.isArray(value.runs)) throw Error('段落缺少文字片段')
        node.runs = value.runs.map((run) => {
          if (++count > 10000 || typeof run?.text !== 'string') throw Error('文字片段无效')
          length += run.text.length
          if (length > 200000) throw Error('笔记内容过长')
          const format = {},
            source = run.format || {}
          for (const key of ['bold', 'italic', 'underline', 'strike', 'superscript', 'subscript', 'code'])
            if (source[key]) format[key] = true
          for (const key of ['color', 'highlight']) if (color(source[key])) format[key] = color(source[key])
          if (typeof source.font === 'string' && /^[\p{L}\p{N} ,_-]{1,100}$/u.test(source.font))
            format.font = source.font
          if (source.size !== undefined) format.size = number(source.size, 8, 96, 12)
          if (safeLink(source.link)) format.link = safeLink(source.link)
          return { text: run.text, ...(Object.keys(format).length ? { format } : {}) }
        })
      } else if (childrenTypes[node.kind]) {
        node.children = read(value.children, childrenTypes[node.kind], depth + 1)
        if (!node.children.length) throw Error('列表或表格不能缺少子节点')
        if (node.kind === 'list') {
          node.ordered = !!value.ordered
          node.start = Math.round(number(value.start, 1, 100000, 1))
        }
        if (node.kind === 'cell') {
          node.header = !!value.header
          node.colspan = Math.round(number(value.colspan, 1, 20, 1))
          node.rowspan = Math.round(number(value.rowspan, 1, 100, 1))
          if (Array.isArray(value.widths) && value.widths.length === node.colspan)
            node.widths = value.widths.map((w) => Math.round(number(w, 25, 2000, 100)))
        }
        if (node.kind === 'table') {
          if (
            node.children.length > 100 ||
            node.children.some((row) => row.children.reduce((n, c) => n + c.colspan, 0) > 20)
          )
            throw Error('表格最多 100 行、20 列')
        }
      } else if (node.kind === 'image') {
        if (!safeImage(value.src)) throw Error('图片必须先保存到本地资源库')
        node.src = value.src
        node.alt = String(value.alt || '').slice(0, 500)
        if (value.width != null) node.width = number(value.width, 24, 4000, 320)
        if (value.height != null) node.height = number(value.height, 24, 4000, 240)
      }
      return node
    })
  }
  return { version: 1, elements: read(input.elements, blockTypes) }
}
export function plainDocument(text = '', prefix = 'p') {
  return normalizeDocument({
    version: 1,
    elements: text.split('\n').map((text, i) => ({ id: `${prefix}-${i}`, kind: 'paragraph', runs: [{ text }] })),
  })
}
export function documentText(doc) {
  const text = (node) =>
    node.runs
      ? node.runs.map((r) => r.text).join('')
      : node.kind === 'image'
        ? node.alt || ''
        : (node.children || []).map(text).join(node.kind === 'row' ? '\t' : '\n')
  return doc.elements.map(text).join('\n')
}
const toType = {
  paragraph: 'paragraph',
  heading: 'heading',
  code: 'codeBlock',
  quote: 'blockquote',
  list: 'bulletList',
  item: 'listItem',
  table: 'table',
  row: 'tableRow',
  cell: 'tableCell',
  image: 'image',
  rule: 'horizontalRule',
}
export function toEditor(doc) {
  const node = (n) => {
    const attrs = {
      id: n.id,
      indent: n.indent || 0,
      textAlign: n.align || 'left',
      noteTag: n.tag || null,
      checked: !!n.checked,
      collapsed: !!n.collapsed,
    }
    if (n.kind === 'heading') attrs.level = n.level
    if (n.kind === 'list') attrs.start = n.start
    if (n.kind === 'cell') Object.assign(attrs, { colspan: n.colspan, rowspan: n.rowspan, colwidth: n.widths || null })
    if (n.kind === 'image') Object.assign(attrs, { src: n.src, alt: n.alt, width: n.width, height: n.height })
    const content = n.runs
      ? n.runs.flatMap((r) => {
          const f = r.format || {},
            marks = []
          for (const key of ['bold', 'italic', 'underline', 'strike', 'superscript', 'subscript', 'code'])
            if (f[key]) marks.push({ type: key })
          if (f.link) marks.push({ type: 'link', attrs: { href: f.link } })
          if (f.highlight) marks.push({ type: 'highlight', attrs: { color: f.highlight } })
          if (f.font || f.size || f.color)
            marks.push({
              type: 'textStyle',
              attrs: { fontFamily: f.font, fontSize: f.size ? `${f.size}pt` : null, color: f.color },
            })
          return r.text
            .split('\n')
            .flatMap((text, i) => [
              ...(i ? [{ type: 'hardBreak' }] : []),
              ...(text ? [{ type: 'text', text, marks }] : []),
            ])
        })
      : n.children?.map(node)
    if (n.kind === 'code')
      return {
        type: 'codeBlock',
        attrs,
        content: n.runs.map((r) => r.text).join('') ? [{ type: 'text', text: n.runs.map((r) => r.text).join('') }] : [],
      }
    return {
      type:
        n.kind === 'list' && n.ordered ? 'orderedList' : n.kind === 'cell' && n.header ? 'tableHeader' : toType[n.kind],
      attrs,
      ...(content ? { content } : {}),
    }
  }
  return { type: 'doc', content: doc.elements.length ? doc.elements.map(node) : [{ type: 'paragraph' }] }
}
export function fromEditor(json) {
  const types = Object.fromEntries(Object.entries(toType).map(([a, b]) => [b, a]))
  types.orderedList = 'list'
  types.tableHeader = 'cell'
  const node = (n) => {
    const a = n.attrs || {},
      kind = types[n.type]
    if (!kind) throw Error('不支持的编辑器内容：' + n.type)
    const value = {
      id: a.id,
      kind,
      indent: a.indent,
      align: a.textAlign,
      tag: a.noteTag,
      checked: a.checked,
      collapsed: a.collapsed,
      level: a.level,
    }
    if (textTypes.has(kind))
      value.runs = (n.content || []).map((r) => {
        const format = {}
        for (const m of r.marks || []) {
          if (m.type === 'textStyle') {
            format.font = m.attrs?.fontFamily?.replace(/["']/g, '')
            format.size = m.attrs?.fontSize
              ? parseFloat(m.attrs.fontSize) * (String(m.attrs.fontSize).endsWith('px') ? 0.75 : 1)
              : undefined
            format.color = m.attrs?.color
          } else if (m.type === 'link') format.link = m.attrs?.href
          else if (m.type === 'highlight') format.highlight = m.attrs?.color || '#fff59d'
          else format[m.type] = true
        }
        return { text: r.type === 'hardBreak' ? '\n' : r.text || '', format }
      })
    else if (childrenTypes[kind]) value.children = (n.content || []).map(node)
    if (kind === 'list') {
      value.ordered = n.type === 'orderedList'
      value.start = a.start
    }
    if (kind === 'cell')
      Object.assign(value, {
        header: n.type === 'tableHeader',
        colspan: a.colspan,
        rowspan: a.rowspan,
        widths: a.colwidth,
      })
    if (kind === 'image') Object.assign(value, { src: a.src, alt: a.alt, width: a.width, height: a.height })
    return value
  }
  return normalizeDocument({ version: 1, elements: (json.content || []).map(node) })
}
export const documentService = {
  normalize: normalizeDocument,
  plain: plainDocument,
  text: documentText,
  toEditor,
  fromEditor,
}
