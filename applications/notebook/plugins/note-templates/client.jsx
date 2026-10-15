export default function(ctx, sdk) {
  const { h, React, useObserve } = ctx.ui, model = ctx.notebook
  let disposed = false, showLibrary = () => {}, dirty = false, working = false
  const requireNote = (id, revision, template = false) => {
    if (disposed || model.busy || model.conflict) throw Error('当前不可使用模板，请等待保存或解决冲突')
    const note = model.notes.find(note => note.id === id)
    if (!note || template && !note.template) throw Error('页面或模板不存在')
    if (!Number.isSafeInteger(revision) || note.revision !== revision) throw Error('页面或模板版本已变化，请重新读取')
    return note
  }
  const requireDatabase = id => {
    if (id != null && !model.notes.some(note => note.id === id && note.type === 'database' && !note.template)) throw Error('模板关联的数据库不存在，请恢复数据库或改为通用模板')
  }
  const api = sdk.provide('noteTemplates', {
    list(databaseId) { return model.notes.filter(note => note.template && (databaseId === undefined || note.template.databaseId === null || note.template.databaseId === databaseId)).map(note => ({ id: note.id, title: note.title, type: note.type, revision: note.revision, databaseId: note.template.databaseId })) },
    async save({ sourceId, revision, name, databaseId = null }) {
      const source = requireNote(sourceId, revision)
      if (typeof name !== 'string' || !name.trim() || name.length > 80) throw Error('模板名称需要 1–80 字符')
      requireDatabase(databaseId)
      return model.create(ctx.noteFormats.typeOf(source), { ...ctx.noteFormats.patch(source), title: name.trim(), pinned: false, parentId: null, template: { databaseId } }, { select: false })
    },
    async apply({ templateId, revision, title, parentId, select = true }) {
      const source = requireNote(templateId, revision, true)
      const target = parentId === undefined ? source.template.databaseId : parentId
      if (source.template.databaseId !== null && target !== source.template.databaseId) throw Error('数据库模板只能用于其所属数据库；通用模板可以选择其他父页面')
      if (source.template.databaseId !== null) requireDatabase(source.template.databaseId)
      return model.create(ctx.noteFormats.typeOf(source), { ...ctx.noteFormats.patch(source), title: title === undefined || title === '' ? source.title : title, pinned: false, parentId: target ?? null, template: null }, { select })
    },
    async remove({ templateId, revision }) { requireNote(templateId, revision, true); return model.removeNote(templateId, revision) },
    open() { showLibrary() },
  })
  const guard = () => { if (dirty && !working) throw Error('模板表单有未保存内容，请先保存或取消') }
  ctx.on('notebook/before-action', guard); ctx.on('plugins/before-stop', guard)
  sdk.listen(window, 'beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = '' } })
  const root = sdk.el('div'); sdk.mount('panels', root)
  const trigger = sdk.button('toolbar', '模板库', () => setTimeout(() => showLibrary(), 0))
  trigger.setAttribute('aria-label', '模板库')
  model.observe(ctx, () => { trigger.disabled = model.busy })
  const banner = sdk.el('div', { class: 'note-template-banner', hidden: true })
  sdk.mount('toolbar', banner)
  model.observe(ctx, () => { const note = model.current(); banner.hidden = !note?.template; banner.textContent = note?.template ? '正在编辑模板：修改仅影响以后创建的页面' : '' })
  function Library() {
    useObserve(ctx, model)
    const [open, setOpen] = React.useState(false), [sourceId, setSourceId] = React.useState(null)
    const [name, setName] = React.useState(''), [scope, setScope] = React.useState(''), [title, setTitle] = React.useState('')
    const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [confirmDelete, setConfirmDelete] = React.useState(null)
    const ref = React.useRef(null)
    React.useEffect(() => {
      showLibrary = () => {
        if (disposed) return
        const note = model.current(), parent = model.notes.find(item => item.id === note?.parentId)
        setSourceId(note?.id || null); setName(''); setTitle(''); setError(''); setConfirmDelete(null)
        setScope(note?.type === 'database' && !note.template ? note.id : note?.template?.databaseId || (parent?.type === 'database' ? parent.id : ''))
        dirty = false; setOpen(true)
      }
      return () => { showLibrary = () => {} }
    }, [])
    React.useEffect(() => { if (open) ref.current.showModal() }, [open])
    const close = () => { dirty = false; setOpen(false) }
    const change = setter => event => { dirty = true; setter(event.target.value) }
    const run = async (action, leave = false) => {
      if (working || model.busy) return
      working = true; setBusy(true); setError('')
      try { const result = await action(); if (!result) throw Error('操作未完成，请重试'); dirty = false; if (!disposed) { if (leave) close(); else { setName(''); setTitle(''); setConfirmDelete(null); setError('已完成') } } }
      catch (error) { if (!disposed) setError(error.message) }
      finally { working = false; if (!disposed) setBusy(false) }
    }
    if (!open) return null
    const source = model.notes.find(note => note.id === sourceId)
    const templates = api.list(scope || undefined), databases = model.notes.filter(note => note.type === 'database' && !note.template)
    return <dialog className="note-templates-dialog" ref={ref} aria-label="模板库" onCancel={event => { event.preventDefault(); if (!busy) close() }}>
      <h2>模板库</h2><p>模板保存正文和默认属性。创建的是独立页面；数据库模板复制配置，不复制记录；正文中的数据库引用仍指向原数据库。</p>
      <fieldset disabled={busy || model.busy}>
        <label>模板范围<select aria-label="模板范围" value={scope} onChange={change(setScope)}><option value="">通用模板 / 查看全部</option>{databases.map(note => <option key={note.id} value={note.id}>{note.title || '无标题数据库'}</option>)}</select></label>
        <div className="note-template-save"><label>将当前页面存为模板<input aria-label="模板名称" maxLength={80} value={name} onChange={change(setName)} placeholder={source ? source.title || '模板名称' : '先打开一篇笔记'} /></label>
          <button type="button" disabled={!source || !name.trim()} onClick={() => run(() => api.save({ sourceId: source.id, revision: source.revision, name, databaseId: scope || null }))}>保存为模板</button></div>
        <label>新页面标题（可选）<input aria-label="模板新页面标题" maxLength={200} value={title} onChange={change(setTitle)} placeholder="留空沿用模板名称" /></label>
        <div className="note-template-list">{templates.map(template => <article key={template.id}>
          <div><strong>{template.title || '未命名模板'}</strong><small>{ctx.noteFormats.get(template.type)?.label || template.type} · {template.databaseId ? databases.find(note => note.id === template.databaseId)?.title || '所属数据库已不存在' : '通用'}</small></div>
          <div className="note-template-actions"><button type="button" onClick={() => run(() => api.apply({ templateId: template.id, revision: template.revision, title, ...(scope && !template.databaseId ? { parentId: scope } : {}) }), true)}>使用模板：{template.title}</button>
            <button type="button" onClick={() => run(() => model.choose(template.id).then(() => { ctx.shell.showEditor?.(); return true }), true)}>编辑模板：{template.title}</button>
            <button type="button" onClick={() => confirmDelete === template.id ? run(() => api.remove({ templateId: template.id, revision: template.revision })) : setConfirmDelete(template.id)}>{confirmDelete === template.id ? '确认删除模板' : '删除模板：' + template.title}</button></div>
        </article>)}</div>
        {!templates.length && <p>还没有模板。打开一篇笔记，将它保存为模板即可重复使用。</p>}
      </fieldset>
      {error && <p role="status">{error}</p>}<button type="button" disabled={busy} onClick={close}>关闭模板库</button>
    </dialog>
  }
  ctx.ui.mount(ctx, root, <Library />)
  const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
  const string = { type: 'string' }, revision = { type: 'integer' }, nullableId = { type: ['string', 'null'] }
  sdk.agent.register({ name: 'notebook_templates', description: '列出模板 ID、数值 revision、格式和所属数据库。databaseId 可筛选该数据库及通用模板；模板正文用 notebook_read 读取，修改用原有笔记工具。', inputSchema: object({ databaseId: string }) }, ({ databaseId } = {}) => api.list(databaseId))
  sdk.agent.register({ name: 'notebook_template_save', description: '将已有页面的正文和默认属性另存为模板，不改变原页面。sourceId/revision 来自 notebook_read.note；name 为模板名称。databaseId 限定为某数据库记录模板，省略/null 为通用模板。不复制子页或数据库记录。', inputSchema: object({ sourceId: string, revision, name: string, databaseId: nullableId }, ['sourceId', 'revision', 'name']) }, args => api.save(args))
  sdk.agent.register({ name: 'notebook_template_apply', description: '从模板创建独立页面。templateId/revision 来自 notebook_templates；title 可改标题。数据库模板自动进入所属数据库；通用模板可传 parentId。select:false 保持当前页。现有页面和模板都不覆盖。', inputSchema: object({ templateId: string, revision, title: string, parentId: nullableId, select: { type: 'boolean' } }, ['templateId', 'revision']) }, args => api.apply(args))
  sdk.agent.register({ name: 'notebook_template_delete', description: '将模板移入回收站，不影响已创建的页面；需传刚读取的 templateId/revision。', inputSchema: object({ templateId: string, revision }, ['templateId', 'revision']) }, args => api.remove(args))
  ctx.effect(() => () => { disposed = true; dirty = false; showLibrary = () => {} })
}
