import { queryRows, statuses } from './query.js'
export function mountDatabase(ctx, sdk, root) {
  const { h, React, useObserve } = ctx.ui
  let dirtyForm = false, disposed = false, savingForm = false
  const report = error => sdk.toast(error.message)
  const rejectDirty = () => { if (dirtyForm) throw Error('数据库记录有未保存修改，请先保存或取消编辑') }
  ctx.on('plugins/before-stop', rejectDirty)
  ctx.on('notebook/before-action', () => { if (!savingForm) rejectDirty() })
  sdk.listen(window, 'beforeunload', event => { if (dirtyForm) { event.preventDefault(); event.returnValue = '' } })
  function Form({ draft, onClose, model, databaseId }) {
    const [title, setTitle] = React.useState(draft.title || '')
    const [status, setStatus] = React.useState(draft.properties?.status || 'todo')
    const [tags, setTags] = React.useState((draft.properties?.tags || []).join(', '))
    const [date, setDate] = React.useState(draft.properties?.date || '')
    const [type, setType] = React.useState(ctx.noteFormats.get('blocknote') ? 'blocknote' : 'plain')
    const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('')
    const ref = React.useRef(null)
    React.useEffect(() => { ref.current.showModal(); return () => { dirtyForm = false } }, [])
    const change = set => event => { dirtyForm = true; set(event.target.value) }
    const submit = async event => {
      event.preventDefault()
      if (busy || model.busy) return
      setBusy(true); setError(''); savingForm = true
      try {
        const dateValue = new FormData(event.currentTarget).get('date')
        const fields = { title, properties: { status, tags: tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean), date: dateValue || null } }
        const result = draft.id ? await model.updateNote(draft.id, fields, draft.revision)
          : await model.create(type, { ...fields, parentId: databaseId }, { select: false })
        if (!result) throw Error('操作未完成，请重试')
        dirtyForm = false; if (!disposed) onClose()
      } catch (error) { if (!disposed) setError(error.message) }
      finally { savingForm = false; if (!disposed) setBusy(false) }
    }
    return <dialog ref={ref} className="database-dialog" aria-label={draft.id ? '编辑记录' : '新增记录'} onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
      <form onSubmit={submit}><h2>{draft.id ? '编辑记录' : '新增记录'}</h2>
        <label>记录标题<input aria-label="记录标题" required maxLength={200} value={title} disabled={busy} onChange={change(setTitle)} autoFocus /></label>
        {!draft.id && <label>正文格式<select aria-label="记录正文格式" value={type} disabled={busy} onChange={change(setType)}>{ctx.noteFormats.list().filter(format => format.type !== 'database').map(format => <option key={format.type} value={format.type}>{format.label}</option>)}</select></label>}
        <label>状态<select aria-label="记录状态" value={status} disabled={busy} onChange={change(setStatus)}>{statuses.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label>标签<input aria-label="记录标签" placeholder="用逗号分隔，例如：工作, 本周" value={tags} disabled={busy} onChange={change(setTags)} /></label>
        <label>日期<input aria-label="记录日期" name="date" type="date" value={date} disabled={busy} onInput={change(setDate)} onChange={change(setDate)} /></label>
        {error && <p role="alert">{error}</p>}
        <div className="database-actions"><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" disabled={busy || model.busy}>{busy ? '保存中…' : '保存记录'}</button></div>
      </form>
    </dialog>
  }
  function Database() {
    const model = useObserve(ctx, ctx.notebook); useObserve(ctx, ctx.noteFormats)
    const note = model.current()
    const [filter, setFilter] = React.useState({ query: '', status: '', tag: '', from: '', to: '', sort: 'updated' })
    const [draft, setDraft] = React.useState(null)
    React.useEffect(() => { setFilter({ query: '', status: '', tag: '', from: '', to: '', sort: 'updated' }); setDraft(null) }, [note?.id])
    if (note?.type !== 'database') return null
    const rows = queryRows(model.notes, note.id, filter), all = model.notes.filter(row => row.parentId === note.id)
    const tags = [...new Set(all.flatMap(row => row.properties?.tags || []))].sort()
    const disabled = model.busy || model.conflict || !model.editable
    const changeFilter = key => event => setFilter({ ...filter, [key]: event.target.value })
    const view = kind => { if (!disabled) { model.edit({ database: { version: 1, view: kind } }); void model.flush().catch(report) } }
    const open = row => model.choose(row.id).then(() => ctx.shell.showEditor?.()).catch(report)
    const setStatus = (row, status) => model.updateNote(row.id, { properties: { status } }, row.revision).catch(report)
    const statusSelect = row => <select aria-label={'状态：' + (row.title || '无标题笔记')} disabled={disabled} value={row.properties?.status || 'todo'} onChange={event => setStatus(row, event.target.value)}>{statuses.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
    return <div className="database-body">
      <div className="database-actions"><button type="button" aria-pressed={note.database.view === 'table'} disabled={disabled} onClick={() => view('table')}>表格视图</button>
        <button type="button" aria-pressed={note.database.view === 'board'} disabled={disabled} onClick={() => view('board')}>看板视图</button>
        <button type="button" disabled={disabled} onClick={() => setDraft({})}>新增记录</button><span>{rows.length} / {all.length} 条记录</span></div>
      <div className="database-filters">
        <input aria-label="搜索数据库记录" placeholder="搜索标题或标签" value={filter.query} onChange={changeFilter('query')} />
        <select aria-label="筛选状态" value={filter.status} onChange={changeFilter('status')}><option value="">全部状态</option>{statuses.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        <select aria-label="筛选标签" value={filter.tag} onChange={changeFilter('tag')}><option value="">全部标签</option>{tags.map(tag => <option key={tag} value={tag}>{tag}</option>)}</select>
        <label>从<input type="date" aria-label="开始日期" value={filter.from} onInput={changeFilter('from')} onChange={changeFilter('from')} /></label><label>至<input type="date" aria-label="结束日期" value={filter.to} onInput={changeFilter('to')} onChange={changeFilter('to')} /></label>
        <select aria-label="排序方式" value={filter.sort} onChange={changeFilter('sort')}><option value="updated">最近更新</option><option value="title">标题排序</option><option value="date">日期升序</option></select>
        <button type="button" onClick={() => setFilter({ query: '', status: '', tag: '', from: '', to: '', sort: 'updated' })}>清除筛选</button>
      </div>
      {note.database.view === 'table' ? <div className="database-table-scroll"><table aria-label="数据库记录"><thead><tr><th>名称</th><th>状态</th><th>标签</th><th>日期</th><th>操作</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}><td><button className="database-link" type="button" disabled={disabled} onClick={() => open(row)}>{row.title || '无标题笔记'}</button></td>
          <td>{statusSelect(row)}</td><td>{(row.properties?.tags || []).map(tag => <span className="database-tag" key={tag}>{tag}</span>)}</td><td>{row.properties?.date || '—'}</td>
          <td><button type="button" aria-label={'编辑记录：' + (row.title || '无标题笔记')} disabled={disabled} onClick={() => setDraft(row)}>编辑属性</button></td></tr>)}</tbody></table></div>
        : <div className="database-board">{statuses.map(([status, label]) => <section key={status} aria-label={label + '列'} onDragOver={event => { if (!disabled) event.preventDefault() }}
          onDrop={event => { event.preventDefault(); const row = rows.find(row => row.id === event.dataTransfer.getData('text/x-notebook-row')); if (row && !disabled) void setStatus(row, status) }}>
          <h3>{label} <span>{rows.filter(row => (row.properties?.status || 'todo') === status).length}</span></h3>
          {rows.filter(row => (row.properties?.status || 'todo') === status).map(row => <article className="database-card" key={row.id} draggable={!disabled} onDragStart={event => event.dataTransfer.setData('text/x-notebook-row', row.id)}>
            <button type="button" className="database-link" disabled={disabled} onClick={() => open(row)}>{row.title || '无标题笔记'}</button>
            <p>{(row.properties?.tags || []).map(tag => <span key={tag} className="database-tag">{tag}</span>)}</p><p>{row.properties?.date || '未设置日期'}</p>
            {statusSelect(row)}<button type="button" aria-label={'编辑记录：' + (row.title || '无标题笔记')} disabled={disabled} onClick={() => setDraft(row)}>编辑属性</button>
          </article>)}</section>)}</div>}
      {!rows.length && <p className="database-empty">{all.length ? '没有符合筛选条件的记录。' : '点击“新增记录”开始。每条记录都是可以打开编辑的笔记页面。'}</p>}
      <p className="database-hint">此页的直接子页面就是记录；移动父页面关系即可加入或移出。看板可拖动卡片或使用状态菜单。筛选仅影响当前浏览，不会删除记录。</p>
      {draft && <Form draft={draft} model={model} databaseId={note.id} onClose={() => { dirtyForm = false; setDraft(null) }} />}
    </div>
  }
  ctx.ui.mount(ctx, root, <Database />)
  ctx.effect(() => () => { disposed = true; dirtyForm = false })
}
