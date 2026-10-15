import { createReactBlockSpec } from '@blocknote/react'

export function createDatabaseBlock(ctx, sdk) {
  const { h, React, useObserve } = ctx.ui
  const listeners = new Set()
  let api = null
  // The editor remains usable when the optional database renderer is disabled.
  ctx.inject(['databaseUI'], owner => {
    api = owner.databaseUI
    for (const notify of listeners) notify(api)
    owner.effect(() => () => { api = null; for (const notify of listeners) notify(null) })
  })
  function DatabaseBlock({ block, editor }) {
    const model = useObserve(ctx, ctx.notebook)
    const [renderer, setRenderer] = React.useState(() => api)
    React.useEffect(() => { listeners.add(setRenderer); setRenderer(api); return () => listeners.delete(setRenderer) }, [])
    const candidates = model.notes.filter(note => note.type === 'database' && !note.template)
    const current = candidates.find(note => note.id === block.props.databaseId)
    const disabled = !editor.isEditable || model.busy || model.conflict
    const change = props => {
      if (disabled) return
      try { editor.updateBlock(block, { props }) } catch (error) { sdk.toast(error.message) }
    }
    return <div className="notebook-database-block" contentEditable={false} onKeyDown={event => event.stopPropagation()}>
      <label>引用数据库<select aria-label="引用数据库" value={block.props.databaseId} disabled={disabled} onChange={event => change({ databaseId: event.target.value, viewId: '' })}>
        <option value="">选择已有数据库</option>
        {block.props.databaseId && !current && <option value={block.props.databaseId}>原数据库已不存在</option>}
        {candidates.map(note => <option value={note.id} key={note.id}>{note.title || '无标题数据库'}</option>)}
      </select></label>
      {!block.props.databaseId && <p>选择数据库后，可在正文里使用其表格或看板；所有引用处共享同一批记录。</p>}
      {block.props.databaseId && !current && <p role="status">引用的数据库已不存在，请重新选择；原引用仍保留，可在回收站恢复数据库。</p>}
      {current && !renderer && <p role="status">请启用“数据库与命名视图”插件以显示此数据库。</p>}
      {current && renderer && <renderer.View key={block.props.databaseId} databaseId={block.props.databaseId} viewId={block.props.viewId || undefined} embedded readOnly={!editor.isEditable}
        onViewChange={viewId => change({ viewId })} />}
    </div>
  }
  return createReactBlockSpec({ type: 'databaseView', propSchema: { databaseId: { default: '' }, viewId: { default: '' } }, content: 'none' }, {
    render: DatabaseBlock,
    toExternalHTML: ({ block }) => <div data-notebook-database={block.props.databaseId} data-notebook-view={block.props.viewId}>数据库引用（需在原笔记库或完整备份中打开）</div>,
    parse: element => element.hasAttribute('data-notebook-database') ? { databaseId: element.getAttribute('data-notebook-database'), viewId: element.getAttribute('data-notebook-view') || '' } : undefined,
  })()
}
