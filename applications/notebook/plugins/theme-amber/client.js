export default function(ctx, sdk) {
  const preset = { id: 'theme-amber', name: '琥珀主题', dark: false, colors: {
    background: '#faf3e8',
    surface: '#fffdf9',
    panel: '#f4ead9',
    text: '#3d3227',
    muted: '#786854',
    border: '#e4d5bd',
    accent: '#b3701f',
    selected: '#f6e2c4',
    onAccent: '#000000',
    accentText: '#8f5a19'
  } }
  sdk.provide('theme', { id: preset.id, name: preset.name, dark: preset.dark })
  ctx.themeEngine.apply(ctx, preset)
}
