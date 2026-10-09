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
  // 列表密度属于本页显示偏好，跨会话保留；无存储能力或读写失败时只降级为默认详细模式。
  const densityKey = 'cordis-notebook-list-density'
  const local = sdk.storage?.local ?? (typeof localStorage === 'undefined' ? null : localStorage)
  const readDensity = () => {
    try {
      return local?.getItem(densityKey) === 'compact' ? 'compact' : 'comfortable'
    } catch {
      return 'comfortable'
    }
  }
  const saveDensity = (value) => {
    try {
      local?.setItem(densityKey, value)
    } catch {
      /* 偏好无法写入时只在本次会话内生效 */
    }
  }
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
    // 只在筛选条件变更且可见集合确实变化时重播入场动效：排序、编辑和启动时的
    // 过滤器注册都不触发，避免拖动过程中卡片闪烁。
    const list = React.useRef(null)
    const filtersChanged = React.useRef(false)
    const signature = React.useRef(notes.map((note) => note.id).join(' '))
    const [filterSwitch, setFilterSwitch] = React.useState(0)
    React.useLayoutEffect(
      () => model.observe(ctx, (event) => { if (event?.reason === 'filters') filtersChanged.current = true }),
      []
    )
    const ids = notes.map((note) => note.id).join(' ')
    React.useLayoutEffect(() => {
      if (!filtersChanged.current) return
      filtersChanged.current = false
      if (signature.current === ids) return
      signature.current = ids
      setFilterSwitch((value) => value + 1)
    }, [ids])
    React.useLayoutEffect(() => {
      if (!filterSwitch || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
      const cards = [...(list.current?.querySelectorAll('.note-card, .no-results') || [])]
      if (typeof cards[0]?.animate !== 'function') return
      cards.forEach((card, index) => card.animate(
        [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
        { duration: 260, delay: Math.min(index * 22, 200), easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'backwards' }
      ))
    }, [filterSwitch])
    const [density, setDensity] = React.useState(readDensity)
    const compact = density === 'compact'
    // 切换密度时先记录每张卡片在旧模式下的几何值，React 提交新结构后再从旧值补间到新值：
    // 卡片高度、上下内边距和间距一起过渡，下面的卡片随实时布局平滑跟随。
    const densityMotion = React.useRef(null)
    const boxOf = (card) => {
      const style = getComputedStyle(card), rect = card.getBoundingClientRect()
      return { height: rect.height, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, marginBottom: style.marginBottom }
    }
    const toggleDensity = () => {
      const cards = [...(list.current?.querySelectorAll('.note-card') || [])]
      densityMotion.current = typeof cards[0]?.animate === 'function' ? cards.map((card) => ({ card, from: boxOf(card) })) : null
      setDensity((prev) => {
        const next = prev === 'compact' ? 'comfortable' : 'compact'
        saveDensity(next)
        return next
      })
    }
    React.useLayoutEffect(() => {
      const started = densityMotion.current
      densityMotion.current = null
      if (!started?.length) return
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
      const easing = 'cubic-bezier(.22,.61,.36,1)'
      for (const { card, from } of started) {
        const to = boxOf(card)
        // overflow 在动画期间保持 hidden，避免展开中的正文预览溢出到相邻卡片上。
        card.animate(
          [
            { ...from, height: `${from.height}px`, overflow: 'hidden' },
            { ...to, height: `${to.height}px`, overflow: 'hidden' }
          ],
          { duration: 240, easing }
        )
      }
      // 展开时新的预览与元信息已经挂载，延迟淡入避免文字在收放中突然出现。
      if (compact) return
      for (const { card } of started) {
        for (const node of card.querySelectorAll('.card-preview, .card-meta')) {
          node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 60, easing: 'linear', fill: 'backwards' })
        }
      }
    }, [compact])
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
          <div className="heading-actions">
            <Button
              size="icon"
              variant="ghost"
              className="density-toggle"
              aria-pressed={compact}
              aria-label={compact ? '切换为详细模式' : '切换为折叠模式'}
              title={
                compact
                  ? '折叠模式（只显示标题）· 点击切换为详细模式'
                  : '详细模式（显示正文预览）· 点击切换为折叠模式'
              }
              onClick={toggleDensity}
            >
              <Icon key={compact ? 'compact' : 'comfortable'} className="density-toggle-icon" name={compact ? 'List' : 'LayoutDashboard'} />
            </Button>
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
        </div>
        <Slot node={filters} />
        <div className={'note-list' + (compact ? ' compact' : '')} aria-label="笔记列表" ref={list}>
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
              {!compact && <p className="card-preview">{note.content || '还没有内容，开始记录吧…'}</p>}
              {!compact && (
                <div className="card-meta">
                  <span>{ctx.noteFormats.get(ctx.noteFormats.typeOf(note))?.label || '格式未启用'}</span>
                  <time>
                    {new Date(note.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                  </time>
                </div>
              )}
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
