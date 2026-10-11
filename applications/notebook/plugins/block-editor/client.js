import { mountBlockEditor } from './engine.js'
import { locate } from './tree.js'

const types = [
  ['paragraph', '正文', 'T', '普通文本 paragraph'],
  ['heading', '一级标题', 'H₁', 'heading h1', 1], ['heading', '二级标题', 'H₂', 'heading h2', 2], ['heading', '三级标题', 'H₃', 'heading h3', 3],
  ['bullet', '项目列表', '•', 'list bullet'], ['number', '编号列表', '1.', 'list number'],
  ['todo', '待办事项', '☑', 'task todo checkbox'], ['toggle', '折叠列表', '▸', 'toggle fold'],
  ['quote', '引用', '❝', 'quote'], ['callout', '提示块', '✦', 'callout'], ['code', '代码块', '</>', 'code'],
  ['divider', '分割线', '―', 'divider'], ['table', '表格', '▦', 'table'], ['image', '图片', '▧', 'image'],
]
export default function(ctx, sdk) {
  const model = ctx.notebook, service = ctx.blockDocument, rich = ctx.richText
  let api = null, noteId = null, disposed = false, menu = null, drag = null, applying = false, lastDocument = '', lastError = ''
  const el = (tag, attrs = {}, text = '') => sdk.el(tag, attrs, text)
  const root = el('section', { class: 'block-editor', 'aria-label': '块页面编辑器' })
  const toolbar = el('div', { class: 'block-toolbar', role: 'toolbar', 'aria-label': '块页面工具栏' })
  const scroll = el('div', { class: 'block-scroll' }), paper = el('div', { class: 'block-paper' })
  const heading = el('div', { class: 'block-heading' }), mount = el('div', { class: 'block-mount' })
  const hint = el('div', { class: 'block-page-hint' }, '把想法写成块，再把块组织成页面。')
  const footer = el('div', { class: 'block-footer' }, '输入 / 插入块 · 拖动 ⠿ 排序 · Tab 嵌套')
  const popup = el('div', { class: 'block-popup', hidden: true, role: 'dialog', 'aria-label': '块菜单' })
  const search = el('input', { class: 'block-menu-search', placeholder: '搜索块类型…', 'aria-label': '搜索块类型', spellcheck: false })
  const list = el('div', { class: 'block-menu-list', role: 'listbox', id: 'block-menu-options' })
  search.setAttribute('aria-controls', list.id)
  const menuCaption = el('div', { class: 'block-menu-caption' }, '↑↓ 选择 · Enter 确认 · Esc 关闭')
  popup.append(search, list, menuCaption)
  const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', multiple: true, hidden: true })
  paper.append(heading, hint, mount, footer); scroll.append(paper); root.append(toolbar, scroll, popup, file)
  ctx.editorHost.register(ctx, 'block', root, { headingTarget: heading })
  const active = () => model.current()?.type === 'block'
  const editable = () => active() && !model.busy && model.editable && api && !disposed
  const report = error => { if (error.message !== lastError) sdk.toast(error.message); lastError = error.message }
  const buttons = []
  const button = (label, text, fn, extra = {}) => {
    const b = el('button', { type: 'button', title: label, 'aria-label': label, ...extra }, text)
    sdk.listen(b, 'pointerdown', e => e.preventDefault())
    sdk.listen(b, 'click', () => { if (editable()) { try { fn() } catch (error) { report(error) } } })
    toolbar.append(b); buttons.push(b); return b
  }
  button('插入块', '＋ 插入', () => openMenu(api.current()?.id, 'insert'), { class: 'block-insert-button' })
  const separator = () => toolbar.append(el('span', { class: 'block-toolbar-divider', 'aria-hidden': 'true' }))
  separator()
  const formats = [['粗体 Ctrl+B', 'B', 'toggleBold', 'bold'], ['斜体 Ctrl+I', 'I', 'toggleItalic', 'italic'], ['下划线 Ctrl+U', 'U', 'toggleUnderline', 'underline'], ['删除线', 'S', 'toggleStrike', 'strike'], ['行内代码', '</>', 'toggleCode', 'code'], ['高亮', '▰', 'toggleHighlight', 'highlight']]
  const formatButtons = formats.map(([label, text, command, mark]) => [button(label, text, () => api.editor.chain().focus()[command]().run(), { class: 'block-format-' + mark }), mark])
  button('插入链接 Ctrl+K', '↗', () => showLink())
  separator()
  button('撤销 Ctrl+Z', '↶', () => api.editor.chain().focus().undo().run())
  button('重做 Ctrl+Shift+Z', '↷', () => api.editor.chain().focus().redo().run())
  const help = button('显示快捷键说明', '?', () => { helpPanel.hidden = !helpPanel.hidden; help.setAttribute('aria-expanded', String(!helpPanel.hidden)) })
  help.className = 'block-help-button'
  const helpPanel = el('div', { class: 'block-help', hidden: true }, 'Enter 新建块 · Shift+Enter 换行 · Tab / Shift+Tab 嵌套与取消嵌套 · Alt+Shift+↑↓ 移动块 · Ctrl+Shift+D 复制块 · Ctrl+Enter 切换待办/折叠 · Ctrl+S 保存')
  root.insertBefore(helpPanel, scroll)
  const linkPanel = el('form', { class: 'block-link-panel', hidden: true })
  const linkInput = el('input', { type: 'text', placeholder: 'https://example.com', 'aria-label': '链接地址' })
  const linkSubmit = el('button', { type: 'submit' }, '应用链接'), unlink = el('button', { type: 'button' }, '移除链接')
  linkPanel.append(linkInput, linkSubmit, unlink); root.insertBefore(linkPanel, scroll)
  let linkSelection = null
  function showLink() {
    if (!editable()) return
    linkSelection = { from: api.editor.state.selection.from, to: api.editor.state.selection.to, json: JSON.stringify(api.editor.getJSON()), noteId }
    linkInput.value = api.editor.getAttributes('link').href || ''; linkPanel.hidden = false; linkInput.focus()
  }
  const applyLink = remove => {
    if (!editable() || !linkSelection || linkSelection.noteId !== noteId || linkSelection.json !== JSON.stringify(api.editor.getJSON())) { linkPanel.hidden = true; return }
    const href = linkInput.value.trim()
    if (!remove && !/^(https?:\/\/|mailto:|#)/i.test(href)) { sdk.toast('请输入 http、https、mailto 或页内链接'); return }
    const chain = api.editor.chain().focus().setTextSelection(linkSelection).extendMarkRange('link')
    if (remove) chain.unsetLink().run(); else chain.setLink({ href }).run()
    linkPanel.hidden = true
  }
  sdk.listen(linkPanel, 'submit', e => { e.preventDefault(); applyLink(false) })
  sdk.listen(unlink, 'click', () => applyLink(true))
  sdk.listen(linkInput, 'keydown', e => { if (e.key === 'Escape') { linkPanel.hidden = true; api?.editor.view.focus() } })
  function closeMenu() {
    menu = null; popup.hidden = true
    api?.editor.view.dom.removeAttribute('aria-activedescendant')
    api?.editor.view.dom.removeAttribute('aria-controls')
    search.removeAttribute('aria-activedescendant')
  }
  function placeMenu() {
    if (!menu) return
    const item = [...mount.querySelectorAll('.page-block')].find(n => n.dataset.blockId === menu.id)
    if (!item) { closeMenu(); return }
    const base = root.getBoundingClientRect(), box = item.getBoundingClientRect(), height = Math.min(360, Math.max(160, base.height - 70))
    popup.style.maxHeight = height + 'px'
    popup.style.left = Math.max(8, Math.min(box.left - base.left, base.width - Math.min(300, base.width - 16) - 8)) + 'px'
    popup.style.top = Math.max(50, Math.min(box.top - base.top + 32, base.height - height - 8)) + 'px'
  }
  function openMenu(id, mode, slash = null) {
    if (!editable() || !id) return
    menu = { id, mode, slash, index: 0, query: '', items: [] }; search.value = ''; popup.hidden = false
    search.hidden = !!slash; drawMenu(); placeMenu()
    if (!slash) search.focus()
    else { api.editor.view.dom.setAttribute('aria-controls', list.id) }
  }
  function drawMenu() {
    if (!menu) return
    const q = menu.query.toLowerCase()
    const items = types.filter(t => (t[1] + ' ' + t[3]).toLowerCase().includes(q)).map(t => ({ label: t[1], icon: t[2], type: t[0], level: t[4] }))
    if (menu.mode === 'actions' && !q) items.push(
      { label: '复制块', icon: '⧉', action: 'duplicate' }, { label: '向上移动', icon: '↑', action: 'up' }, { label: '向下移动', icon: '↓', action: 'down' },
      { label: '嵌套到上一块', icon: '↳', action: 'indent' }, { label: '取消嵌套', icon: '↰', action: 'outdent' }, { label: '删除块及其子块', icon: '×', action: 'remove' })
    menu.items = items; menu.index = Math.max(0, Math.min(menu.index, items.length - 1)); list.replaceChildren()
    if (!items.length) list.append(el('p', { class: 'block-no-result' }, '没有匹配的块类型'))
    items.forEach((item, i) => {
      const b = el('button', { type: 'button', role: 'option', id: `block-menu-option-${i}`, 'aria-selected': String(i === menu.index), class: item.action === 'remove' ? 'block-danger' : '' })
      b.append(el('span', { class: 'block-menu-icon', 'aria-hidden': 'true' }, item.icon), el('span', {}, item.label))
      b.onpointerdown = e => e.preventDefault(); b.onclick = () => choose(item); list.append(b)
    })
    const selected = list.children[menu.index]
    if (selected?.id) { search.setAttribute('aria-activedescendant', selected.id); if (menu.slash) api.editor.view.dom.setAttribute('aria-activedescendant', selected.id) }
  }
  let uploadTarget = null
  function choose(item) {
    if (!menu || !editable()) return
    const { id, mode, slash } = menu
    closeMenu()
    api.focus(id)
    if (slash) api.editor.commands.deleteRange(slash)
    if (item.action) {
      const actions = { duplicate: () => api.duplicate(id), remove: () => api.remove(id), up: () => api.shift(-1, id), down: () => api.shift(1, id), indent: () => api.indent(1, id), outdent: () => api.indent(-1, id) }
      actions[item.action](); return
    }
    if (item.type === 'image') { uploadTarget = { id, noteId }; file.click(); return }
    if (mode === 'insert') { api.add('paragraph', id); api.convert(item.type, item.level) }
    else api.convert(item.type, item.level, id)
  }
  function menuKey(event) {
    if (!menu || event.isComposing) return false
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); menu.index = (menu.index + (event.key === 'ArrowDown' ? 1 : -1) + menu.items.length) % (menu.items.length || 1); drawMenu()
      list.children[menu.index]?.scrollIntoView({ block: 'nearest' }); return true
    }
    if (event.key === 'Enter') { event.preventDefault(); const item = menu.items[menu.index]; if (item) choose(item); return true }
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(); api?.editor.view.focus(); return true }
    return false
  }
  sdk.listen(search, 'input', () => { if (menu) { menu.query = search.value; menu.index = 0; drawMenu() } })
  sdk.listen(search, 'keydown', menuKey)
  sdk.listen(document, 'pointerdown', e => { if (!popup.contains(e.target)) closeMenu() })
  sdk.listen(scroll, 'scroll', () => { if (menu) placeMenu() })
  sdk.listen(window, 'resize', () => { if (menu) placeMenu() })
  function selectionChanged() {
    if (!api) return
    for (const [b, mark] of formatButtons) b.setAttribute('aria-pressed', String(api.editor.isActive(mark)))
    const selection = api.editor.state.selection, c = api.current()
    if (!selection.empty || !c || api.editor.view.composing || !selection.$from.parent.isTextblock) { if (menu?.slash) closeMenu(); return }
    const before = selection.$from.parent.textBetween(0, selection.$from.parentOffset)
    const match = before.match(/^\/([^\n/]{0,40})$/)
    if (match && !api.editor.isActive('codeBlock')) {
      const slash = { from: selection.from - before.length, to: selection.from }
      if (!menu || menu.id !== c.id || !menu.slash) openMenu(c.id, 'convert', slash)
      if (menu) { menu.query = match[1]; menu.slash = slash; drawMenu(); placeMenu() }
    } else if (menu?.slash) closeMenu()
  }
  async function upload(files) {
    if (!editable()) return
    const target = uploadTarget || { id: api.current()?.id, noteId }; uploadTarget = null
    const instance = api
    for (const image of files) {
      try {
        const src = await ctx.noteAssets.upload(image)
        if (!editable() || target.noteId !== noteId || api !== instance || !locate(api.document.blocks, target.id)) return
        const block = { ...service.create(), type: 'image', body: rich.normalize({ version: 1, elements: [{ id: crypto.randomUUID(), kind: 'image', src, alt: image.name, width: 640 }] }) }
        // Restore only the insertion target, never an old page snapshot after an upload.
        api.focus(target.id); api.insertBlocks([block]); target.id = block.id
      } catch (error) { report(error) }
    }
  }
  sdk.listen(file, 'change', () => { const files = [...file.files]; file.value = ''; void upload(files) })
  const clearDrag = () => { drag = null; mount.querySelectorAll('[data-drop]').forEach(n => delete n.dataset.drop) }
  function drop(event) {
    if (!drag) return false
    event.preventDefault()
    const saved = drag; clearDrag()
    if (editable() && saved.noteId === noteId && saved.over) api.move(saved.id, saved.over, saved.place)
    return true
  }
  sdk.listen(root, 'dragover', e => {
    if (!drag || !editable()) return
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'
    mount.querySelectorAll('[data-drop]').forEach(n => delete n.dataset.drop)
    const target = e.target.closest('.page-block')
    drag.over = null
    if (!target || !mount.contains(target) || target.dataset.blockId === drag.id) return
    const b = target.getBoundingClientRect(), inside = e.clientX > b.left + 80 && e.clientY > b.top + 8 && e.clientY < b.bottom - 8
    drag.over = target.dataset.blockId; drag.place = inside ? 'inside' : e.clientY < b.top + b.height / 2 ? 'before' : 'after'
    target.dataset.drop = drag.place
  })
  sdk.listen(root, 'drop', drop); sdk.listen(root, 'dragend', clearDrag)
  sdk.agent?.selection(mount, () => {
    if (!editable()) return null
    const snapshot = api.captureSelection(), instance = api, id = noteId
    if (!snapshot) return null
    const apply = value => {
      if (!editable() || noteId !== id || api !== instance) throw Error('笔记已切换，请重新添加选区')
      api.replaceSelection(snapshot, value); return model.flush().then(() => ({ updated: true }))
    }
    return { text: snapshot.text, noteId: id, label: model.current().title || '块页面选区', formats: ['text', 'richtext'], richText: snapshot.content,
      replacementHint: 'richtext 的 content 使用 {version:1,elements:[...]}，沿用富文本结构；这里只替换同一段落内的选区。', apply, applyContent: ({ content }) => apply(content) }
  })
  function render() {
    if (!active()) {
      closeMenu(); clearDrag(); api?.destroy(); api = null; noteId = null; lastDocument = ''; return
    }
    const note = model.current(), serialized = JSON.stringify(note.document)
    if (noteId !== note.id) {
      closeMenu(); clearDrag(); linkPanel.hidden = true; api?.destroy(); mount.replaceChildren()
      noteId = note.id; lastDocument = serialized; scroll.scrollTop = 0
      api = mountBlockEditor(mount, service, rich, { document: note.document, editable: !model.busy && model.editable,
        change(doc) {
          if (applying || disposed) return
          const next = JSON.stringify(doc)
          try { applying = true; lastDocument = next; model.edit({ document: doc }); lastError = '' }
          catch (error) { report(error) }
          finally { applying = false }
          selectionChanged()
        }, selection: selectionChanged, error: report, menu: openMenu, keydown: menuKey, link: showLink,
        images: upload, drop, drag(id, e) { drag = { id, noteId }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('application/x-cordis-block', id) },
      })
    } else if (!applying && serialized !== lastDocument) {
      // External/Agent edits are an explicit history boundary. Remount to prevent
      // undo from resurrecting a stale snapshot from before an external update.
      noteId = null; render(); return
    }
    for (const b of buttons) b.disabled = !editable()
    api.setEditable(!model.busy && model.editable)
    root.dataset.readonly = String(model.busy || !model.editable)
    if (!editable()) { closeMenu(); linkPanel.hidden = true }
    const count = doc => doc.reduce((n, b) => n + 1 + count(b.children), 0)
    footer.textContent = `${count(note.document.blocks)} 个块 · 输入 / 插入 · 拖动 ⠿ 排序 · Tab 嵌套`
  }
  ctx.effect(() => () => { disposed = true; closeMenu(); clearDrag(); api?.destroy(); api = null })
  model.observe(ctx, render)
}
