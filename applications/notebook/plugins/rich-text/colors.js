// Display-only contrast adaptation. The document always keeps the original colors.
const rgb = value => {
  if (!value) return null
  if (/^#[\da-f]{3,8}$/i.test(value)) {
    let hex = value.slice(1)
    if (hex.length <= 4) hex = [...hex].map(c => c + c).join('')
    return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16))
  }
  const match = value.match(/^rgb\(([^)]+)\)$/i)
  return match ? match[1].split(',').slice(0, 3).map(c => Math.max(0, Math.min(255,
    parseFloat(c) * (c.includes('%') ? 2.55 : 1)))) : null
}
const luminance = rgb => rgb.map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
  .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0)
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05)
export function readableInk(color, background) {
  const source = rgb(color), paper = rgb(background)
  if (!source || !paper || contrast(source, paper) >= 4.5) return color
  const target = contrast([255, 255, 255], paper) > contrast([0, 0, 0], paper) ? 255 : 0
  for (let step = 1; step <= 20; step++) {
    const next = source.map(c => Math.round(c + (target - c) * step / 20))
    if (contrast(next, paper) >= 4.5) return `rgb(${next.join(',')})`
  }
  return target ? '#ffffff' : '#000000'
}
