// Uploads retain their original note, editor instance and caret until insertion.
export function createUploads({ assets, toast, active, noteId, disposed, editable, add, nodes, uploading, cleanupAfterBlur }) {
  return async (files, id = active()) => {
    const expected = noteId()
    if (!editable()) return
    if (!id) id = add()
    const item = nodes.get(id)
    if (!item) return
    const pos = item.editor.editor?.state.selection.from
    uploading.set(item, (uploading.get(item) || 0) + 1)
    try {
      for (const file of files) {
        const src = await assets.upload(file)
        if (disposed() || noteId() !== expected || !editable() || nodes.get(id) !== item) {
          toast('图片已保存，页面已切换，请回到原页重新插入。')
          return
        }
        if (pos != null)
          item.editor.editor.commands.setTextSelection(Math.min(pos, item.editor.editor.state.doc.content.size))
        item.editor.exec('image', { src, alt: file.name || '粘贴的图片', width: 320 })
      }
    } catch (e) {
      toast(e.message)
    } finally {
      const count = uploading.get(item) - 1
      if (count) uploading.set(item, count)
      else uploading.delete(item)
      if (!disposed() && noteId() === expected) cleanupAfterBlur(id)
    }
  }
}
