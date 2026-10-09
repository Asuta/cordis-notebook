export default function(ctx, sdk) {
  const preset = { id: 'theme-cocoa', name: '可可主题', dark: true, colors: ['#211a16', '#2a221c', '#322821', '#f2e8dd', '#b5a493', '#453930', '#d0984f', '#3b2f26'] }
  sdk.provide('theme', { id: preset.id, name: preset.name, dark: preset.dark })
  ctx.themeEngine.apply(ctx, preset)
}
