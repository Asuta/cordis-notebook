import { Fragment } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'

const isList = node => ['bulletList', 'orderedList'].includes(node.type.name)

// A temporary projection for moving across structural list boundaries. Stored
// documents remain trees; indentation is measured in the same 24px steps as Tab.
function rowsOf(scope, start) {
  const rows = []
  const visit = (node, pos, base, owner, top) => {
    if (isList(node)) {
      node.forEach((item, offset, index) => {
        const at = pos + 1 + offset, column = base + 1 + (item.attrs.indent || 0)
        const row = { node: item.firstChild, pos: at + 1, column,
          item, list: node, ordinal: (node.attrs.start || 1) + index, owner, top }
        rows.push(row)
        item.forEach((child, off, i) => { if (i) visit(child, at + 1 + off, column, row, top) })
      })
    } else rows.push({ node, pos, column: base + (node.attrs.indent || 0), owner, top })
  }
  scope.forEach((node, offset, top) => visit(node, start + offset, 0, null, top))
  // Include both actual children (including unindented detail paragraphs) and
  // visually indented descendants. A child can move past its former parent.
  for (let i = 0; i < rows.length; i++) {
    let end = i + 1
    for (; end < rows.length; end++) {
      let owner = rows[end].owner
      while (owner && owner !== rows[i]) owner = owner.owner
      if (!owner && rows[end].column <= rows[i].column) break
    }
    rows[i].end = end
  }
  return rows
}

function rebuild(rows) {
  const roots = [], stack = [], usedLists = new Set()
  const appendList = (children, row, item) => {
    let list = children.at(-1)
    if (!list?.list || list.source !== row.list) {
      const attrs = { ...row.list.attrs }
      if (usedLists.has(attrs.id)) attrs.id = crypto.randomUUID()
      usedLists.add(attrs.id)
      if (row.list.type.name === 'orderedList') attrs.start = row.ordinal
      list = { list: true, source: row.list, attrs, children: [] }
      children.push(list)
    }
    list.children.push(item)
  }
  for (const row of rows) {
    if (row.item) {
      while (stack.length && stack.at(-1).column >= row.column) stack.pop()
      // Do not turn unlimited visual indentation into an over-deep document.
      const parent = stack.length < 6 ? stack.at(-1) : stack[4]
      if (stack.length >= 6) stack.length = 5
      const item = { row, column: row.column, attrs: { ...row.item.attrs,
        indent: row.column - (parent?.column || 0) - 1 }, children: [row.node] }
      appendList(parent?.children || roots, row, item)
      stack.push(item)
    } else {
      while (stack.length && stack.at(-1).column > row.column) stack.pop()
      // Standalone paragraphs stay standalone. Detail paragraphs may follow a
      // different parent after moving, but retain their absolute text position.
      const parent = row.owner ? stack.at(-1) : null
      const node = row.node.type.create({ ...row.node.attrs,
        ...('indent' in row.node.attrs ? { indent: row.column - (parent?.column || 0) } : {}) },
      row.node.content, row.node.marks)
      ;(parent?.children || roots).push(node)
      if (!parent) stack.length = 0
    }
  }
  const materialize = value => value.list
    ? value.source.type.create(value.attrs, value.children.map(materialize))
    : value.row ? value.row.item.type.create(value.attrs, value.children.map(materialize)) : value
  return Fragment.fromArray(roots.map(materialize))
}

export function moveAcrossOutlineBoundary(state, direction) {
  const { $from, $to } = state.selection
  // Keep table cells and quotations intact; movement inside either stays there.
  const scopeAt = $pos => {
    for (let depth = $pos.depth; depth > 0; depth--)
      if (['tableCell', 'tableHeader', 'blockquote'].includes($pos.node(depth).type.name))
        return { node: $pos.node(depth), start: $pos.start(depth) }
    return { node: state.doc, start: 0 }
  }
  const scope = scopeAt($from), otherScope = scopeAt($to)
  if (scope.start !== otherScope.start || scope.node !== otherScope.node) return null
  const rows = rowsOf(scope.node, scope.start)
  const rowAt = pos => rows.findIndex(r => pos >= r.pos && pos < r.pos + r.node.nodeSize)
  const first = rowAt(state.selection.from)
  const last = rowAt(state.selection.empty ? state.selection.to : state.selection.to - 1)
  if (first < 0 || last < first) return null
  let end = last + 1
  for (let i = first; i <= last; i++) end = Math.max(end, rows[i].end)
  let before = first, after = end
  if (direction < 0) {
    if (!first) return null
    before--
    // Move past one visible row, not an expanded neighboring subtree. Hidden
    // descendants of a collapsed row are not available insertion targets.
    for (let i = before - 1; i >= 0; i--)
      if ((rows[i].item || rows[i].node).attrs.collapsed && rows[i].end > before && rows[i].end <= first) before = i
  } else {
    if (end === rows.length) return null
    after = (rows[end].item || rows[end].node).attrs.collapsed ? rows[end].end : end + 1
  }
  const reordered = direction < 0
    ? [...rows.slice(0, before), ...rows.slice(first, end), ...rows.slice(before, first), ...rows.slice(end)]
    : [...rows.slice(0, first), ...rows.slice(end, after), ...rows.slice(first, end), ...rows.slice(after)]
  // Only rebuild the top-level blocks touched by this exchange.
  const lowTop = rows[before].top, highTop = rows[after - 1].top
  let lo = scope.start, hi = lo
  scope.node.forEach((node, offset, index) => {
    if (index === lowTop) lo = scope.start + offset
    if (index === highTop) hi = scope.start + offset + node.nodeSize
  })
  const anchors = [state.selection.anchor, state.selection.head].map(pos => {
    const row = rows[rowAt(pos)] || rows[rowAt(pos - 1)]
    return { id: row.node.attrs.id, offset: pos - row.pos }
  })
  const content = rebuild(reordered.filter(r => r.top >= lowTop && r.top <= highTop))
  const tr = state.tr.replaceWith(lo, hi, content)
  const positions = new Map()
  tr.doc.descendants((node, pos) => { if (anchors.some(a => a.id === node.attrs.id)) positions.set(node.attrs.id, pos) })
  if (anchors.some(a => !positions.has(a.id))) return null
  tr.setSelection(TextSelection.create(tr.doc, ...anchors.map(a => positions.get(a.id) + a.offset)))
  return tr.scrollIntoView()
}
