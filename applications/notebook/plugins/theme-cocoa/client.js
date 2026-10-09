export default function(ctx, sdk) {
  const preset = { id: 'theme-cocoa', name: '可可主题', dark: true, colors: {
    background: '#211a16',
    surface: '#2a221c',
    panel: '#322821',
    text: '#f2e8dd',
    muted: '#b5a493',
    border: '#453930',
    accent: '#d0984f',
    selected: '#3b2f26',
    onAccent: '#000000',
    accentText: '#d0984f'
  } }
  sdk.provide('theme', { id: preset.id, name: preset.name, dark: preset.dark })
  ctx.themeEngine.apply(ctx, preset)
}
