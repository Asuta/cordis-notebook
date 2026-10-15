import { createForms } from './forms.jsx'
export function createDatabaseUI(ctx, sdk) {
  const { h, React, useObserve } = ctx.ui, schema = ctx.databaseSchema
  const { RecordDialog, FieldDialog, ViewDialog, ValueInput } = createForms(ctx, sdk)
  const display = value => value == null || value === '' ? '—' : typeof value === 'boolean' ? value ? '是' : '否' : Array.isArray(value) ? value.join('、') : String(value)
  function Rules({ filter, fields, change, disabled }) {
    const labels = { empty: '未填写', notEmpty: '已填写', eq: '等于', neq: '不等于', contains: '包含', gt: '大于', gte: '大于等于', lt: '小于', lte: '小于等于' }
    const operators = field => ['empty', 'notEmpty', 'eq', 'neq', ...(['text', 'url', 'multiSelect'].includes(field.type) ? ['contains'] : []), ...(['number', 'date'].includes(field.type) ? ['gt', 'gte', 'lt', 'lte'] : [])]
    const patch = (index, value) => change({ ...filter, rules: filter.rules.map((rule, i) => i === index ? value : rule) })
    return <div className="database-rules">
      {filter.rules.map((rule, index) => {
        const field = fields.find(item => item.id === rule.field)
        if (!field) return null
        const valueField = field.type === 'multiSelect' && rule.operator === 'contains' ? { ...field, type: 'select' } : field
        return <div className="database-rule" key={index}>
          <select aria-label={'筛选字段 ' + (index + 1)} disabled={disabled} value={rule.field} onChange={event => patch(index, { field: event.target.value, operator: 'notEmpty' })}>{fields.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <select aria-label={'筛选条件 ' + (index + 1)} disabled={disabled} value={rule.operator} onChange={event => patch(index, { field: rule.field, operator: event.target.value })}>{operators(field).map(op => <option key={op} value={op}>{labels[op]}</option>)}</select>
          {!['empty', 'notEmpty'].includes(rule.operator) && <ValueInput field={valueField} value={rule.value} disabled={disabled} label={'筛选值 ' + (index + 1)} onChange={value => patch(index, { ...rule, value })} />}
          <button type="button" aria-label={'移除筛选 ' + (index + 1)} disabled={disabled} onClick={() => change({ ...filter, rules: filter.rules.filter((_, i) => i !== index) })}>移除</button>
        </div>
      })}
      {!!fields.length && <button type="button" disabled={disabled || filter.rules.length >= 20} onClick={() => change({ ...filter, rules: [...filter.rules, { field: fields[0].id, operator: 'notEmpty' }] })}>添加属性筛选</button>}
    </div>
  }
  function DatabaseView({ databaseId, viewId, onViewChange, embedded = false, readOnly = false }) {
    const model = useObserve(ctx, ctx.notebook)
    const database = model.notes.find(note => note.id === databaseId && note.type === 'database' && (!embedded || !note.template))
    const [local, setLocal] = React.useState(null), [dialog, setDialog] = React.useState(null), [error, setError] = React.useState('')
    if (!database) return <p className="database-empty">数据库已不存在或未选择，请重新选择数据库。</p>
    const config = schema.normalize(database.database)
    const requested = viewId || config.activeViewId
    const view = config.views.find(item => item.id === requested)
    if (!view) return <div className="database-empty"><p>引用的视图已删除，请选择其他视图。</p>{config.views.map(item => <button key={item.id} type="button" disabled={readOnly} onClick={() => onViewChange?.(item.id)}>{item.name}</button>)}</div>
    const filterKey = databaseId + ':' + view.id
    const filter = local?.key === filterKey ? local.filter : view.filter
    const dirtyFilter = JSON.stringify(filter) !== JSON.stringify(view.filter)
    const changeFilter = value => setLocal({ key: filterKey, filter: value })
    const set = key => event => changeFilter({ ...filter, [key]: event.target.value })
    let rows = [], filterError = ''
    try { rows = schema.queryRows(model.notes, database.id, filter, config.fields) } catch (error) { filterError = error.message }
    const all = model.notes.filter(note => !note.template && note.parentId === database.id)
    const tags = [...new Set(all.flatMap(row => row.properties?.tags || []))].sort()
    const disabled = readOnly || model.busy || model.conflict || !model.editable
    const run = async action => {
      setError('')
      try { const result = await action(); if (!result) throw Error('操作未完成，请重试'); return result }
      catch (error) { setError(error.message) }
    }
    const selectView = item => {
      setLocal(null)
      if (embedded) { onViewChange?.(item.id); return }
      void run(() => model.updateNote(database.id, { database: { ...config, activeViewId: item.id } }, database.revision))
    }
    const saveFilter = () => run(async () => {
      const next = schema.normalize({ ...config, views: config.views.map(item => item.id === view.id ? { ...item, filter } : item) })
      const result = await model.updateNote(database.id, { database: next }, database.revision)
      if (result) setLocal(null)
      return result
    })
    const open = row => run(() => model.choose(row.id).then(() => { ctx.shell.showEditor?.(); return true }))
    const setStatus = (row, status) => run(() => model.updateNote(row.id, { properties: { status } }, row.revision))
    const statusSelect = row => <select aria-label={'状态：' + (row.title || '无标题笔记')} disabled={disabled} value={row.properties?.status || 'todo'} onChange={event => setStatus(row, event.target.value)}>{schema.statuses.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
    const cell = (row, field) => {
      const value = row.properties?.custom?.[field.id]
      return field.type === 'url' && value ? <a href={value} target="_blank" rel="noopener noreferrer">{value}</a> : display(value)
    }
    return <section className={'database-body' + (embedded ? ' database-embedded' : '')} aria-label={'数据库：' + (database.title || '无标题数据库')} onKeyDown={embedded ? event => event.stopPropagation() : undefined}>
      {embedded && <div className="database-embed-title"><button type="button" disabled={model.busy} onClick={() => open(database)}>{database.title || '无标题数据库'} ↗</button></div>}
      <div className="database-actions database-views" aria-label="数据库视图">
        {config.views.map(item => <button type="button" key={item.id} aria-pressed={item.id === view.id} disabled={disabled} onClick={() => selectView(item)}>{item.name}</button>)}
        <button type="button" disabled={disabled || config.views.length >= 20 || !!filterError} onClick={() => setDialog({ kind: 'view', database, view, filter, embedded, duplicate: true })}>新建视图</button>
        <button type="button" disabled={disabled || !!filterError} onClick={() => setDialog({ kind: 'view', database, view, filter, embedded })}>编辑视图</button>
      </div>
      <div className="database-actions"><button type="button" disabled={disabled || !!database.template} onClick={() => setDialog({ kind: 'record', database })}>新增记录</button>
        <button type="button" disabled={disabled || config.fields.length >= 32} onClick={() => setDialog({ kind: 'field', database })}>新增字段</button>
        <span>{rows.length} / {all.length} 条记录</span>
      </div>
      {!!config.fields.length && <details className="database-field-list"><summary>管理字段（{config.fields.length}）</summary><div className="database-actions">{config.fields.map(field => <button key={field.id} type="button" disabled={disabled} onClick={() => setDialog({ kind: 'field', database, field })}>{field.name}</button>)}</div></details>}
      <details className="database-filter-panel" open={!embedded}><summary>筛选与排序{dirtyFilter ? '（未保存）' : ''}</summary><div className="database-filters">
        <input aria-label="搜索数据库记录" placeholder="搜索标题或标签" value={filter.query} onChange={set('query')} disabled={disabled} />
        <select aria-label="筛选状态" value={filter.status} onChange={set('status')} disabled={disabled}><option value="">全部状态</option>{schema.statuses.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        <select aria-label="筛选标签" value={filter.tag} onChange={set('tag')} disabled={disabled}><option value="">全部标签</option>{[...new Set([...tags, ...(filter.tag ? [filter.tag] : [])])].map(tag => <option key={tag} value={tag}>{tag}</option>)}</select>
        <label>从<input type="date" aria-label="开始日期" value={filter.from} onInput={set('from')} onChange={set('from')} disabled={disabled} /></label>
        <label>至<input type="date" aria-label="结束日期" value={filter.to} onInput={set('to')} onChange={set('to')} disabled={disabled} /></label>
        <select aria-label="排序方式" value={filter.sort} disabled={disabled} onChange={event => changeFilter({ ...filter, sort: event.target.value, direction: event.target.value === 'updated' ? 'desc' : 'asc' })}>
          <option value="updated">最近更新</option><option value="title">标题排序</option><option value="date">日期排序</option>{config.fields.map(field => <option key={field.id} value={field.id}>{field.name}</option>)}
        </select>
        <select aria-label="排序方向" value={filter.direction} onChange={set('direction')} disabled={disabled}><option value="asc">升序</option><option value="desc">降序</option></select>
        <button type="button" disabled={disabled} onClick={() => changeFilter(schema.defaultFilter())}>清除筛选</button>
      </div>
      <Rules filter={filter} fields={config.fields} disabled={disabled} change={changeFilter} />
      {dirtyFilter && <div className="database-actions database-unsaved"><span>筛选排序尚未保存到“{view.name}”</span><button type="button" disabled={disabled || !!filterError} onClick={saveFilter}>保存视图</button><button type="button" disabled={disabled} onClick={() => setLocal(null)}>还原视图设置</button></div>}
      </details>{(filterError || error) && <p role="alert">{filterError || error}</p>}
      {view.layout === 'table' ? <div className="database-table-scroll"><table aria-label="数据库记录"><thead><tr><th>名称</th><th>状态</th><th>标签</th><th>日期</th>{config.fields.map(field => <th key={field.id}>{field.name}</th>)}<th>操作</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}><td><button className="database-link" type="button" disabled={model.busy} onClick={() => open(row)}>{row.title || '无标题笔记'}</button></td>
          <td>{statusSelect(row)}</td><td>{(row.properties?.tags || []).map(tag => <span className="database-tag" key={tag}>{tag}</span>)}</td><td>{row.properties?.date || '—'}</td>
          {config.fields.map(field => <td key={field.id}>{cell(row, field)}</td>)}
          <td><button type="button" aria-label={'编辑记录：' + (row.title || '无标题笔记')} disabled={disabled} onClick={() => setDialog({ kind: 'record', database, row })}>编辑属性</button></td></tr>)}</tbody></table></div>
        : <div className="database-board">{schema.statuses.map(([status, label]) => <section key={status} aria-label={label + '列'} onDragOver={event => { if (!disabled) { event.preventDefault(); event.stopPropagation() } }}
          onDrop={event => { event.preventDefault(); event.stopPropagation(); const row = rows.find(row => row.id === event.dataTransfer.getData('text/x-notebook-row')); if (row && !disabled) void setStatus(row, status) }}>
          <h3>{label} <span>{rows.filter(row => (row.properties?.status || 'todo') === status).length}</span></h3>
          {rows.filter(row => (row.properties?.status || 'todo') === status).map(row => <article className="database-card" key={row.id} draggable={!disabled} onDragStart={event => { event.stopPropagation(); event.dataTransfer.setData('text/x-notebook-row', row.id) }}>
            <button type="button" className="database-link" disabled={model.busy} onClick={() => open(row)}>{row.title || '无标题笔记'}</button>
            <p>{(row.properties?.tags || []).map(tag => <span key={tag} className="database-tag">{tag}</span>)}</p><p>{row.properties?.date || '未设置日期'}</p>
            {config.fields.map(field => <p key={field.id}><strong>{field.name}：</strong>{cell(row, field)}</p>)}
            {statusSelect(row)}<button type="button" aria-label={'编辑记录：' + (row.title || '无标题笔记')} disabled={disabled} onClick={() => setDialog({ kind: 'record', database, row })}>编辑属性</button>
          </article>)}</section>)}</div>}
      {!rows.length && !filterError && <p className="database-empty">{all.length ? '没有符合筛选条件的记录。' : '点击“新增记录”开始。每条记录都是可以打开编辑的笔记页面。'}</p>}
      {!embedded && <p className="database-hint">记录是此数据库的子页面。命名视图可在其他页面引用；修改记录会同步到所有引用处。</p>}
      {dialog?.kind === 'record' && <RecordDialog {...dialog} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'field' && <FieldDialog {...dialog} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'view' && <ViewDialog {...dialog} onCreated={id => { setLocal(null); if (embedded) onViewChange?.(id) }} onClose={() => setDialog(null)} />}
    </section>
  }
  return { View: DatabaseView }
}
export function mountDatabase(ctx, sdk, root, ui) {
  const { h, useObserve } = ctx.ui
  function Page() {
    const model = useObserve(ctx, ctx.notebook), note = model.current()
    return note?.type === 'database' ? <ui.View key={note.id} databaseId={note.id} /> : null
  }
  ctx.ui.mount(ctx, root, <Page />)
}
