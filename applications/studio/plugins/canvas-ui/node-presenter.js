import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { CanvasNode } from './upstream/canvas-node.js'

/** Upstream cards are views of canvasSession, never a second document store. */
export function mountNodeCard(card, initialNode, options, { session: s, view, size, selected }) {
  const root = createRoot(card)
  let node = initialNode, stopped = false, editing = false, editorRequest, panelOpen = false, lastUI
  const safe = callback => view.safe(callback)
  const endEditing = async () => {
    await s.flush()
    if (stopped) return
    if (document.activeElement === document.body || card.contains(document.activeElement)) view.stage.focus({ preventScroll: true })
    view.render()
  }
  function onEditingChange(active) {
    if (stopped || active === editing) return
    editing = active
    s.editing = active
    if (active) queueMicrotask(() => { if (!stopped) view.select([node.id]) })
    else void safe(endEditing)()
  }
  const draft = (property, value) => { s.draft(node, property, value); render(false) }
  const editor = (property, props = {}) => React.createElement('textarea', {
    ...props, 'aria-label': node.title + (property === 'prompt' ? ' 提示词' : ' 文字内容'), maxLength: 12000,
    value: s.drafts.get(node.id)?.patch[property] ?? node[property] ?? '',
    onFocus: () => onEditingChange(true), onInput: event => draft(property, event.target.value),
    onBlur: () => onEditingChange(false),
    onKeyDown: event => { if (event.key === 'Escape' && !(event.isComposing || event.nativeEvent?.isComposing)) { event.stopPropagation(); event.currentTarget.blur() } },
  })
  const togglePanel = () => { panelOpen = !panelOpen; if (panelOpen) view.select([node.id]); render(); if (panelOpen) view.revealPanel(node.id) }
  function render(sync = true) {
    if (stopped) return
    const dimensions = size(node), patch = s.drafts.get(node.id)?.patch || {}, asset = s.state.assets[node.assetId]
    const current = { ...node, ...patch }
    card.style.setProperty('--studio-panel-width', Math.min(600, view.stage.clientWidth ? view.stage.clientWidth - 32 : 600) + 'px')
    const data = {
      id: node.id, type: options.kind || node.type, title: current.title,
      position: { x: 0, y: 0 }, ...dimensions,
      definition: { hasSourceHandle: !!options.output, hasTargetHandle: !!options.input },
      metadata: { content: node.type === 'image' ? s.imageUrl(node.assetId, false) : current.text || '',
        storageKey: node.type === 'image' ? s.imageUrl(node.assetId) : undefined,
        naturalWidth: asset?.width, naturalHeight: asset?.height, bytes: asset?.bytes },
    }
    const helpers = { editor, togglePanel, safe, panelOpen }
    lastUI = `${s.viewport.zoom}:${selected(node.id)}`
    const element = React.createElement(CanvasNode, {
      data, scale: s.viewport.zoom, isSelected: selected(node.id), isRelated: false, isFocusRelated: false,
      isConnectionTarget: false, isConnecting: false, showImageInfo: node.type === 'image',
      showPanel: panelOpen && selected(node.id), editorRequest,
      renderNodeContent: options.content ? () => options.content(current, helpers) : undefined,
      renderPanel: options.panel ? () => options.panel(current, helpers) : undefined,
      onMouseDown() {}, onHoverStart() {}, onHoverEnd() {}, onConnectStart() {},
      onContentChange: (_, value) => draft('text', value),
      onTitleInput: (_, value) => s.draft(node, 'title', value),
      onTitleChange: (_, value) => { if (value !== node.title) s.draft(node, 'title', value) },
      onEditingChange, onViewImage: () => options.onViewImage?.(node),
      onContextMenu: event => { event.preventDefault(); view.select([node.id]) },
    })
    if (sync) flushSync(() => root.render(element))
    else root.render(element)
  }
  render()
  return {
    update(current) { node = current; render() },
    updateUI() { if (lastUI !== `${s.viewport.zoom}:${selected(node.id)}`) render() },
    edit(property = 'text') {
      if (options.panel && property === 'prompt') { panelOpen = true; view.select([node.id]); render(); view.revealPanel(node.id); card.querySelector('textarea')?.focus(); return }
      editorRequest = { property }; onEditingChange(true); render()
    },
    dispose() { stopped = true; if (editing) s.editing = false; root.unmount() },
  }
}
