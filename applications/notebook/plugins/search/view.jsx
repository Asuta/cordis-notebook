export function mountSearch(ctx, root, filter) {
  const { h, React, Input, Button, Icon } = ctx.ui
  function Search() {
    const [query, setQuery] = React.useState(''),
      input = React.useRef(null)
    React.useEffect(() => {
      const listener = (e) => {
        const tag = document.activeElement?.tagName
        if (
          e.key === '/' &&
          !['INPUT', 'TEXTAREA'].includes(tag) &&
          !document.activeElement?.isContentEditable
        ) {
          e.preventDefault()
          input.current?.focus()
        }
      }
      document.addEventListener('keydown', listener)
      return () => document.removeEventListener('keydown', listener)
    }, [])
    const update = (value) => {
      setQuery(value)
      const term = value.toLocaleLowerCase()
      filter.update((note) => (note.title + '\n' + note.content).toLocaleLowerCase().includes(term))
    }
    return (
      <div className="search">
        <Icon name="Search" />
        <Input
          ref={input}
          type="search"
          aria-label="搜索笔记"
          placeholder="搜索笔记…"
          value={query}
          onChange={(e) => update(e.target.value)}
        />
        {query ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label="清空搜索"
            onClick={() => {
              update('')
              input.current?.focus()
            }}
          >
            <Icon name="X" />
          </Button>
        ) : (
          <kbd>/</kbd>
        )}
      </div>
    )
  }
  ctx.ui.mount(ctx, root, <Search />)
}
