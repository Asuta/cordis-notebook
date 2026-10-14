import { docToBlocks, filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from '@blocknote/core'
import { zh } from '@blocknote/core/locales'
import { useCreateBlockNote, SuggestionMenuController, getDefaultReactSlashMenuItems } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/ariakit'

export function mountBlockNote(ctx, sdk, root, schema) {
  const { h, React } = ctx.ui, model = ctx.notebook, service = ctx.blockNoteDocument
  const mount = sdk.el('div', { class: 'blocknote-scroll' })
  const help = sdk.el('div', { class: 'blocknote-help' }, '输入 / 插入内容 · @ 引用页面 · 拖动手柄排序 · Tab 嵌套 · Ctrl+S 保存')
  const errorBox = sdk.el('p', { class: 'blocknote-error', role: 'alert', hidden: true })
  root.append(help, errorBox, mount)
  let editor, noteId, lastDocument, epoch = 0, disposed = false, view, renderedKey, pending = false, lastError = ''
  const editable = () => !disposed && !sdk.signal.aborted && model.current()?.id === noteId && !model.busy && model.editable && !model.conflict
  const report = error => {
    errorBox.hidden = false; errorBox.textContent = '未应用这次修改：' + error.message
    if (lastError !== error.message) sdk.toast(error.message)
    lastError = error.message
  }
  const serialize = blocks => service.normalize({ version: 1, blocks: JSON.parse(JSON.stringify(blocks)) })
  function Editor({ initialContent, id, readonly }) {
    const instance = useCreateBlockNote({
      initialContent, dictionary: zh, schema,
      tables: { splitCells: true, cellBackgroundColor: true, cellTextColor: true, headers: true },
      domAttributes: { editor: { 'aria-label': 'BlockNote 正文', spellcheck: 'false' } },
      uploadFile: async file => {
        if (!editable() || editor !== instance || noteId !== id) throw Error('当前不可上传')
        try {
          const url = await ctx.noteAssets.uploadAttachment(file)
          if (!editable() || editor !== instance || noteId !== id) throw Error('页面已切换，图片不会插入其他笔记')
          return url
        } catch (error) { sdk.toast(error.message); throw error }
      },
    }, [])
    React.useLayoutEffect(() => {
      editor = instance
      const offBefore = instance.onBeforeChange(({ tr }) => {
        if (!tr.docChanged) return
        if (!editable() || editor !== instance) return false
        try {
          const blocks = JSON.parse(JSON.stringify(docToBlocks(tr.doc))), ids = new Set()
          // BlockNote's ID extension repairs pasted/just-created IDs after the
          // transaction filter. Validate content now; validate final IDs on save.
          const prepare = list => list.forEach(block => {
            if (!block.id || ids.has(block.id)) block.id = crypto.randomUUID()
            ids.add(block.id); prepare(block.children || [])
          })
          prepare(blocks); serialize(blocks)
        } catch (error) { report(error); return false }
      })
      const offChange = instance.onChange(() => {
        if (editor !== instance || !editable()) return
        try {
          const document = serialize(instance.document), serialized = JSON.stringify(document)
          if (serialized === lastDocument) return
          model.edit({ document }); lastDocument = serialized
          errorBox.hidden = true; lastError = ''
        } catch (error) { report(error) }
      })
      return () => { offBefore(); offChange(); if (editor === instance) editor = null }
    }, [instance])
    return <BlockNoteView editor={instance} editable={!readonly} theme="light" className="cordis-blocknote" slashMenu={false}>
      <SuggestionMenuController triggerCharacter="/" getItems={async query => filterSuggestionItems([
        ...getDefaultReactSlashMenuItems(instance),
        ...[['callout', '提示框', 'callout'], ['equation', '公式', 'math equation'], ['tableOfContents', '目录', 'toc contents']].map(([type, title, alias]) => ({
          title, group: '页面组件', aliases: [title, ...alias.split(' ')], onItemClick: () => { if (editable()) insertOrUpdateBlockForSlashMenu(instance, { type }) },
        })),
        { title: '行内公式', group: '页面组件', aliases: ['inline math', '行内公式'], onItemClick: () => { if (editable()) instance.insertInlineContent([{ type: 'math', props: { expression: '' } }, ' ']) } },
      ], query)} />
      <SuggestionMenuController triggerCharacter="@" getItems={async query => model.notes
        .filter(note => note.id !== id && (note.title || '无标题笔记').toLowerCase().includes(query.toLowerCase())).slice(0, 30)
        .map(note => ({ title: note.title || '无标题笔记', subtext: '引用笔记页面', group: '页面',
          onItemClick: () => {
            if (!editable() || editor !== instance || noteId !== id || !model.notes.some(item => item.id === note.id)) return
            instance.insertInlineContent([{ type: 'pageLink', props: { noteId: note.id, title: note.title || '无标题笔记' } }, ' '])
          },
        }))} />
    </BlockNoteView>
  }
  function render() {
    pending = false
    if (disposed) return
    const note = model.current()
    if (note?.type !== 'blocknote') {
      noteId = null; lastDocument = null; renderedKey = null; editor = null
      view?.render(null); return
    }
    const serialized = JSON.stringify(note.document)
    if (noteId !== note.id || serialized !== lastDocument) {
      if (noteId !== note.id) mount.scrollTop = 0
      noteId = note.id; lastDocument = serialized; renderedKey = noteId + ':' + ++epoch
      errorBox.hidden = true; lastError = ''
    }
    const content = h(Editor, { key: renderedKey, id: noteId, initialContent: structuredClone(note.document.blocks.length ? note.document.blocks : [service.create()]), readonly: !editable() })
    if (!view) view = ctx.ui.mount(ctx, mount, content)
    else view.render(content)
  }
  // Schedule outside synchronous editor transactions so local edits do not
  // remount their own view; external/Agent edits create a fresh undo boundary.
  const refresh = () => { if (!pending) { pending = true; queueMicrotask(render) } }
  model.observe(ctx, refresh)
  sdk.agent?.selection(root, () => {
    if (!editor || !editable()) return null
    const instance = editor, id = noteId, state = instance.prosemirrorView.state, selection = state.selection
    if (selection.empty || !selection.$from.sameParent(selection.$to) || !selection.$from.parent.isTextblock) return null
    const text = state.doc.textBetween(selection.from, selection.to, '\n'), snapshot = JSON.stringify(instance.document), bookmark = selection.getBookmark()
    return { text, noteId: id, label: model.current().title || 'BlockNote 选区', formats: ['text'], apply: async text => {
      const rejection = await ctx.serial('notebook/before-action')
      if (rejection !== undefined && rejection !== null && rejection !== false) throw Error(String(rejection))
      if (typeof text !== 'string' || !editable() || instance !== editor || noteId !== id || snapshot !== JSON.stringify(instance.document)) throw Error('笔记或选区已变化，请重新添加选区')
      const state = instance.prosemirrorView.state
      const transaction = state.tr.setSelection(bookmark.resolve(state.doc)).insertText(text)
      serialize(docToBlocks(transaction.doc))
      instance.prosemirrorView.dispatch(transaction); instance.focus()
      await model.flush(); return { updated: true }
    } }
  })
  ctx.effect(() => () => { disposed = true; editor = null })
}
