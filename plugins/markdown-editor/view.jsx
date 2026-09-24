export function mountToolbar(ctx, root, actions, modes, download) {
  const { h, React, Button, Icon } = ctx.ui,
    Fragment = React.Fragment
  const icons = ['Heading', 'Bold', 'Italic', 'List', 'Quote', 'Code2', 'Link']
  function Toolbar() {
    return (
      <>
        <div className="markdown-actions">
          {actions.map((button, i) => (
            <Button
              key={i}
              variant="ghost"
              size="icon"
              disabled={button.disabled}
              aria-label={button.getAttribute('aria-label')}
              title={button.textContent}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => button.click()}
            >
              <Icon name={icons[i]} />
            </Button>
          ))}
        </div>
        <div className="markdown-modes">
          {modes.map((button) => (
            <Button
              key={button.textContent}
              size="sm"
              variant={button.getAttribute('aria-pressed') === 'true' ? 'secondary' : 'ghost'}
              aria-label={button.getAttribute('aria-label')}
              aria-pressed={button.getAttribute('aria-pressed') === 'true'}
              onClick={() => button.click()}
            >
              {button.textContent}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="icon"
            aria-label="导出 Markdown 文件"
            onClick={() => download.click()}
          >
            <Icon name="Download" />
          </Button>
        </div>
      </>
    )
  }
  const view = ctx.ui.mount(ctx, root, <Toolbar />)
  return () => view.render(<Toolbar />)
}
