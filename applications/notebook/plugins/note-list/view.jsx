export function mountNoteList(ctx, sdk, root, filters) {
  const {
    h,
    React,
    Button,
    Icon,
    Slot,
    useObserve,
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem
  } = ctx.ui
  const Fragment = React.Fragment
  const run = (action) =>
    Promise.resolve()
      .then(action)
      .then(() => ctx.shell.showEditor?.())
      .catch((e) => sdk.toast(e.message))
  function NoteList() {
    const model = useObserve(ctx, ctx.notebook)
    useObserve(ctx, ctx.noteFormats)
    const formats = ctx.noteFormats.list(),
      notes = model.visible()
    const [drag, setDrag] = React.useState(null)
    const canReorder = !model.busy && notes.length > 1 && notes.length === model.notes.length
    const startDrag = (note) => (event) => {
      event.dataTransfer.setData('text/plain', note.id)
      event.dataTransfer.effectAllowed = 'move'
      setDrag({ id: note.id, over: null, position: null })
    }
    const overDrag = (note) => (event) => {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      const rect = event.currentTarget.getBoundingClientRect()
      const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
      setDrag((prev) => {
        if (!prev || prev.id === note.id) return prev
        if (prev.over === note.id && prev.position === position) return prev
        return { ...prev, over: note.id, position }
      })
    }
    const leaveDrag = (note) => (event) => {
      if (event.currentTarget.contains(event.relatedTarget)) return
      setDrag((prev) => (prev && prev.over === note.id ? { ...prev, over: null, position: null } : prev))
    }
    const dropDrag = (note) => (event) => {
      event.preventDefault()
      const id = event.dataTransfer.getData('text/plain') || drag?.id
      const position = drag?.position
      setDrag(null)
      if (!id || id === note.id) return
      const ordered = model.visible().map((item) => item.id)
      if (ordered.length !== model.notes.length || !ordered.includes(note.id)) return
      const from = ordered.indexOf(id)
      if (from < 0) return
      ordered.splice(from, 1)
      let to = ordered.indexOf(note.id)
      if (position === 'after') to += 1
      ordered.splice(to, 0, id)
      model.reorder(ordered).catch((error) => sdk.toast(error.message))
    }
    const endDrag = () => setDrag(null)
    return (
      <>
        <div className="section-heading">
          <div>
            <span className="section-eyebrow">个人空间</span>
            <h2>
              我的笔记 <span>{model.notes.length}</span>
            </h2>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" disabled={model.busy || !formats.length} aria-label="新建笔记">
                <Icon name="Plus" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="create-note-menu">
              {formats.map((format) => (
                <DropdownMenuItem
                  key={format.type}
                  disabled={model.busy}
                  onSelect={() => run(() => model.create(format.type))}
                >
                  <Icon name={format.icon || 'FileText'} />
                  <span>{format.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Slot node={filters} />
        <div className="note-list" aria-label="笔记列表">
          {notes.map((note) => (
            <button
              key={note.id}
              className={
                'note-card' +
                (note.id === model.selected ? ' selected' : '') +
                (drag?.id === note.id ? ' dragging' : '') +
                (drag?.over === note.id && drag.position === 'before' ? ' drop-before' : '') +
                (drag?.over === note.id && drag.position === 'after' ? ' drop-after' : '')
              }
              aria-current={note.id === model.selected ? 'page' : undefined}
              draggable={canReorder}
              disabled={model.busy}
              onDragStart={canReorder ? startDrag(note) : undefined}
              onDragOver={canReorder ? overDrag(note) : undefined}
              onDragLeave={canReorder ? leaveDrag(note) : undefined}
              onDrop={canReorder ? dropDrag(note) : undefined}
              onDragEnd={endDrag}
              onClick={() => run(() => model.choose(note.id))}
            >
              <div className="card-title">
                <Icon name={ctx.noteFormats.get(ctx.noteFormats.typeOf(note))?.icon || 'FileText'} />
                <span>{note.title || '无标题笔记'}</span>
                {note.pinned && <Icon name="Pin" size={13} />}
              </div>
              <p className="card-preview">{note.content || '还没有内容，开始记录吧…'}</p>
              <div className="card-meta">
                <span>{ctx.noteFormats.get(ctx.noteFormats.typeOf(note))?.label || '格式未启用'}</span>
                <time>
                  {new Date(note.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                </time>
              </div>
            </button>
          ))}
          {!notes.length && (
            <div className="no-results">
              <Icon name="BookOpen" size={26} />
              <strong>{model.notes.length ? '没有找到笔记' : '从第一篇笔记开始'}</strong>
              <p>{model.notes.length ? '试试其他关键词或切换筛选。' : '点击上方 ＋，选择一种记录方式。'}</p>
            </div>
          )}
        </div>
        <div className="sidebar-footer">
          <span className="local-dot" />
          已存储在此设备 <span>{notes.length} 篇</span>
        </div>
      </>
    )
  }
  ctx.ui.mount(ctx, root, <NoteList />)
}
