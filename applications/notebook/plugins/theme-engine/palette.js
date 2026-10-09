const legacyKeys = ['background', 'surface', 'panel', 'text', 'muted', 'border', 'accent', 'selected']
export const colorKeys = [...legacyKeys, 'onAccent', 'accentText']
const channels = color => {
  if (typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color)) throw Error(`主题颜色须为六位十六进制值：${color}`)
  return color.slice(1).match(/../g).map(value => parseInt(value, 16))
}
export function contrast(first, second) {
  const luminance = color => channels(color).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
  const a = luminance(first), b = luminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
const ink = background => contrast('#ffffff', background) >= contrast('#000000', background) ? '#ffffff' : '#000000'
function readableAccent(colors) {
  const backgrounds = [colors.surface, colors.panel, colors.selected], from = channels(colors.accent), to = channels(ink(colors.panel))
  for (let step = 0; step <= 100; step++) {
    const color = '#' + from.map((value, index) => Math.round(value + (to[index] - value) * step / 100).toString(16).padStart(2, '0')).join('')
    if (backgrounds.every(background => contrast(color, background) >= 4.5)) return color
  }
  throw Error('主题的 surface/panel/selected 明暗差异过大，无法自动推导强调文字色')
}
/** Older eight-color providers remain loadable; new providers use named colors. */
export function normalizeColors(input) {
  const legacy = Array.isArray(input)
  if (legacy && input.length !== 8) throw Error('旧版主题配色必须包含八个颜色')
  const colors = legacy ? Object.fromEntries(legacyKeys.map((key, index) => [key, input[index]])) : { ...input }
  for (const key of legacyKeys) { if (!colors[key]) throw Error(`主题缺少颜色：${key}`); channels(colors[key]) }
  if (!legacy && !colors.onAccent) throw Error('主题缺少颜色：onAccent')
  colors.onAccent ||= ink(colors.accent)
  colors.accentText ||= readableAccent(colors)
  colorKeys.forEach(key => channels(colors[key]))
  return Object.fromEntries(colorKeys.map(key => [key, colors[key]]))
}
export function paletteIssues(input) {
  const colors = normalizeColors(input), pairs = [
    ...['background', 'surface', 'panel', 'selected'].map(background => ['text', background]),
    ...['surface', 'panel'].map(background => ['muted', background]),
    ...['surface', 'panel', 'selected'].map(background => ['accentText', background]), ['onAccent', 'accent'],
  ]
  return pairs.flatMap(([foreground, background]) => {
    const ratio = contrast(colors[foreground], colors[background])
    return ratio < 4.5 ? [{ foreground, background, ratio: Number(ratio.toFixed(2)), minimum: 4.5 }] : []
  })
}
