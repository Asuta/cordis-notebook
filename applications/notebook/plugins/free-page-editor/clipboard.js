// Container clipboard and asset drops; text-editor clipboard remains in richText.
export function mountClipboard({ ctx, sdk, root, viewport, headingTarget, selection, blocks, nodes, uploading,
  editable, outline, renew, camera, contentTop, changeBlocks, removeSelected, clearActive, update, add, rich, upload }) {
  const copy = (event, cut = false) => {
    if (event.target.closest('[contenteditable=true],input,textarea') || !selection.size) return
    const selected = blocks().filter((b) => selection.has(b.id))
    event.clipboardData.setData('application/x-cordis-outlines', JSON.stringify({ version: 2, blocks: selected }))
    event.clipboardData.setData('text/plain', selected.map((b) => b.text).join('\n'))
    event.preventDefault()
    if (cut) removeSelected()
  }
  sdk.listen(root, 'copy', (e) => copy(e))
  sdk.listen(root, 'cut', (e) => copy(e, true))
  // Internal container data must be handled before a focused text editor sees
  // the paste. Ordinary text/HTML still belongs to that editor.
  const pasteContainers = (event) => {
    if (event.defaultPrevented || !editable() || !viewport.contains(event.target) ||
        event.target.closest('input,textarea') || headingTarget.contains(event.target)) return
    const raw = event.clipboardData?.getData('application/x-cordis-outlines')
    if (!raw) return
    event.preventDefault()
    event.stopPropagation()
    try {
      const pkg = JSON.parse(raw)
      if (pkg.version !== 2 || !Array.isArray(pkg.blocks) || !pkg.blocks.length ||
          pkg.blocks.some(b => !b || !Number.isFinite(b.x) || !Number.isFinite(b.y)))
        throw new Error('文本框剪贴板格式无效')
      const targetId = [...nodes].find(([, item]) => item.node.contains(event.target))?.[0]
      const target = blocks().find(b => b.id === targetId)
      const emptyTarget = target && !uploading.has(nodes.get(targetId)) && outline(target).elements.every(n =>
        ['paragraph', 'heading', 'code'].includes(n.kind) && !n.tag && n.runs.every(r => !r.text.trim()))
      const x = Math.min(...pkg.blocks.map(b => b.x)), y = Math.min(...pkg.blocks.map(b => b.y))
      const baseX = target ? target.x + (emptyTarget ? 0 : 24) : viewport.scrollLeft / camera.zoom + 40
      const baseY = target ? target.y + (emptyTarget ? 0 : 24) : Math.max(0, viewport.scrollTop / camera.zoom - contentTop) + 40
      const next = pkg.blocks.map(b => ({ ...b, id: crypto.randomUUID(),
        x: baseX + b.x - x, y: baseY + b.y - y, outline: renew(outline(b)) }))
      if (changeBlocks([...blocks().filter(b => !emptyTarget || b.id !== targetId), ...next])) {
        selection.clear()
        for (const b of next) selection.add(b.id)
        clearActive()
        update()
        viewport.focus({ preventScroll: true })
      }
    } catch (e) { sdk.toast('粘贴失败：' + e.message) }
  }
  ctx.effect(() => {
    root.addEventListener('paste', pasteContainers, true)
    return () => root.removeEventListener('paste', pasteContainers, true)
  })
  sdk.listen(root, 'paste', (event) => {
    if (event.defaultPrevented || !editable() || event.target.closest('[contenteditable=true],input,textarea')) return
    const text = event.clipboardData.getData('text/plain')
    const files = [...(event.clipboardData.files || [])].filter(f => f.type.startsWith('image/'))
    if (text.trim()) {
      event.preventDefault()
      add(undefined, undefined, rich.plain(text, crypto.randomUUID()))
      return
    }
    if (files.length) {
      event.preventDefault()
      void upload(files, null)
      return
    }
  })
  sdk.listen(viewport, 'dragover', (e) => {
    if (e.dataTransfer.types.includes('Files')) e.preventDefault()
  })
  sdk.listen(viewport, 'drop', (e) => {
    if (e.defaultPrevented || !editable()) return
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
    if (files.length) {
      e.preventDefault()
      const p = camera.point(e),
        id = add(p.x, p.y)
      void upload(files, id)
    }
  })
}
