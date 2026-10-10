export function cardBounds(nodes, size) {
  if (!nodes.length) return null
  const x = Math.min(...nodes.map(n => n.x)), y = Math.min(...nodes.map(n => n.y))
  return { x, y, width: Math.max(...nodes.map(n => n.x + size(n).width)) - x,
    height: Math.max(...nodes.map(n => n.y + size(n).height)) - y }
}

export function fitView(bounds, width, height, bottom = 80, top = 32) {
  if (!bounds || width <= 0 || height <= 0) return null
  const usableWidth = Math.max(1, width - 64), usableHeight = Math.max(1, height - bottom - top - 32)
  const zoom = Math.max(.15, Math.min(1.25, usableWidth / Math.max(1, bounds.width), usableHeight / Math.max(1, bounds.height)))
  return { x: Math.max(-100000, Math.min(100000, 32 + (usableWidth - bounds.width * zoom) / 2 - bounds.x * zoom)),
    y: Math.max(-100000, Math.min(100000, top + (usableHeight - bounds.height * zoom) / 2 - bounds.y * zoom)), zoom }
}

export function arrangeCards(nodes, direction, size) {
  if (nodes.length < 2) return []
  const ordered = [...nodes].sort((a, b) => direction === 'horizontal' ? a.x - b.x || a.y - b.y : a.y - b.y || a.x - b.x)
  const x = Math.min(...nodes.map(n => n.x)), y = Math.min(...nodes.map(n => n.y))
  let cursor = direction === 'horizontal' ? x : y
  return ordered.map(n => {
    const patch = { x: direction === 'horizontal' ? cursor : x, y: direction === 'vertical' ? cursor : y }
    if (Math.abs(patch.x) > 100000 || Math.abs(patch.y) > 100000) throw Error('排列超出画布边界，请先将卡片移近中心。')
    cursor += (direction === 'horizontal' ? size(n).width : size(n).height) + 40
    return { type: 'update', id: n.id, patch }
  })
}

export function moveDelta(nodes, dx, dy) {
  return { x: Math.max(-100000 - Math.min(...nodes.map(n => n.x)), Math.min(100000 - Math.max(...nodes.map(n => n.x)), dx)),
    y: Math.max(-100000 - Math.min(...nodes.map(n => n.y)), Math.min(100000 - Math.max(...nodes.map(n => n.y)), dy)) }
}

export function overlayPosition(anchor, width, height, stageWidth, stageHeight, bottom = 0) {
  const maxX = Math.max(8, stageWidth - width - 8), maxY = Math.max(8, stageHeight - bottom - height - 8)
  const above = anchor.y - height - 14, below = anchor.y + anchor.height + 14
  return { x: Math.max(8, Math.min(maxX, anchor.x + anchor.width / 2 - width / 2)),
    y: Math.max(8, Math.min(maxY, above >= 8 ? above : below <= maxY ? below : 8)) }
}
