
export default function(ctx, sdk) {
  const model = ctx.notebook
  const root = sdk.el('section', { class: 'markdown-editor', 'aria-label': 'Markdown 编辑器' })
  const toolbar = sdk.el('div', { class: 'markdown-toolbar', 'aria-label': 'Markdown 工具栏' })
  const actions = sdk.el('div', { class: 'markdown-actions' }), modes = sdk.el('div', { class: 'markdown-modes' })
  const source = sdk.el('textarea', { class: 'markdown-source', 'aria-label': 'Markdown 源码', spellcheck: false, maxLength: 200000, placeholder: '# 标题\n\n写下你的 Markdown 笔记…' })
  const preview = sdk.el('article', { class: 'markdown-preview', 'aria-label': 'Markdown 预览', tabIndex: 0 })
  const panes = sdk.el('div', { class: 'markdown-panes' }); panes.append(source, preview)
  toolbar.append(actions, modes); root.append(toolbar, panes)
  const style = sdk.el('link', { rel: 'stylesheet', href: '/builtin/markdown-editor/style.css' })
  ctx.effect(() => { document.head.append(style); return () => style.remove() })
  ctx.editorHost.register(ctx, 'markdown', root)
  let mode = 'split', selectedId, rendered, timer, composing = false, disposed = false
  const editableButtons = [], viewButtons = new Map(), urls = new Map()
  const isActive = () => ctx.noteFormats.typeOf(model.current()) === 'markdown'
  const canEdit = () => isActive() && !model.busy && model.editable && !composing
  const draw = () => {
    clearTimeout(timer)
    if (disposed || !isActive()) return
    const value = model.current().markdown || ''
    if (rendered === value) return
    // html:false and the parser's URL validation keep raw note HTML inert.
    preview.innerHTML = value ? ctx.markdown.render(value) : '<p class="markdown-placeholder">预览会显示在这里。</p>'
    rendered = value
  }
  const setMode = value => {
    mode = value; root.dataset.mode = value
    source.hidden = value === 'preview'; preview.hidden = value === 'edit'
    for (const [key, button] of viewButtons) button.setAttribute('aria-pressed', String(key === value))
    if (value !== 'edit') draw()
  }
  const insert = (before, after = '', placeholder = '') => {
    if (!canEdit()) return
    const start = source.selectionStart, end = source.selectionEnd
    const value = before + (source.value.slice(start, end) || placeholder) + after
    if (source.value.length - (end - start) + value.length > 200000) { sdk.toast('Markdown 源码不能超过 200000 字符'); return }
    if (mode === 'preview') setMode('split')
    source.focus(); source.setSelectionRange(start, end)
    // Chromium's editing command keeps toolbar insertions in native undo history.
    if (!document.execCommand('insertText', false, value)) {
      source.setRangeText(value, start, end, 'end'); source.dispatchEvent(new Event('input', { bubbles: true }))
    }
    source.setSelectionRange(start + before.length, start + value.length - after.length)
  }
  const tools = [
    ['标题', '# ', '', '标题'], ['粗体', '**', '**', '粗体文字'], ['斜体', '*', '*', '斜体文字'],
    ['列表', '- ', '', '列表项'], ['引用', '> ', '', '引用内容'], ['代码块', '\n```\n', '\n```\n', '代码'],
    ['链接', '[', '](https://example.com)', '链接文字'],
  ]
  for (const [label, before, after, placeholder] of tools) {
    const button = sdk.el('button', { type: 'button', 'aria-label': '插入' + label }, label)
    sdk.listen(button, 'pointerdown', event => event.preventDefault())
    sdk.listen(button, 'click', () => insert(before, after, placeholder)); actions.append(button); editableButtons.push(button)
  }
  for (const [value, label] of [['edit', '编辑'], ['split', '分栏'], ['preview', '预览']]) {
    const button = sdk.el('button', { type: 'button', 'aria-label': 'Markdown ' + label }, label)
    sdk.listen(button, 'click', () => setMode(value)); modes.append(button); viewButtons.set(value, button)
  }
  const download = sdk.el('button', { type: 'button', 'aria-label': '导出 Markdown 文件' }, '导出 .md')
  modes.append(download)
  sdk.listen(download, 'click', () => {
    const note = model.current(); if (!isActive()) return
    const url = URL.createObjectURL(new Blob([note.markdown], { type: 'text/markdown;charset=utf-8' }))
    const link = sdk.el('a', { href: url, download: (note.title || 'Markdown 笔记').replace(/[<>:"/\\|?*]/g, '_') + '.md' })
    link.click()
    urls.set(url, setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url) }, 1000))
  })
  sdk.listen(source, 'input', () => {
    if (!isActive() || model.busy || !model.editable) return
    try { model.edit({ markdown: source.value }) } catch (error) { sdk.toast(error.message); source.value = model.current().markdown || '' }
  })
  sdk.listen(source, 'compositionstart', () => { composing = true; for (const button of editableButtons) button.disabled = true })
  sdk.listen(source, 'compositionend', () => { composing = false; render() })
  sdk.listen(source, 'keydown', event => {
    if (event.isComposing || !canEdit()) return
    if ((event.ctrlKey || event.metaKey) && ['b', 'i'].includes(event.key.toLowerCase())) {
      event.preventDefault(); insert(event.key.toLowerCase() === 'b' ? '**' : '*', event.key.toLowerCase() === 'b' ? '**' : '*', '文字')
    }
  })
  function render() {
    if (!isActive()) { clearTimeout(timer); return }
    const note = model.current()
    if (source.value !== note.markdown) source.value = note.markdown || ''
    source.disabled = model.busy || !model.editable
    for (const button of editableButtons) button.disabled = !canEdit()
    if (selectedId !== note.id) { selectedId = note.id; rendered = undefined; source.scrollTop = preview.scrollTop = 0; draw() }
    else if (rendered !== note.markdown) { clearTimeout(timer); timer = setTimeout(draw, 100) }
  }
  ctx.effect(() => () => { disposed = true; clearTimeout(timer); for (const [url, timeout] of urls) { clearTimeout(timeout); URL.revokeObjectURL(url) }; urls.clear() })
  setMode('split'); model.observe(ctx, render)
}
