export default function(ctx, sdk) {
  const preset = { id: 'theme-night', name: '墨夜主题', dark: true, colors: {
    background: '#171e29',
    surface: '#202a38',
    panel: '#263145',
    text: '#e0e7f1',
    muted: '#a0aec2',
    border: '#3a4960',
    accent: '#547cab',
    selected: '#344860',
    onAccent: '#000000',
    accentText: '#a1b7d1'
  } }
  sdk.provide('theme', { id: preset.id, name: preset.name, dark: preset.dark })
  ctx.themeEngine.apply(ctx, preset)
}
