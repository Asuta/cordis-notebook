export default function(ctx, sdk) {
  const preset = { id: 'theme', name: '苔绿主题', dark: false, colors: {
    background: '#f6f5f0',
    surface: '#fffefa',
    panel: '#f0f2e9',
    text: '#30372f',
    muted: '#687161',
    border: '#dce2d1',
    accent: '#526c49',
    selected: '#e7efdf',
    onAccent: '#ffffff',
    accentText: '#526c49'
  } }
  sdk.provide('theme', { id: preset.id, name: preset.name, dark: preset.dark })
  ctx.themeEngine.apply(ctx, preset)
}
