export function pageAppearance(color = '#ffffff', dark = false) {
  const rgb = /^#[a-f\d]{6}$/i.test(color) ? [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)) : [255, 255, 255]
  // Dark paper keeps a hint of a custom paper color without writing it back.
  const display = dark ? rgb.map(c => Math.round(24 + c * .035)) : rgb
  const background = '#' + display.map(c => c.toString(16).padStart(2, '0')).join('')
  const luminance = display.map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
    .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0)
  return { background, foreground: luminance > .179 ? '#252525' : '#eeeeee' }
}
