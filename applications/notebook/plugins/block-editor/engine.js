import { Editor, Node, Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TextStyleKit } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import { TableKit } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import TextAlign from '@tiptap/extension-text-align'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import { Fragment, DOMParser as PMParser } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { locate, moveBlock, indentBlock, cloneBlock } from './tree.js'

// One editor/selection/history for the entire page. Structure is projected from
// the application's BlockDocument; no editor JSON escapes this module.
export function mountBlockEditor(element, service, rich, options) {
  let editor, applying = false, api
  const enabled = () => editor?.isEditable && !editor.view.composing
  const current = () => {
    const { $from } = editor.state.selection
    for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'pageBlock')
      return { id: $from.node(d).attrs.id, node: $from.node(d), pos: $from.before(d), offset: $from.pos - $from.start(d) }
    return null
  }
  const position = (doc, id) => {
    let result
    doc.descendants((node, pos) => { if (node.type.name === 'pageBlock' && node.attrs.id === id) result = { node, pos } })
    return result
  }
  const select = (tr, id, offset = 1) => {
    const found = position(tr.doc, id)
    if (found) tr.setSelection(TextSelection.near(tr.doc.resolve(found.pos + Math.min(found.node.content.size, Math.max(1, offset)) + 1)))
    return tr
  }
  const transact = (fn, focusId = current()?.id, offset = current()?.offset || 1) => {
    if (!enabled()) return false
    try {
      const doc = service.fromEditor(editor.getJSON())
      if (fn(doc) === false) return false
      const next = editor.schema.nodeFromJSON(service.toEditor(doc))
      const tr = closeHistory(editor.state.tr).replaceWith(0, editor.state.doc.content.size, next.content)
      select(tr, focusId, offset)
      editor.view.dispatch(tr.scrollIntoView()); editor.view.focus()
      return true
    } catch (error) { options.error?.(error); return false }
  }
  const metadata = Extension.create({
    name: 'blockMetadata',
    addGlobalAttributes() {
      return [{ types: ['paragraph', 'heading', 'blockquote', 'codeBlock', 'bulletList', 'orderedList', 'listItem', 'horizontalRule', 'image', 'table', 'tableRow', 'tableCell', 'tableHeader'],
        attributes: { id: { default: null, parseHTML: () => null, renderHTML: () => ({}) } } }]
    },
    addProseMirrorPlugins() {
      return [new Plugin({
        filterTransaction(tr) {
          if (!tr.docChanged || applying) return true
          try { service.fromEditor(repairJSON(tr.doc.toJSON())); return true }
          catch (error) { options.error?.(error); return false }
        },
        appendTransaction(transactions, old, state) {
          if (!transactions.some(t => t.docChanged)) return null
          const ids = new Set(), tr = state.tr
          state.doc.descendants((node, pos) => {
            if (node.isText || node.type.name === 'blockChildren' || !('id' in node.attrs)) return
            let id = node.attrs.id
            if (!id || ids.has(id)) id = crypto.randomUUID()
            ids.add(id)
            if (id !== node.attrs.id) tr.setNodeMarkup(pos, undefined, { ...node.attrs, id })
          })
          return tr.steps.length ? tr : null
        },
      })]
    },
  })
  const block = Node.create({
    name: 'pageBlock', content: 'block+ blockChildren?', defining: true,
    addAttributes: () => ({ id: { default: null }, kind: { default: 'paragraph' }, checked: { default: false }, collapsed: { default: false } }),
    parseHTML: () => [{ tag: 'section[data-page-block]', getAttrs: e => ({ id: null, kind: e.dataset.kind || 'paragraph', checked: e.dataset.checked === 'true', collapsed: false }), contentElement: '.block-content' }],
    renderHTML: ({ node }) => ['section', { 'data-page-block': '', 'data-kind': node.attrs.kind, 'data-checked': String(node.attrs.checked) }, ['div', { class: 'block-content' }, 0]],
    addNodeView() {
      return ({ node, getPos }) => {
        const dom = document.createElement('section'), rail = document.createElement('div'), contentDOM = document.createElement('div')
        dom.className = 'page-block'; rail.className = 'block-rail'; rail.contentEditable = 'false'; contentDOM.className = 'block-content'
        const button = (label, text, action) => {
          const b = document.createElement('button'); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); b.textContent = text
          b.onmousedown = e => e.preventDefault()
          b.onclick = e => { e.preventDefault(); e.stopPropagation(); if (enabled()) action(node.attrs.id, b) }
          rail.append(b); return b
        }
        button('在下方添加块', '+', id => options.menu?.(id, 'insert'))
        const handle = button('块操作（拖动可排序）', '⠿', id => options.menu?.(id, 'actions'))
        handle.draggable = true
        handle.ondragstart = e => {
          if (!enabled()) { e.preventDefault(); return }
          e.stopPropagation(); options.drag?.(node.attrs.id, e)
        }
        const marker = document.createElement('button'); marker.type = 'button'; marker.className = 'block-marker'; marker.contentEditable = 'false'
        marker.onmousedown = e => e.preventDefault()
        marker.onclick = () => {
          if (!enabled()) return
          api.toggle(node.attrs.id)
        }
        dom.append(rail, marker, contentDOM)
        const paint = () => {
          dom.dataset.blockId = node.attrs.id || ''; dom.dataset.kind = node.attrs.kind
          dom.dataset.checked = String(node.attrs.checked); dom.dataset.collapsed = String(node.attrs.collapsed)
          marker.textContent = node.attrs.kind === 'todo' ? (node.attrs.checked ? '✓' : '') : node.attrs.kind === 'toggle' ? (node.attrs.collapsed ? '▸' : '▾') : node.attrs.kind === 'bullet' ? '•' : node.attrs.kind === 'callout' ? '✦' : ''
          marker.setAttribute('aria-label', node.attrs.kind === 'todo' ? '切换待办状态' : '折叠或展开子块')
          marker.tabIndex = ['todo', 'toggle'].includes(node.attrs.kind) ? 0 : -1
          if (node.attrs.kind === 'todo') { marker.setAttribute('role', 'checkbox'); marker.setAttribute('aria-checked', String(node.attrs.checked)); marker.removeAttribute('aria-expanded') }
          else { marker.removeAttribute('role'); marker.removeAttribute('aria-checked'); marker.setAttribute('aria-expanded', String(!node.attrs.collapsed)) }
        }
        paint()
        return { dom, contentDOM,
          update(next) { if (next.type !== node.type) return false; node = next; paint(); return true },
          stopEvent: e => rail.contains(e.target) || marker.contains(e.target),
          ignoreMutation: m => m.type !== 'selection' && !contentDOM.contains(m.target) && m.target !== contentDOM,
        }
      }
    },
  })
  function repairJSON(json) {
    const ids = new Set()
    const visit = n => {
      if (n.type === 'pageBlock') {
        n.attrs ||= {}
        if (!n.attrs.id || ids.has(n.attrs.id)) n.attrs.id = crypto.randomUUID()
        ids.add(n.attrs.id)
      }
      n.content?.forEach(visit)
    }
    visit(json); return json
  }
  editor = new Editor({
    element, content: service.toEditor(options.document), editable: options.editable !== false,
    extensions: [Node.create({ name: 'doc', topNode: true, content: 'pageBlock+' }), block,
      Node.create({ name: 'blockChildren', content: 'pageBlock+', parseHTML: () => [{ tag: 'div[data-block-children]' }], renderHTML: () => ['div', { 'data-block-children': '', class: 'block-children' }, 0] }),
      StarterKit.configure({ document: false, link: { openOnClick: false }, dropcursor: false, gapcursor: false }),
      TextStyleKit, Highlight.configure({ multicolor: true }), TableKit, Image, Subscript, Superscript,
      TextAlign.configure({ types: ['paragraph', 'heading'] }), metadata],
    editorProps: {
      attributes: { class: 'block-page-prose', spellcheck: 'false', role: 'textbox', 'aria-label': '块页面正文', 'aria-multiline': 'true' },
      handleKeyDown(view, event) {
        if (event.isComposing || !enabled()) return false
        if (options.keydown?.(event)) return true
        const mod = event.metaKey || event.ctrlKey
        if (event.key === 'Tab') { event.preventDefault(); return editor.isActive('table') ? (event.shiftKey ? editor.commands.goToPreviousCell() : editor.commands.goToNextCell()) : (api.indent(event.shiftKey ? -1 : 1), true) }
        if (event.altKey && event.shiftKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) { api.shift(event.key === 'ArrowUp' ? -1 : 1); return true }
        if (mod && event.shiftKey && event.key.toLowerCase() === 'd') { api.duplicate(); return true }
        if (mod && event.key.toLowerCase() === 'k') { options.link?.(); return true }
        if (mod && event.key === 'Enter') { api.toggle(); return true }
        if (event.key === 'Enter' && !event.shiftKey && !editor.isActive('table') && !editor.isActive('listItem') && !editor.isActive('codeBlock')) return api.split()
        if (event.key === 'Backspace' && view.state.selection.empty && view.state.selection.$from.parentOffset === 0) return api.backspace()
        return false
      },
      handlePaste(view, event) {
        if (!enabled()) return false
        const files = [...(event.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'))
        const html = event.clipboardData?.getData('text/html'), text = event.clipboardData?.getData('text/plain') || ''
        if (files.length && !text.trim() && !html) { options.images?.(files); return true }
        try {
          if (html) {
            const dom = new DOMParser().parseFromString(html, 'text/html')
            dom.querySelectorAll('script,style').forEach(e => e.remove())
            for (const image of dom.querySelectorAll('img')) {
              if (!image.closest('section[data-page-block]')) { image.remove(); continue }
              // Internal copies may reference uploaded assets only; use the same
              // document validator as persistence rather than trusting clipboard HTML.
              try { rich.normalize({ version: 1, elements: [{ id: 'clipboard-image', kind: 'image', src: image.getAttribute('src') }] }) }
              catch { image.remove() }
            }
            const slice = PMParser.fromSchema(editor.schema).parseSlice(dom.body)
            // Internal block copies keep hierarchy and acquire fresh IDs.
            const json = slice.content.toJSON() || []
            if (json.some(n => n.type === 'pageBlock')) {
              const doc = service.fromEditor(repairJSON({ type: 'doc', content: json.filter(n => n.type === 'pageBlock') }))
              api.insertBlocks(doc.blocks.map(cloneBlock)); return true
            }
            if (json.length > 1 || json.some(n => !['paragraph', 'text'].includes(n.type))) {
              const body = rich.fromEditor({ type: 'doc', content: json })
              api.insertBlocks(body.elements.map(el => fromOutline(el))); return true
            }
          }
          if (!html && text.includes('\n')) { api.insertBlocks(text.split(/\r?\n/).map(line => service.create('paragraph', line))); return true }
        } catch (error) { options.error?.(error); return true }
        return false
      },
      handleDrop(view, event) {
        if (options.drop?.(event)) return true
        const files = [...(event.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'))
        if (files.length) { if (enabled()) options.images?.(files); return true }
        return false
      },
    },
    onUpdate: () => { if (!applying) options.change(service.fromEditor(editor.getJSON())) },
    onSelectionUpdate: () => options.selection?.(),
  })
  function fromOutline(el) {
    return { ...service.create(), type: { heading: 'heading', code: 'code', rule: 'divider', image: 'image', table: 'table', quote: 'quote' }[el.kind] || 'paragraph', body: { version: 1, elements: [el] } }
  }
  api = {
    editor, current,
    get document() { return service.fromEditor(editor.getJSON()) },
    focus(id, offset = 1) { editor.view.dispatch(select(editor.state.tr, id, offset)); editor.view.focus() },
    setEditable(value) { editor.setEditable(value, false) },
    destroy() { editor.destroy() },
    setDocument(doc) {
      applying = true
      try { editor.commands.setContent(service.toEditor(doc), { emitUpdate: false }) } finally { applying = false }
    },
    convert(type, level = 1, id = current()?.id) {
      return transact(doc => {
        const block = locate(doc.blocks, id)?.block
        if (!block) return false
        const text = rich.text(block.body), runs = block.body.elements[0]?.runs || [{ text }]
        block.type = type; block.collapsed = false; block.checked = false
        if (type === 'table') block.body = { version: 1, elements: [{ id: `${id}-table`, kind: 'table', children: Array.from({ length: 3 }, (_, r) => ({ id: `${id}-r${r}`, kind: 'row', children: Array.from({ length: 3 }, (_, c) => ({ id: `${id}-r${r}c${c}`, kind: 'cell', children: [{ id: `${id}-r${r}c${c}p`, kind: 'paragraph', runs: [{ text: r === 0 && c === 0 ? text : '' }] }] })) })) }] }
        else {
          const kind = { heading: 'heading', code: 'code', divider: 'rule' }[type] || 'paragraph'
          // Converting a complex body preserves all text rather than only its first paragraph.
          block.body = rich.normalize({ version: 1, elements: [{ id: `${id}-body`, kind, level,
            runs: kind === 'code' || block.body.elements.length !== 1 || !block.body.elements[0].runs ? [{ text }] : runs }] })
        }
      }, id)
    },
    toggle(id = current()?.id) {
      return transact(doc => {
        const b = locate(doc.blocks, id)?.block
        if (!b) return false
        if (b.type === 'todo') b.checked = !b.checked
        else if (b.type === 'toggle') b.collapsed = !b.collapsed
        else return false
      }, id, 1)
    },
    add(type = 'paragraph', after = current()?.id) {
      const b = service.create(type)
      return transact(doc => { const found = locate(doc.blocks, after); if (found) found.siblings.splice(found.index + 1, 0, b); else doc.blocks.push(b) }, b.id, 1)
    },
    duplicate(id = current()?.id) {
      let next
      const doc = api.document, found = locate(doc.blocks, id)
      if (!found) return false
      next = cloneBlock(found.block)
      return transact(doc => { const f = locate(doc.blocks, id); f.siblings.splice(f.index + 1, 0, next) }, next.id, 1)
    },
    remove(id = current()?.id) {
      const doc = api.document, f = locate(doc.blocks, id)
      if (!f) return false
      return transact(doc => { const f = locate(doc.blocks, id); f.siblings.splice(f.index, 1); if (!doc.blocks.length) doc.blocks.push(service.create()) }, f.siblings[f.index - 1]?.id || f.parent?.id || doc.blocks[0]?.id, 1)
    },
    move(id, target, place) { return transact(doc => moveBlock(doc, id, target, place), id, 1) },
    shift(direction, id = current()?.id) {
      return transact(doc => { const f = locate(doc.blocks, id), target = f?.siblings[f.index + direction]; return target ? moveBlock(doc, id, target.id, direction < 0 ? 'before' : 'after') : false }, id)
    },
    indent(direction, id = current()?.id) { return transact(doc => indentBlock(doc, id, direction), id) },
    split() {
      const c = current(), sel = editor.state.selection
      if (!c || !sel.$from.sameParent(sel.$to)) return false
      const body = c.node.firstChild
      if (!body.isTextblock || sel.$from.node() !== body || sel.$to.node() !== body) return false
      const f = locate(api.document.blocks, c.id)
      if (!body.textContent && f.block.type !== 'paragraph' && !['image', 'table', 'divider'].includes(f.block.type)) return api.convert('paragraph')
      if (!body.textContent && f.parent) return api.indent(-1)
      const from = sel.$from.parentOffset, to = sel.$to.parentOffset
      const before = body.cut(0, from), after = body.cut(to)
      const next = service.create(['bullet', 'number', 'todo'].includes(f.block.type) ? f.block.type : 'paragraph')
      next.body = rich.fromEditor({ type: 'doc', content: [{ type: 'paragraph', content: after.toJSON().content || [] }] })
      return transact(doc => {
        const found = locate(doc.blocks, c.id)
        found.block.body = rich.fromEditor({ type: 'doc', content: [before.toJSON()] })
        // Following paragraphs belong after the split, while existing children stay with their parent.
        next.body.elements.push(...f.block.body.elements.slice(1))
        found.siblings.splice(found.index + 1, 0, next)
      }, next.id, 1)
    },
    backspace() {
      const c = current(), sel = editor.state.selection
      if (!c || c.offset !== 1) return false
      const f = locate(api.document.blocks, c.id)
      if (f.parent) return api.indent(-1)
      if (f.block.type !== 'paragraph') return api.convert('paragraph')
      const prev = f.siblings[f.index - 1]
      if (!prev || prev.children.length || prev.body.elements.length !== 1 || f.block.body.elements.length !== 1 || !prev.body.elements[0].runs || !f.block.body.elements[0].runs) return true
      const offset = rich.toEditor(prev.body).content[0].content?.reduce((n, r) => n + (r.text?.length || 1), 0) || 0
      return transact(doc => {
        const a = locate(doc.blocks, prev.id).block, b = locate(doc.blocks, c.id)
        a.body.elements[0].runs.push(...b.block.body.elements[0].runs); a.children.push(...b.block.children)
        b.siblings.splice(b.index, 1)
      }, prev.id, offset + 1)
    },
    insertBlocks(blocks) {
      if (!blocks.length) return false
      const c = current(), selection = editor.state.selection
      // Split the current text at the caret; pasted blocks never discard a suffix.
      if (c && selection.$from.sameParent(selection.$to) && selection.$from.node() === c.node.firstChild && c.node.firstChild.isTextblock) {
        const body = c.node.firstChild, from = selection.$from.parentOffset, to = selection.$to.parentOffset
        const following = c.node.toJSON().content.slice(1).filter(n => n.type !== 'blockChildren')
        return transact(doc => {
          const f = locate(doc.blocks, c.id), before = body.cut(0, from), after = body.cut(to), inserted = []
          if (before.content.size) { f.block.body = rich.fromEditor({ type: 'doc', content: [before.toJSON()] }); inserted.push(f.block) }
          inserted.push(...blocks)
          if (after.content.size || following.length) inserted.push({ ...service.create(), body: rich.fromEditor({ type: 'doc', content: [after.toJSON(), ...following] }) })
          if (!inserted.includes(f.block)) inserted.at(-1).children.push(...f.block.children)
          f.siblings.splice(f.index, 1, ...inserted)
        }, blocks.at(-1).id, 1)
      }
      if (!selection.empty) { options.error?.(Error('请将光标放在一个块内再粘贴多块内容')); return false }
      return transact(doc => { const f = locate(doc.blocks, c?.id); if (f) f.siblings.splice(f.index + 1, 0, ...blocks); else doc.blocks.push(...blocks) }, blocks.at(-1).id, 1)
    },
    captureSelection() {
      const { from, to } = editor.state.selection
      if (from === to) return null
      const { $from, $to } = editor.state.selection
      if (!$from.sameParent($to) || !$from.parent.isTextblock) return null
      const content = rich.fromEditor({ type: 'doc', content: [{ type: $from.parent.type.name, attrs: $from.parent.attrs,
        content: editor.state.doc.slice(from, to).content.toJSON() }] })
      return { from, to, text: editor.state.doc.textBetween(from, to, '\n'), document: JSON.stringify(editor.getJSON()), content }
    },
    replaceSelection(snapshot, value) {
      if (!enabled() || JSON.stringify(editor.getJSON()) !== snapshot.document) throw Error('选区已变化，请重新添加')
      const { from, to } = snapshot, start = editor.state.doc.resolve(from), end = editor.state.doc.resolve(to)
      if (!start.sameParent(end)) throw Error('跨块替换请使用 notebook_update；富文本选区替换支持同一段落')
      let content
      if (typeof value === 'string') content = value ? Fragment.from(editor.schema.text(value, editor.state.doc.resolve(from).marks())) : Fragment.empty
      else {
        const normalized = rich.normalize(value)
        if (normalized.elements.length !== 1 || !normalized.elements[0].runs) throw Error('选区替换请提供单段富文本；结构修改请使用 notebook_update')
        content = Fragment.fromArray((rich.toEditor(normalized).content[0].content || []).map(n => editor.schema.nodeFromJSON(n)))
      }
      const tr = closeHistory(editor.state.tr).replaceWith(from, to, content)
      service.fromEditor(tr.doc.toJSON())
      editor.view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(from + content.size))))
      return true
    },
  }
  return api
}
