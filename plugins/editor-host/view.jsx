export function mountEditorHost(ctx, sdk, root, content, views) {
  const {
    h,
    React,
    Slot,
    useObserve,
    Button,
    Icon,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
  } = ctx.ui
  const Fragment = React.Fragment
  let setDeleteOpen = () => {}
  function EditorHost() {
    const model = useObserve(ctx, ctx.notebook)
    useObserve(ctx, ctx.noteFormats)
    const note = model.current(),
      type = ctx.noteFormats.typeOf(note),
      format = ctx.noteFormats.get(type)
    const [open, setOpen] = React.useState(false),
      [deleting, setDeleting] = React.useState(false)
    setDeleteOpen = setOpen
    React.useLayoutEffect(() => {
      for (const [key, node] of views) node.hidden = !note || !format || key !== format.editor
    })
    const remove = async () => {
      setDeleting(true)
      try {
        await model.remove()
        setOpen(false)
      } catch (e) {
        sdk.toast(e.message)
      } finally {
        setDeleting(false)
      }
    }
    return (
      <>
        <div className={'writing editor-writing ' + (format?.editorClass || '')} hidden={!note}>
          <div className="note-heading">
            <div className="note-meta">
              <span>{format?.label || '格式未启用'}</span>
              <span>·</span>
              <time>{note && new Date(note.updatedAt).toLocaleDateString('zh-CN')}</time>
            </div>
            <input
              id="title"
              aria-label="笔记标题"
              spellCheck={false}
              maxLength={200}
              placeholder="无标题笔记"
              value={note?.title || ''}
              disabled={model.busy || !model.editable}
              onChange={(e) => model.edit({ title: e.target.value })}
            />
          </div>
          <Slot node={content} className="editor-content-slot" />
          {note && (!format || !views.has(format.editor)) && (
            <div className="editor-missing">
              <Icon name="Puzzle" size={28} />
              <h2>编辑器暂时不可用</h2>
              <p>
                {format ? `请在插件中心启用“${format.label}”对应的编辑器。` : `请启用“${type}”格式插件。`}
                笔记内容仍然保留。
              </p>
            </div>
          )}
        </div>
        <div className="empty" hidden={!!note}>
          <div className="empty-art">
            <Icon name="BookOpen" size={40} />
          </div>
          <span className="section-eyebrow">每个想法，都值得留下</span>
          <h2>给想法，一点留白。</h2>
          <p>从左侧选择笔记，或点击 ＋ 开始新的记录。</p>
        </div>
        <Dialog
          open={open}
          onOpenChange={(value) => {
            if (!deleting) setOpen(value)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>删除这篇笔记？</DialogTitle>
              <DialogDescription>
                “{note?.title || '无标题笔记'}”删除后无法恢复，可以先导出备份。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" disabled={deleting} onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button variant="destructive" disabled={deleting || model.busy || !note} onClick={remove}>
                {deleting ? '正在删除…' : '确认删除'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    )
  }
  const view = ctx.ui.mount(ctx, root, <EditorHost />)
  const remove = sdk.button('toolbar', '删除笔记', () => setDeleteOpen(true))
  remove.className = 'note-delete-action'
  remove.dataset.variant = 'destructive'
  remove.setAttribute('aria-label', '删除笔记')
  ctx.notebook.observe(ctx, () => {
    remove.disabled = !ctx.notebook.current() || ctx.notebook.busy
  })
  return () => view.render(<EditorHost />)
}
