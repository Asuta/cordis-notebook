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
              className={'note-card' + (note.id === model.selected ? ' selected' : '')}
              aria-current={note.id === model.selected ? 'page' : undefined}
              disabled={model.busy}
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
