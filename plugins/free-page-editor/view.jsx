export function mountControls(ctx, root, buttons) {
  const { h, Button, Icon } = ctx.ui
  const names = ['Plus', 'Undo2', 'Redo2', 'Trash2'],
    labels = ['文字块', '撤销', '重做', '删除文字块']
  function Controls() {
    return (
      <>
        <div className="free-page-tools">
          {buttons.map((button, i) => (
            <Button
              key={i}
              size="sm"
              variant={i === 0 ? 'secondary' : 'ghost'}
              disabled={button.disabled}
              aria-label={button.getAttribute('aria-label') || labels[i]}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => button.click()}
            >
              <Icon name={names[i]} />
              <span>{labels[i]}</span>
            </Button>
          ))}
        </div>
        <span className="free-page-hint">双击空白处书写 · 拖动手柄移动</span>
      </>
    )
  }
  const Fragment = ctx.ui.React.Fragment
  const view = ctx.ui.mount(ctx, root, <Controls />)
  return () => view.render(<Controls />)
}
