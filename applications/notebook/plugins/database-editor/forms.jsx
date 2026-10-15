export const typeLabels = { text: '文本', number: '数字', select: '单选', multiSelect: '多选', checkbox: '复选框', date: '日期', url: '链接' }
export function createForms(ctx, sdk) {
  const { h, React } = ctx.ui, model = ctx.notebook, schema = ctx.databaseSchema
  const pending = new Set(), saving = new Set()
  const guard = () => { if ([...pending].some(key => !saving.has(key))) throw Error('数据库记录或设置有未保存修改，请先保存或取消') }
  ctx.on('plugins/before-stop', guard); ctx.on('notebook/before-action', guard)
  sdk.listen(window, 'beforeunload', event => { if (pending.size) { event.preventDefault(); event.returnValue = '' } })
  function useDraft(initial) {
    const [draft, setDraft] = React.useState(() => structuredClone(initial))
    const [key] = React.useState(() => Symbol('database-form'))
    const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('')
    const alive = React.useRef(true)
    React.useEffect(() => () => { alive.current = false; pending.delete(key); saving.delete(key) }, [])
    const change = patch => { pending.add(key); setDraft(value => ({ ...value, ...patch })) }
    const submit = async (action, close) => {
      if (busy || model.busy) return
      setBusy(true); setError(''); saving.add(key)
      try { const result = await action(); if (!result) throw Error('操作未完成，请重试'); pending.delete(key); if (alive.current) close() }
      catch (error) { if (alive.current) setError(error.message) }
      finally { saving.delete(key); if (alive.current) setBusy(false) }
    }
    return { draft, change, busy, error, submit }
  }
  function Modal({ title, state, onClose, onSubmit, children, extra, saveLabel = '保存' }) {
    const ref = React.useRef(null)
    React.useEffect(() => { ref.current.showModal() }, [])
    return <dialog ref={ref} className="database-dialog" aria-label={title} onCancel={event => { event.preventDefault(); if (!state.busy) onClose() }} onKeyDown={event => event.stopPropagation()}>
      <form onSubmit={event => { event.preventDefault(); void state.submit(onSubmit, onClose) }}>
        <h2>{title}</h2><fieldset disabled={state.busy || model.busy}>{children}</fieldset>
        {state.error && <p role="alert">{state.error}</p>}
        <div className="database-actions">{extra}<button type="button" disabled={state.busy} onClick={onClose}>取消</button><button type="submit" disabled={state.busy || model.busy}>{state.busy ? '保存中…' : saveLabel}</button></div>
      </form>
    </dialog>
  }
  function ValueInput({ field, value, onChange, label = '属性：' + field.name, disabled = false }) {
    if (field.type === 'checkbox') return <select aria-label={label} disabled={disabled} value={value == null ? '' : String(value)} onChange={event => onChange(event.target.value === '' ? null : event.target.value === 'true')}><option value="">未设置</option><option value="true">是</option><option value="false">否</option></select>
    if (field.type === 'select') return <select aria-label={label} disabled={disabled} value={value ?? ''} onChange={event => onChange(event.target.value || null)}><option value="">未设置</option>{field.options.map(option => <option key={option} value={option}>{option}</option>)}</select>
    if (field.type === 'multiSelect') return <select aria-label={label} disabled={disabled} multiple value={value || []} onChange={event => onChange([...event.target.selectedOptions].map(option => option.value))}>{field.options.map(option => <option key={option} value={option}>{option}</option>)}</select>
    const type = field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : 'text'
    const change = event => onChange(event.target.value === '' ? null : field.type === 'number' ? Number(event.target.value) : event.target.value)
    return <input aria-label={label} disabled={disabled} type={type} step={type === 'number' ? 'any' : undefined} maxLength={2000} value={value ?? ''} onInput={type === 'date' ? change : undefined} onChange={change} />
  }
  function RecordDialog({ database, row = {}, onClose }) {
    const config = schema.normalize(database.database)
    const formats = ctx.noteFormats.list().filter(format => format.type !== 'database')
    const defaultType = formats.find(format => format.type === 'blocknote')?.type
      || formats.find(format => format.type === 'plain')?.type || formats[0]?.type || ''
    const state = useDraft({ title: row.title || '', type: row.type || defaultType, status: row.properties?.status || 'todo', tags: (row.properties?.tags || []).join(', '), date: row.properties?.date || '', custom: row.properties?.custom || {} })
    const { draft, change } = state
    const save = () => {
      const current = model.notes.find(note => note.id === database.id)
      if (!current || current.revision !== database.revision) throw Error('数据库字段或视图已变化，请取消后重新打开表单')
      const properties = { status: draft.status, tags: draft.tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean), date: draft.date || null, custom: draft.custom }
      schema.validateRows(config, [{ properties }])
      return row.id ? model.updateNote(row.id, { title: draft.title, properties }, row.revision)
        : model.create(draft.type, { title: draft.title, properties, parentId: database.id }, { select: false })
    }
    return <Modal title={row.id ? '编辑记录' : '新增记录'} state={state} onClose={onClose} onSubmit={save} saveLabel="保存记录">
      <label>记录标题<input aria-label="记录标题" required maxLength={200} value={draft.title} onChange={event => change({ title: event.target.value })} autoFocus /></label>
      {!row.id && <label>正文格式<select aria-label="记录正文格式" required value={draft.type} onChange={event => change({ type: event.target.value })}>{formats.map(format => <option key={format.type} value={format.type}>{format.label}</option>)}</select></label>}
      <label>状态<select aria-label="记录状态" value={draft.status} onChange={event => change({ status: event.target.value })}>{schema.statuses.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>标签<input aria-label="记录标签" placeholder="用逗号分隔" value={draft.tags} onChange={event => change({ tags: event.target.value })} /></label>
      <label>日期<input aria-label="记录日期" type="date" value={draft.date} onInput={event => change({ date: event.target.value })} onChange={event => change({ date: event.target.value })} /></label>
      {config.fields.map(field => <label key={field.id}>{field.name}<ValueInput field={field} value={draft.custom[field.id]} onChange={value => change({ custom: { ...draft.custom, [field.id]: value } })} /></label>)}
    </Modal>
  }
  function FieldDialog({ database, field, onClose }) {
    const initial = field || { id: 'f_' + crypto.randomUUID(), name: '', type: 'text' }
    const state = useDraft({ ...initial, optionsText: (initial.options || []).join('\n') }), { draft, change } = state
    const save = async remove => {
      const config = schema.normalize(database.database)
      const value = { id: draft.id, name: draft.name, type: draft.type, ...(['select', 'multiSelect'].includes(draft.type) ? { options: draft.optionsText.split(/\n|,|，/).map(value => value.trim()).filter(Boolean) } : {}) }
      const fields = remove ? config.fields.filter(item => item.id !== draft.id) : field ? config.fields.map(item => item.id === draft.id ? value : item) : [...config.fields, value]
      const views = config.views.map(view => ({ ...view, filter: { ...view.filter, rules: view.filter.rules.filter(rule => !remove || rule.field !== draft.id), ...(remove && view.filter.sort === draft.id ? { sort: 'updated', direction: 'desc' } : {}) } }))
      const next = schema.normalize({ ...config, fields, views })
      return model.updateNote(database.id, { database: next }, database.revision)
    }
    return <Modal title={field ? '编辑字段' : '新增字段'} state={state} onClose={onClose} onSubmit={() => save(false)} extra={field && <button type="button" disabled={state.busy || model.busy} onClick={() => state.submit(() => save(true), onClose)}>删除此字段</button>}>
      <label>字段名称<input aria-label="字段名称" required maxLength={80} value={draft.name} onChange={event => change({ name: event.target.value })} autoFocus /></label>
      <label>字段类型<select aria-label="字段类型" value={draft.type} onChange={event => change({ type: event.target.value })}>{Object.entries(typeLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      {['select', 'multiSelect'].includes(draft.type) && <label>选项，每行一个<textarea aria-label="字段选项" rows={5} value={draft.optionsText} onChange={event => change({ optionsText: event.target.value })} /></label>}
      <p>改名保留数据。删除字段会移除相关筛选，已有属性值仍保留在记录和备份中；不兼容的类型或选项变更会被拒绝。</p>
    </Modal>
  }
  function ViewDialog({ database, view, filter, duplicate = false, embedded = false, onClose, onCreated }) {
    const state = useDraft({ name: duplicate ? '' : view.name, layout: view.layout }), { draft, change } = state
    const save = async remove => {
      const config = schema.normalize(database.database), id = duplicate ? 'v_' + crypto.randomUUID() : view.id
      const next = { id, name: draft.name, layout: draft.layout, filter }
      const views = remove ? config.views.filter(item => item.id !== id) : duplicate ? [...config.views, next] : config.views.map(item => item.id === id ? next : item)
      const activeViewId = remove ? (config.activeViewId === id ? views[0]?.id : config.activeViewId) : embedded ? config.activeViewId : id
      const result = await model.updateNote(database.id, { database: schema.normalize({ ...config, views, activeViewId }) }, database.revision)
      if (result && onCreated) onCreated(remove ? views[0]?.id : id)
      return result
    }
    return <Modal title={duplicate ? '新建视图' : '编辑视图'} state={state} onClose={onClose} onSubmit={() => save(false)} extra={!duplicate && <button type="button" disabled={state.busy || model.busy || database.database.views?.length === 1} onClick={() => state.submit(() => save(true), onClose)}>删除此视图</button>}>
      <label>视图名称<input aria-label="视图名称" required maxLength={80} value={draft.name} onChange={event => change({ name: event.target.value })} autoFocus /></label>
      <label>展示方式<select aria-label="视图布局" value={draft.layout} onChange={event => change({ layout: event.target.value })}><option value="table">表格</option><option value="board">看板</option></select></label>
      <p>保存此名称、布局和当前筛选排序。其他引用此视图的页面会同步使用这些设置。</p>
    </Modal>
  }
  return { RecordDialog, FieldDialog, ViewDialog, ValueInput }
}
