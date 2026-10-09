export default function(ctx, sdk) {
  const preset = { id: 'theme-graphite', name: '石墨主题', dark: true, colors: {
    background: '#1c1e20',
    surface: '#242629',
    panel: '#2b2e32',
    text: '#e7e9ea',
    muted: '#9ba1a5',
    border: '#3b3f44',
    accent: '#6fb3a3',
    selected: '#333a3a',
    onAccent: '#000000',
    accentText: '#6fb3a3'
  } }
  sdk.provide('theme', { id: preset.id, name: preset.name, dark: preset.dark })
  ctx.themeEngine.apply(ctx, preset)
}
