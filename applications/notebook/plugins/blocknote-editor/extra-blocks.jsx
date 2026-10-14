import { defaultProps } from '@blocknote/core'
import { createReactBlockSpec, createReactInlineContentSpec, useEditorChange } from '@blocknote/react'
import katex from 'katex'

export function extraSpecs(ctx, sdk) {
  const { h, React } = ctx.ui
  const pending = new Set()
  const guard = () => { if (pending.size) throw Error('行内公式有未保存修改，请先点击完成或取消') }
  ctx.on('plugins/before-stop', guard); ctx.on('notebook/before-action', guard)
  sdk.listen(window, 'beforeunload', event => { if (pending.size) { event.preventDefault(); event.returnValue = '' } })
  const mathHTML = (expression, displayMode) => katex.renderToString(expression || '\\text{公式}', { displayMode, throwOnError: false, trust: false, strict: 'ignore', output: 'mathml', maxExpand: 200, maxSize: 10 })
  function MathView({ expression, displayMode = true }) {
    return <span className="notebook-math-preview" dangerouslySetInnerHTML={{ __html: mathHTML(expression, displayMode) }} />
  }
  const input = (value, change, editable) => <input aria-label="LaTeX 公式" maxLength={4096} placeholder="例如：x^2 + y^2 = z^2" value={value}
    disabled={!editable} onKeyDown={event => event.stopPropagation()} onChange={event => change(event.target.value)} />
  const equation = createReactBlockSpec({ type: 'equation', propSchema: { expression: { default: '' } }, content: 'none' }, {
    render: ({ block, editor }) => <div className="notebook-equation" contentEditable={false}>
      {input(block.props.expression, expression => editor.updateBlock(block, { props: { expression } }), editor.isEditable)}
      <MathView expression={block.props.expression} />
    </div>,
    toExternalHTML: ({ block }) => <div data-notebook-equation={block.props.expression}>{block.props.expression}</div>,
    parse: element => element.hasAttribute('data-notebook-equation') ? { expression: element.getAttribute('data-notebook-equation') } : undefined,
  })()
  const math = createReactInlineContentSpec({ type: 'math', propSchema: { expression: { default: '' } }, content: 'none' }, {
    render: ({ inlineContent, updateInlineContent, editor }) => {
      const [editing, setEditing] = React.useState(!inlineContent.props.expression)
      const [draft, setDraft] = React.useState(inlineContent.props.expression)
      const [key] = React.useState(() => Symbol('math-draft'))
      React.useEffect(() => () => pending.delete(key), [])
      return <span className="notebook-inline-math" contentEditable={false}>
        {editing ? <span>{input(draft, value => { if (value !== inlineContent.props.expression) pending.add(key); else pending.delete(key); setDraft(value) }, editor.isEditable)}
          <button type="button" disabled={!editor.isEditable} onClick={() => { pending.delete(key); updateInlineContent({ type: 'math', props: { expression: draft } }); setEditing(false) }}>完成</button>
          <button type="button" onClick={() => { pending.delete(key); setDraft(inlineContent.props.expression); setEditing(false) }}>取消</button></span>
          : <button type="button" aria-label="编辑行内公式" disabled={!editor.isEditable} onClick={() => { setDraft(inlineContent.props.expression); setEditing(true) }}><MathView expression={inlineContent.props.expression} displayMode={false} /></button>}
      </span>
    },
    toExternalHTML: ({ inlineContent }) => <span data-notebook-math={inlineContent.props.expression}>{inlineContent.props.expression}</span>,
    parse: element => element.hasAttribute('data-notebook-math') ? { expression: element.getAttribute('data-notebook-math') } : undefined,
  })
  const callout = createReactBlockSpec({ type: 'callout', propSchema: { ...defaultProps, tone: { default: 'info', values: ['info', 'warning', 'success'] } }, content: 'inline' }, {
    render: ({ block, editor, contentRef }) => <div className={'notebook-callout ' + block.props.tone}>
      <select contentEditable={false} aria-label="提示框样式" value={block.props.tone} disabled={!editor.isEditable}
        onChange={event => editor.updateBlock(block, { props: { tone: event.target.value } })}>
        <option value="info">💡 提示</option><option value="warning">⚠ 注意</option><option value="success">✓ 完成</option>
      </select><div ref={contentRef} />
    </div>,
    toExternalHTML: ({ block, contentRef }) => <aside data-notebook-callout={block.props.tone}><div ref={contentRef} /></aside>,
    parse: element => element.hasAttribute('data-notebook-callout') ? { tone: element.getAttribute('data-notebook-callout') } : undefined,
  })()
  const headings = editor => {
    const result = []
    const visit = blocks => { for (const block of blocks) {
      if (block.type === 'heading') result.push({ id: block.id, level: block.props.level, title: ctx.blockNoteDocument.text({ version: 1, blocks: [{ ...block, children: [] }] }) || '无标题章节' })
      visit(block.children)
    } }
    visit(editor.document); return result
  }
  function Contents({ editor }) {
    const [items, setItems] = React.useState(() => headings(editor))
    useEditorChange(() => setItems(headings(editor)), editor)
    return <nav className="notebook-toc" aria-label="页面目录" contentEditable={false}><strong>目录</strong>
      {!items.length && <p>添加标题后，目录会自动更新。</p>}
      {items.map(item => <button key={item.id} type="button" style={{ paddingLeft: (item.level - 1) * 14 }}
        onClick={() => { editor.setTextCursorPosition(item.id, 'start'); editor.domElement.querySelector('[data-id="' + item.id + '"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); editor.focus() }}>{item.title}</button>)}
    </nav>
  }
  const tableOfContents = createReactBlockSpec({ type: 'tableOfContents', propSchema: {}, content: 'none' }, {
    render: Contents,
    toExternalHTML: ({ editor }) => <nav data-notebook-toc="true">{headings(editor).map(item => <div key={item.id}>{item.title}</div>)}</nav>,
    parse: element => element.hasAttribute('data-notebook-toc') ? {} : undefined,
  })()
  return { blocks: { callout, equation, tableOfContents }, inline: { math } }
}
