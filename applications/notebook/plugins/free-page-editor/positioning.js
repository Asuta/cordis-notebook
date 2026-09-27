// Measure the first writing line with the same styles as a real container.
// Pointer coordinates are already in paper space; DOM rectangles include zoom.
export function writingOrigin(paper, point, zoom) {
  const probe = document.createElement('div')
  probe.className = 'free-block'
  probe.style.cssText = 'left:0;top:0;width:420px;visibility:hidden;pointer-events:none'
  probe.setAttribute('aria-hidden', 'true')
  const body = document.createElement('div'), prose = document.createElement('div'), paragraph = document.createElement('p')
  body.className = 'free-block-body'
  prose.className = 'outline-prose'
  paragraph.textContent = '\u200b'
  prose.append(paragraph); body.append(prose); probe.append(body); paper.append(probe)
  try {
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    const caret = range.getBoundingClientRect(), box = probe.getBoundingClientRect()
    return { x: Math.max(0, point.x - (caret.left - box.left) / zoom),
      y: Math.max(0, point.y - (caret.top + caret.height / 2 - box.top) / zoom) }
  } finally { probe.remove() }
}
