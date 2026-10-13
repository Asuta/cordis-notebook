import { pageRelations, allowedParents } from './relations.js'

export default function(ctx, sdk) {
  const el = sdk.el, model = ctx.notebook
  let disposed = false
  const dialog = el('dialog', { class: 'note-relations-dialog', 'aria-label': '页面关系' })
  const heading = el('h2', {}, '页面关系'), body = el('div'), close = el('button', { type: 'button' }, '关闭')
  dialog.append(heading, body, close); sdk.mount('panels', dialog)
  const navigate = async id => { await model.choose(id); if (!disposed) { dialog.close(); ctx.shell.showEditor?.() } }
  const run = action => Promise.resolve().then(action).catch(error => sdk.toast(error.message))
  const link = note => {
    const button = el('button', { type: 'button' }, note.title)
    button.disabled = model.busy || !!note.missing
    button.addEventListener('click', () => run(() => navigate(note.id)))
    return button
  }
  const breadcrumbs = el('nav', { class: 'note-page-path', 'aria-label': '页面路径' }); sdk.mount('panels', breadcrumbs)
  const button = sdk.button('toolbar', '页面关系', () => setTimeout(() => { if (!disposed && !dialog.open) { dialog.showModal(); render() } }, 0))
  button.setAttribute('aria-label', '页面关系')
  const section = (title, notes) => {
    const root = el('section'); root.append(el('h3', {}, `${title}（${notes.length}）`))
    if (!notes.length) root.append(el('p', {}, '暂无'))
    else for (const note of notes) root.append(link(note))
    return root
  }
  function render() {
    if (disposed) return
    const note = model.current(); button.disabled = !note || model.busy
    body.replaceChildren(); breadcrumbs.replaceChildren()
    if (!note) { breadcrumbs.hidden = true; return }
    const byId = new Map(model.notes.map(item => [item.id, item])), ancestors = [], seen = new Set([note.id])
    let parent = byId.get(note.parentId)
    while (parent && !seen.has(parent.id)) { seen.add(parent.id); ancestors.unshift(parent); parent = byId.get(parent.parentId) }
    breadcrumbs.hidden = !ancestors.length
    for (const parent of ancestors) breadcrumbs.append(link({ ...parent, title: parent.title || '无标题笔记' }), el('span', {}, ' / '))
    breadcrumbs.append(el('span', {}, note.title || '无标题笔记'))
    // Backlink scans are only needed while this panel is open, not on every keystroke.
    if (!dialog.open) return
    const info = pageRelations(model.notes, note.id, ctx.noteFormats)
    heading.textContent = '页面关系 · ' + info.page.title
    const parents = el('select', { 'aria-label': '父页面' })
    parents.append(el('option', { value: '' }, '顶层页面'))
    for (const target of allowedParents(model.notes, note.id)) parents.append(el('option', { value: target.id }, target.title || '无标题笔记'))
    parents.value = note.parentId || ''; parents.disabled = model.busy || !model.editable
    parents.addEventListener('change', () => run(async () => {
      if (model.selected !== note.id || model.busy) throw Error('页面已变化，请重试')
      try { model.edit({ parentId: parents.value || null }); await model.flush() } finally { render() }
    }))
    const label = el('label', {}, '父页面'); label.append(parents); body.append(label)
    const type = el('select', { 'aria-label': '子页面格式' })
    for (const format of ctx.noteFormats.list()) type.append(el('option', { value: format.type }, format.label))
    type.value = ctx.noteFormats.get('blocknote') ? 'blocknote' : type.options[0]?.value || ''
    const child = el('button', { type: 'button' }, '新建子页面'); child.disabled = type.disabled = model.busy || !type.value
    child.addEventListener('click', () => run(async () => {
      await model.create(type.value, { parentId: note.id })
      if (!disposed) { dialog.close(); ctx.shell.showEditor?.() }
    }))
    const create = el('div', { class: 'relations-create' }); create.append(type, child); body.append(create)
    body.append(section('子页面', info.children), section('本页引用', info.outgoing), section('引用本页', info.backlinks),
      el('p', { class: 'relations-hint' }, '在 BlockNote 正文中输入 @ 插入页面引用。删除父页面后，子页面上移一级；引用会显示“已不存在”。'))
  }
  sdk.listen(close, 'click', () => dialog.close())
  model.observe(ctx, event => { if (!event || ['edit', 'selection', 'busy'].includes(event.reason)) render() })
  ctx.noteFormats.observe(ctx, render)
  sdk.agent.register({ name: 'notebook_page_relations', description: '读取页面祖先路径、直接子页面、向外引用和反向引用；id 省略读取当前页，包含本页草稿。创建子页面用 notebook_create 的 parentId，移动已打开页面用 notebook_update 的 patch.parentId（null 移回顶层）。BlockNote 原生行内引用为 {type:"pageLink",props:{noteId:"目标ID",title:"显示标题"}}，可用 notebook_blocknote_edit 的 content 插入。', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false } }, ({ id } = {}) => {
    if (disposed) throw Error('页面关系已停用')
    return pageRelations(model.notes, id ?? model.selected, ctx.noteFormats)
  })
  ctx.effect(() => () => { disposed = true; if (dialog.open) dialog.close() })
}
