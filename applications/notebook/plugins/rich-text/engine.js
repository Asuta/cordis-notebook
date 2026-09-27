import { Editor, Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TextStyleKit } from '@tiptap/extension-text-style'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import { TableKit } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import { Plugin, TextSelection, NodeSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { toEditor, fromEditor, safeLink, safeImage, normalizeIndent } from './document.js'
import { outlineEntries, selectedOutline } from './outline.js'
import { moveAcrossOutlineBoundary } from './outline-move.js'
import { readableInk } from './colors.js'
import { createListShortcut } from './list-shortcut.js'

const uid = () => crypto.randomUUID()
const elementTypes = [
  'paragraph',
  'heading',
  'codeBlock',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'image',
  'horizontalRule',
]
export function mountEditor(owner, element, options) {
  let applying = false,
    selectAllCount = 0,
    editor
  let appearance = options.appearance
  const paragraphCommand = (fn) => {
    const { state, view } = editor,
      tr = state.tr,
      { from, to } = state.selection
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (['paragraph', 'heading', 'codeBlock'].includes(node.type.name)) fn(node, pos, tr)
    })
    view.dispatch(tr)
    return true
  }
  const selectedItems = () => {
    const { doc, selection: { from, to } } = editor.state, items = new Map()
    doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return
      const at = doc.resolve(pos)
      for (let d = at.depth; d > 0; d--) if (at.node(d).type.name === 'listItem') {
        items.set(at.before(d), at.node(d))
        break
      }
    })
    return items
  }
  const indent = (delta) => {
    if (editor.isActive('listItem')) {
      const items = selectedItems(), extra = [...items.values()].some(n => n.attrs.indent > 0)
      // Keep normal list hierarchy where possible, but do not require a previous sibling
      // or manufacture empty parent items to indent the first/only item repeatedly.
      let room = true
      editor.state.doc.descendants((n, pos) => {
        if (!n.isText && editor.state.doc.resolve(pos).depth > 14) room = false
      })
      if (!extra && delta > 0 && room && editor.commands.sinkListItem('listItem')) return true
      if (!extra && delta < 0) return editor.commands.liftListItem('listItem')
      const tr = editor.state.tr
      for (const [pos, node] of items) tr.setNodeMarkup(pos, undefined,
        { ...node.attrs, indent: normalizeIndent((node.attrs.indent || 0) + delta) })
      editor.view.dispatch(tr)
      return true
    }
    return paragraphCommand((n, p, tr) =>
      tr.setNodeMarkup(p, undefined, { ...n.attrs, indent: normalizeIndent((n.attrs.indent || 0) + delta) }),
    )
  }
  const backspaceIndent = () => {
    const { empty, $from } = editor.state.selection
    if (!empty || $from.parentOffset !== 0 || !$from.parent.isTextblock) return false
    if ($from.parent.attrs.indent > 0) return paragraphCommand((n, p, tr) =>
      tr.setNodeMarkup(p, undefined, { ...n.attrs, indent: Math.max(0, (n.attrs.indent || 0) - 1) }))
    // Only lift at the beginning of an item; later paragraphs should merge normally.
    if ($from.depth > 1 && $from.node(-1).type.name === 'listItem' && $from.index(-1) === 0)
      return indent(-1)
    return false
  }
  const tag = (value) =>
    paragraphCommand((n, p, tr) =>
      tr.setNodeMarkup(p, undefined, { ...n.attrs, noteTag: n.attrs.noteTag === value ? null : value, checked: false }),
    )
  const toggleList = (ordered) => {
    const chain = editor.chain().focus(), selected = new Map()
    const baseIndent = at => {
      let base = 0
      for (let depth = 1; depth <= at.depth; depth++) {
        const node = at.node(depth)
        if (['bulletList', 'orderedList'].includes(node.type.name)) base++
        if (node.type.name === 'listItem') base += node.attrs.indent || 0
      }
      return base
    }
    editor.state.doc.nodesBetween(editor.state.selection.from, editor.state.selection.to, (node, pos) => {
      if (!node.isTextblock) return
      const at = editor.state.doc.resolve(pos)
      selected.set(node.attrs.id, { column: Math.max(1, baseIndent(at) + (node.attrs.indent || 0)),
        collapsed: node.attrs.collapsed || (at.parent.firstChild === node && at.parent.attrs.collapsed) })
    })
    chain[ordered ? 'toggleOrderedList' : 'toggleBulletList']()
    return chain.command(({ tr }) => {
      // The list marker consumes one existing indentation step. Removing the
      // marker also preserves the text position, including after a nested lift.
      tr.doc.descendants((node, pos) => {
        const target = selected.get(node.attrs.id)
        if (!node.isTextblock || !target) return
        const at = tr.doc.resolve(pos), parent = at.parent
        if (parent.type.name === 'listItem' && at.index() === 0) {
          tr.setNodeMarkup(at.before(), undefined, { ...parent.attrs,
            indent: normalizeIndent(target.column - baseIndent(at) + (parent.attrs.indent || 0)),
            collapsed: !!target.collapsed })
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: 0, collapsed: false })
        } else tr.setNodeMarkup(pos, undefined, { ...node.attrs,
          indent: normalizeIndent(target.column - baseIndent(at)), collapsed: !!target.collapsed })
      })
      return true
    }).run()
  }
  const periodShortcut = createListShortcut({
    toggle: () => { options.boundary?.(); toggleList(false) },
    composing: () => editor.view.composing,
    editable: () => editor.isEditable,
  })
  const tableAtCursor = () => {
    const { $from } = editor.state.selection
    for (let depth = $from.depth; depth > 0; depth--)
      if ($from.node(depth).type.name === 'table') return { node: $from.node(depth), pos: $from.before(depth) }
    return null
  }
  const selectTable = (pos = tableAtCursor()?.pos) => {
    if (pos == null) return false
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)))
    editor.view.focus()
    return true
  }
  const deleteObject = () => {
    if (!editor.isEditable) return false
    const selection = editor.state.selection
    if (selection instanceof NodeSelection && ['table', 'image', 'horizontalRule'].includes(selection.node.type.name)) {
      options.boundary?.()
      return editor.commands.deleteSelection()
    }
    const table = selection.empty && tableAtCursor()
    if (!table) return false
    let content = false
    table.node.descendants(node => {
      if (node.isLeaf || node.attrs.noteTag) content = true
    })
    if (content) return false
    // An entirely empty table has no text to delete. Nonempty tables retain
    // normal text/cell deletion until the user selects the whole table.
    options.boundary?.()
    return editor.commands.deleteTable()
  }
  const moveParagraph = (direction) => {
    const { state, view } = editor
    const selected = selectedOutline(outlineEntries(state.doc), state.selection)
    const crossBoundary = () => {
      const tr = moveAcrossOutlineBoundary(state, direction)
      if (!tr) return false
      view.dispatch(tr)
      return true
    }
    if (!selected.length) return crossBoundary()
    const first = selected[0], last = selected.at(-1)
    const siblings = first.group.filter(e => e.parent === first.parent && e.indent === first.indent)
    const other = siblings[siblings.indexOf(direction < 0 ? first : last) + direction]
    if (!other || (other.hasChildren && !other.node.attrs.collapsed) ||
        (direction < 0 ? other.end !== first.pos : last.end !== other.pos)) return crossBoundary()
    const selectedContent = state.doc.slice(first.pos, last.end).content
    const neighbor = state.doc.slice(other.pos, other.end).content
    const lo = Math.min(first.pos, other.pos), hi = Math.max(last.end, other.end)
    const content = direction < 0 ? selectedContent.append(neighbor) : neighbor.append(selectedContent)
    const delta = direction < 0 ? other.pos - first.pos : other.end - last.end
    const tr = state.tr.replaceWith(lo, hi, content)
    tr.setSelection(TextSelection.create(tr.doc, state.selection.anchor + delta, state.selection.head + delta))
    view.dispatch(tr.scrollIntoView())
    return true
  }
  const fold = (collapsed, position) => {
    if (!editor.isEditable) return false
    const { state, view } = editor, entries = outlineEntries(state.doc)
    const targets = (position == null ? selectedOutline(entries, state.selection) : entries.filter(e => e.pos === position))
      .filter(e => e.header?.isTextblock && e.hasChildren)
    if (!targets.length) return false
    options.boundary?.()
    const tr = state.tr
    for (const entry of targets) {
      const value = collapsed ?? !entry.node.attrs.collapsed
      tr.setNodeMarkup(entry.pos, undefined, { ...entry.node.attrs, collapsed: value })
      if (value && entry.hidden.some(({ node, pos }) =>
        state.selection.from < pos + node.nodeSize && state.selection.to > pos)) {
        tr.setSelection(TextSelection.near(tr.doc.resolve(entry.headerPos + 1)))
      }
    }
    view.dispatch(tr.scrollIntoView())
    return true
  }
  const Meta = Extension.create({
    name: 'outlineMetadata',
    priority: 1000,
    addGlobalAttributes() {
      return [
        {
          types: ['listItem'],
          attributes: { indent: {
            default: 0,
            parseHTML: e => normalizeIndent(Number(e.getAttribute('data-indent'))),
            renderHTML: a => ({ 'data-indent': a.indent, style: `margin-left:${a.indent * 24}px` }),
          }, collapsed: {
            default: false, parseHTML: () => false,
            renderHTML: a => ({ 'data-collapsed': String(a.collapsed) }),
          } },
        },
        {
          types: elementTypes,
          attributes: {
            id: { default: null, parseHTML: () => null, renderHTML: (a) => ({ 'data-element-id': a.id }) },
          },
        },
        {
          types: ['paragraph', 'heading', 'codeBlock'],
          attributes: {
            indent: {
              default: 0,
              parseHTML: (e) => normalizeIndent(Number(e.getAttribute('data-indent'))),
              renderHTML: (a) => ({ 'data-indent': a.indent, style: `margin-left:${a.indent * 24}px` }),
            },
            noteTag: {
              default: null,
              parseHTML: (e) => e.getAttribute('data-note-tag'),
              renderHTML: (a) => (a.noteTag ? { 'data-note-tag': a.noteTag } : {}),
            },
            checked: {
              default: false,
              parseHTML: (e) => e.getAttribute('data-checked') === 'true',
              renderHTML: (a) => ({ 'data-checked': String(a.checked) }),
            },
            collapsed: {
              default: false,
              parseHTML: () => false,
              renderHTML: (a) => ({ 'data-collapsed': String(a.collapsed) }),
            },
          },
        },
      ]
    },
    addKeyboardShortcuts() {
      return {
        'Mod-z': () => {
          options.undo?.()
          return true
        },
        'Mod-y': () => {
          options.redo?.()
          return true
        },
        'Mod-Shift-z': () => {
          options.redo?.()
          return true
        },
        'Mod-1': () => tag('todo'),
        'Mod-2': () => tag('important'),
        'Mod-3': () => tag('question'),
        'Alt-.': () => toggleList(false),
        'Mod-.': () => toggleList(false),
        'Mod-/': () => toggleList(true),
        'Mod-k': () => {
          options.link?.()
          return true
        },
        'Mod-Shift-n': () => editor.chain().unsetAllMarks().clearNodes().run(),
        'Alt-Shift-ArrowRight': () => indent(1),
        'Alt-Shift-ArrowLeft': () => indent(-1),
        'Alt-Shift-ArrowUp': () => moveParagraph(-1),
        'Alt-Shift-ArrowDown': () => moveParagraph(1),
        Tab: () => { editor.isActive('table') ? editor.commands.goToNextCell() : indent(1); return true },
        'Shift-Tab': () => { editor.isActive('table') ? editor.commands.goToPreviousCell() : indent(-1); return true },
        Backspace: () => deleteObject() || backspaceIndent(),
        Delete: deleteObject,
        'Mod-a': () => {
          if (++selectAllCount > 1) {
            options.selectContainer?.()
            return true
          }
          return editor.commands.selectAll()
        },
        Escape: () => {
          if (!(editor.state.selection instanceof NodeSelection) && selectTable()) return true
          options.selectContainer?.()
          return true
        },
      }
    },
    addProseMirrorPlugins() {
      return [
        new Plugin({
          filterTransaction(transaction) {
            if (!transaction.docChanged || applying) return true
            try {
              fromEditor(transaction.doc.toJSON())
              return true
            } catch (error) {
              options.error?.(error)
              return false
            }
          },
          appendTransaction(transactions, oldState, newState) {
            if (!transactions.some((t) => t.docChanged)) return
            const ids = new Set(),
              tr = newState.tr
            newState.doc.descendants((node, pos) => {
              if (elementTypes.includes(node.type.name)) {
                let id = node.attrs.id
                if (!id || ids.has(id)) {
                  id = uid()
                  tr.setNodeMarkup(pos, undefined, { ...node.attrs, id })
                }
                ids.add(id)
              }
            })
            return tr.docChanged ? tr : null
          },
          props: {
            decorations(state) {
              const decorations = []
              state.doc.descendants((node, pos) => {
                if (node.type.name !== 'table') return
                decorations.push(Decoration.widget(pos, () => {
                  const controls = document.createElement('span'), button = document.createElement('button')
                  controls.className = 'outline-table-controls'
                  controls.contentEditable = 'false'
                  button.type = 'button'
                  button.className = 'outline-table-select'
                  button.textContent = '⊞'
                  button.setAttribute('aria-label', '选中表格')
                  button.title = '选中整个表格，按 Delete 删除；Ctrl+Z 撤销'
                  button.disabled = !(editor?.isEditable ?? options.editable !== false)
                  button.onpointerdown = event => { event.preventDefault(); event.stopPropagation() }
                  button.onclick = event => { event.preventDefault(); event.stopPropagation(); selectTable(pos) }
                  controls.append(button)
                  return controls
                }, { side: -1, stopEvent: () => true }))
              })
              for (const entry of outlineEntries(state.doc)) {
                if (!entry.header?.isTextblock || !entry.hasChildren) continue
                const collapsed = !!entry.node.attrs.collapsed
                if (collapsed) for (const { node, pos } of entry.hidden)
                  decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'outline-folded' }))
                decorations.push(Decoration.node(entry.headerPos, entry.headerPos + entry.header.nodeSize,
                  { class: 'outline-parent' }))
                decorations.push(Decoration.widget(entry.headerPos + 1, () => {
                  const button = document.createElement('button')
                  button.type = 'button'
                  button.className = 'outline-fold-toggle'
                  button.contentEditable = 'false'
                  button.textContent = collapsed ? '+' : '−'
                  button.setAttribute('aria-label', collapsed ? '展开子内容' : '折叠子内容')
                  button.setAttribute('aria-expanded', String(!collapsed))
                  button.disabled = !(editor?.isEditable ?? options.editable !== false)
                  button.onpointerdown = event => { event.preventDefault(); event.stopPropagation() }
                  button.onclick = event => {
                    event.preventDefault(); event.stopPropagation()
                    fold(!collapsed, entry.pos)
                    editor.view.focus()
                  }
                  return button
                }, { side: -1, stopEvent: () => true }))
              }
              if (appearance) state.doc.descendants((node, pos) => {
                if (!node.isText) return
                const ink = node.marks.find(m => m.type.name === 'textStyle')?.attrs.color
                const highlight = node.marks.find(m => m.type.name === 'highlight')?.attrs.color
                const original = ink || (highlight ? appearance.foreground : null)
                if (!original) return
                const display = readableInk(original, highlight || appearance.background)
                if (display !== original || highlight) decorations.push(Decoration.inline(pos, pos + node.nodeSize,
                  { class: 'outline-contrast', style: `--outline-readable-ink:${display}` }))
              })
              return DecorationSet.create(state.doc, decorations)
            },
          },
        }),
      ]
    },
  })
  const LocalImage = Image.extend({
    parseHTML() {
      return [{ tag: 'img[src]', getAttrs: (e) => (safeImage(e.getAttribute('src')) ? null : false) }]
    },
  })
  editor = new Editor({
    element,
    content: toEditor(options.document),
    editable: options.editable !== false,
    extensions: [
      StarterKit.configure({
        undoRedo: false,
        link: { openOnClick: false, isAllowedUri: (url) => !!safeLink(url) },
        trailingNode: false,
      }),
      TextStyleKit,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Highlight.configure({ multicolor: true }),
      TableKit.configure({ table: { resizable: true, allowTableNodeSelection: true } }),
      LocalImage.configure({ resize: { enabled: true, alwaysPreserveAspectRatio: true } }),
      Subscript,
      Superscript,
      Meta,
    ],
    editorProps: {
      handleDOMEvents: {
        keydown(view, event) {
          if (periodShortcut.keydown(event)) return true
          // Keep native IME input, but do not pass composing keys to later shortcut plugins.
          if (event.isComposing || view.composing) return true
          return false
        },
        keyup(view, event) { return periodShortcut.keyup(event) },
        blur() { periodShortcut.reset(); return false },
        pointerdown() {
          selectAllCount = 0
          return false
        },
      },
      attributes: { class: 'outline-prose', 'aria-label': '容器正文', spellcheck: 'false' },
      handleKeyDown(view, event) {
        if (event.isComposing || view.composing) return false
        if (event.key.toLowerCase() !== 'a' || !(event.ctrlKey || event.metaKey)) selectAllCount = 0
        if (event.ctrlKey || event.metaKey || event.altKey) options.boundary?.()
        // Chinese layouts can report 。 instead of .; use the physical punctuation key too.
        const period = ['Period', 'NumpadDecimal'].includes(event.code) ||
          ['.', '。', '．', 'Decimal'].includes(event.key) || [190, 110].includes(event.keyCode)
        const listShortcut = (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && period) ||
          ((event.ctrlKey || event.metaKey) && !event.altKey && (
          (!event.shiftKey && (event.code === 'Slash' || event.key === '/')) ||
          (event.shiftKey && (['Digit7', 'Digit8'].includes(event.code) || ['&', '*', '7', '8'].includes(event.key)))))
        if (listShortcut) {
          options.boundary?.()
          event.preventDefault()
          event.stopPropagation()
          if (event.code === 'Slash' || event.key === '/' || event.code === 'Digit7' ||
              (event.shiftKey && ['7', '&'].includes(event.key))) toggleList(true)
          else toggleList(false)
          return true
        }
        if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey &&
            (['Minus', 'Equal', 'NumpadSubtract', 'NumpadAdd'].includes(event.code) || ['-', '_', '+', '='].includes(event.key))) {
          event.preventDefault(); event.stopPropagation()
          fold(['Minus', 'NumpadSubtract'].includes(event.code) || ['-', '_'].includes(event.key))
          return true
        }
        if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.key.startsWith('Arrow')) {
          event.preventDefault()
          event.stopPropagation()
          if (event.key === 'ArrowLeft') indent(-1)
          if (event.key === 'ArrowRight') indent(1)
          if (event.key === 'ArrowUp') moveParagraph(-1)
          if (event.key === 'ArrowDown') moveParagraph(1)
          return true
        }
        options.keydown?.(event)
        return false
      },
      handlePaste(view, event) {
        // Office/OneNote may include an image representation alongside editable text.
        // Let ProseMirror insert the text once; only upload a file-only clipboard.
        if (event.defaultPrevented) return true
        const clipboard = event.clipboardData
        const html = clipboard?.getData('text/html') || ''
        const text = clipboard?.getData('text/plain') || ''
        const parsed = html ? new DOMParser().parseFromString(html, 'text/html') : null
        parsed?.querySelectorAll('style,script').forEach(node => node.remove())
        if (text.trim() || parsed?.body.textContent.trim()) return false
        const files = [...(event.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'))
        if (files.length) {
          event.preventDefault()
          options.images?.(files)
          return true
        }
        return false
      },
      handleDrop(view, event) {
        const files = [...(event.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'))
        if (files.length) {
          event.preventDefault()
          options.images?.(files)
          return true
        }
        return false
      },
      handleClick(view, pos, event) {
        const p = event.target.closest('[data-note-tag="todo"]')
        if (p && event.clientX < p.getBoundingClientRect().left + 23) {
          const at = view.posAtDOM(p, 0),
            resolved = view.state.doc.resolve(at)
          const start = resolved.before(resolved.depth)
          const node = view.state.doc.nodeAt(start)
          if (node) {
            view.dispatch(
              view.state.tr.setNodeMarkup(start, undefined, { ...node.attrs, checked: !node.attrs.checked }),
            )
            return true
          }
        }
        return false
      },
    },
    onUpdate: ({ transaction }) => {
      if (!applying)
        try {
          options.change(fromEditor(editor.getJSON()), transaction.getMeta('paste') ? 'paste' : 'text')
        } catch (e) {
          options.error?.(e)
        }
    },
    onSelectionUpdate: () => options.selection?.(),
    onFocus: () => options.focus?.(),
    onBlur: () => options.blur?.(),
  })
  const api = {
    get editor() {
      return editor
    },
    get document() {
      return fromEditor(editor.getJSON())
    },
    get composing() {
      return editor.view.composing
    },
    focus: (where) => editor.commands.focus(where),
    setEditable: (value) => editor.setEditable(value, false),
    setAppearance(value) {
      if (appearance?.background === value.background && appearance?.foreground === value.foreground) return
      appearance = value
      editor.view.dispatch(editor.state.tr.setMeta('appearance', true))
    },
    setDocument(doc) {
      applying = true
      try {
        const selection = editor.state.selection
        editor.commands.setContent(toEditor(doc), { emitUpdate: false })
        if (editor.isFocused) {
          const next = editor.state.doc
          let nodePos
          if (selection instanceof NodeSelection) next.descendants((node, pos) => {
            if (node.attrs.id === selection.node.attrs.id && node.type === selection.node.type) nodePos = pos
          })
          const restored = nodePos == null
            ? TextSelection.between(next.resolve(Math.min(selection.anchor, next.content.size)),
              next.resolve(Math.min(selection.head, next.content.size)))
            : NodeSelection.create(next, nodePos)
          editor.view.dispatch(editor.state.tr.setSelection(restored))
        }
      } finally {
        applying = false
      }
    },
    exec(command, value) {
      if (!editor.isEditable) return false
      options.boundary?.()
      if (command === 'indent') return indent(value)
      if (command === 'tag') return tag(value)
      if (command === 'checked')
        return paragraphCommand((n, p, tr) => tr.setNodeMarkup(p, undefined, { ...n.attrs, checked: !n.attrs.checked }))
      if (command === 'collapse') return fold(value)
      if (command === 'bullet' || command === 'number') return toggleList(command === 'number')
      if (command === 'moveParagraph') return moveParagraph(value)
      const chain = editor.chain().focus()
      const toggles = {
        bold: 'toggleBold',
        italic: 'toggleItalic',
        underline: 'toggleUnderline',
        strike: 'toggleStrike',
        superscript: 'toggleSuperscript',
        subscript: 'toggleSubscript',
        quote: 'toggleBlockquote',
        code: 'toggleCodeBlock',
      }
      if (toggles[command]) return chain[toggles[command]]().run()
      if (command === 'style')
        return value === 'normal' ? chain.setParagraph().run() : chain.setHeading({ level: Number(value) }).run()
      if (command === 'font') return chain.setFontFamily(value).run()
      if (command === 'size') return chain.setFontSize(`${value}pt`).run()
      if (command === 'color') return chain.setColor(value).run()
      if (command === 'highlight') return chain.toggleHighlight({ color: value || '#fff59d' }).run()
      if (command === 'align') return chain.setTextAlign(value).run()
      if (command === 'link')
        return value
          ? !!safeLink(value) &&
              chain
                .extendMarkRange('link')
                .setLink({ href: safeLink(value) })
                .run()
          : chain.unsetLink().run()
      if (command === 'clear') return chain.unsetAllMarks().clearNodes().run()
      if (command === 'table') return chain.insertTable({ rows: 3, cols: 3, withHeaderRow: false }).run()
      if (command === 'selectTable') return selectTable()
      if (command === 'image') return chain.setImage(value).run()
      if (
        [
          'addRowAfter',
          'addColumnAfter',
          'deleteRow',
          'deleteColumn',
          'deleteTable',
          'mergeCells',
          'splitCell',
        ].includes(command)
      )
        return chain[command]().run()
      if (command === 'format') {
        chain.unsetAllMarks()
        for (const mark of value || []) if (mark.type !== 'link') chain.setMark(mark.type, mark.attrs)
        return chain.run()
      }
      return false
    },
    format() {
      return editor.state.storedMarks || editor.state.selection.$from.marks()
    },
    paragraph() {
      const { $from } = editor.state.selection
      let d = $from.depth
      while (d > 1) d--
      return d ? { index: $from.index(0), id: $from.node(d).attrs.id } : null
    },
    status() {
      const attrs = editor.getAttributes('textStyle')
      return {
        bold: editor.isActive('bold'),
        italic: editor.isActive('italic'),
        underline: editor.isActive('underline'),
        font: attrs.fontFamily || 'Microsoft YaHei',
        size: parseFloat(attrs.fontSize) || 12,
        heading: editor.getAttributes('heading').level || 'normal',
        table: editor.isActive('table'),
        tag: editor.getAttributes(editor.isActive('heading') ? 'heading' : 'paragraph').noteTag || '',
      }
    },
    destroy: () => release(),
  }
  const release = owner.effect(() => () => {
    if (!editor.isDestroyed) editor.destroy()
  })
  return api
}
