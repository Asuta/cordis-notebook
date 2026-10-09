export default function(ctx, sdk) {
  const preset = { id: 'theme-teal', name: '海盐主题', dark: false, colors: {
    background: '#eef5f4',
    surface: '#ffffff',
    panel: '#e2efee',
    text: '#22393b',
    muted: '#537072',
    border: '#c6dedd',
    accent: '#2f8f8a',
    selected: '#d3eae7',
    onAccent: '#000000',
    accentText: '#25716d'
  } }
  sdk.provide('theme', { id: preset.id, name: preset.name, dark: preset.dark })
  ctx.themeEngine.apply(ctx, preset)
}
