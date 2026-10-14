import { BlockNoteSchema, defaultInlineContentSpecs, defaultBlockSpecs } from '@blocknote/core'
import { createReactInlineContentSpec } from '@blocknote/react'
import { extraSpecs } from './extra-blocks.jsx'

export function createSchema(ctx, sdk) {
  const { h, useObserve } = ctx.ui
  const PageLink = createReactInlineContentSpec({ type: 'pageLink', propSchema: { noteId: { default: '' }, title: { default: '' } }, content: 'none' }, {
    render({ inlineContent }) {
      const model = useObserve(ctx, ctx.notebook, { reasons: ['edit', 'selection', 'busy'] })
      const target = model.notes.find(note => note.id === inlineContent.props.noteId)
      const label = target ? target.title || '无标题笔记' : inlineContent.props.title || '无标题笔记'
      return <button type="button" contentEditable={false} className={'page-reference' + (!target ? ' missing' : '')}
        aria-label={target ? '打开页面：' + label : '页面已不存在：' + label} disabled={!target || model.busy}
        onMouseDown={event => event.preventDefault()}
        onClick={() => model.choose(target.id).then(() => ctx.shell?.showEditor?.()).catch(error => sdk.toast(error.message))}>
        ↗ {label}{!target && '（已不存在）'}
      </button>
    },
    toExternalHTML: ({ inlineContent }) => <span data-page-reference={inlineContent.props.noteId}>{inlineContent.props.title || '页面引用'}</span>,
    parse: element => element.hasAttribute('data-page-reference') ? { noteId: element.getAttribute('data-page-reference'), title: element.textContent.slice(0, 200) } : undefined,
  })
  const extra = extraSpecs(ctx, sdk)
  return BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, ...extra.blocks }, inlineContentSpecs: { ...defaultInlineContentSpecs, pageLink: PageLink, ...extra.inline } })
}
