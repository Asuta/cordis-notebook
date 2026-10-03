export function mountLayout(ctx, sdk, main, targets) {
  const {
    h,
    React,
    Button,
    Icon,
    Slot,
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem
  } = ctx.ui
  function Actions() {
    const [, update] = React.useReducer((n) => n + 1, 0)
    React.useLayoutEffect(() => {
      const observer = new MutationObserver(update)
      const sync = () => {
        observer.disconnect()
        for (const node of targets.toolbarEntries())
          observer.observe(node, { childList: true, subtree: true, characterData: true, attributes: true })
        update()
      }
      targets.toolbarEvents.addEventListener('change', sync)
      sync()
      return () => {
        observer.disconnect()
        targets.toolbarEvents.removeEventListener('change', sync)
      }
    }, [])
    return targets
      .toolbarEntries()
      .filter((node) => !node.hidden)
      .map((node, i) =>
        node.tagName === 'BUTTON' ? (
          <DropdownMenuItem
            key={i}
            disabled={node.disabled}
            className={node.dataset.variant === 'destructive' ? 'text-destructive' : ''}
            aria-label={node.getAttribute('aria-label') || node.textContent}
            onSelect={() => node.click()}
          >
            {node.dataset.menuLabel || node.textContent}
          </DropdownMenuItem>
        ) : (
          <Slot key={i} node={node} />
        )
      )
  }
  function Layout() {
    const [collapsed, setCollapsed] = React.useState(false),
      [mobileEditor, setMobileEditor] = React.useState(() => sdk.storage.session.getItem('mobile-editor') === 'true')
    React.useEffect(() => { sdk.storage.session.setItem('mobile-editor', String(mobileEditor)) }, [mobileEditor])
    React.useEffect(() => {
      const show = () => setMobileEditor(true)
      main.addEventListener('show-editor', show)
      return () => main.removeEventListener('show-editor', show)
    }, [])
    return (
      <section
        className={
          'workspace' + (collapsed ? ' sidebar-collapsed' : '') + (mobileEditor ? ' mobile-editor' : '')
        }
      >
        <aside className="sidebar" aria-label="笔记导航">
          <Slot node={targets.sidebar} className="sidebar-content" />
        </aside>
        <section className="editor" aria-label="笔记工作区">
          <div className="editor-toolbar">
            <div className="workspace-controls">
              <Button
                variant="ghost"
                size="icon"
                className="desktop-sidebar-toggle"
                aria-label={collapsed ? '展开笔记列表' : '收起笔记列表'}
                aria-pressed={collapsed}
                onClick={() => setCollapsed(!collapsed)}
              >
                <Icon name={collapsed ? 'PanelLeftOpen' : 'PanelLeftClose'} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="mobile-back"
                onClick={() => setMobileEditor(false)}
              >
                <Icon name="ChevronLeft" />
                笔记
              </Button>
              <span className="workspace-label">我的工作区</span>
            </div>
            <div className="toolbar-right">
              <Slot node={targets.status} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="更多笔记操作">
                    <Icon name="MoreHorizontal" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="note-actions-menu">
                  <Actions />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <Slot node={targets.editor} className="editor-slot" />
          <footer className="editor-footer">
            <Slot node={targets.footer} />
            <span>本地笔记 · 自由记录</span>
          </footer>
          <Slot node={targets.panels} className="extensions" />
        </section>
      </section>
    )
  }
  ctx.ui.mount(ctx, main, <Layout />)
}
