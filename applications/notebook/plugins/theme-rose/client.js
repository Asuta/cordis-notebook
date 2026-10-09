export default function(ctx, sdk) {
  const preset = { id: 'theme-rose', name: '紫藤主题', dark: false, colors: {
    background: '#f8f5fb',
    surface: '#fefdff',
    panel: '#efe7f8',
    text: '#332b3d',
    muted: '#71657b',
    border: '#ddd0ec',
    accent: '#6d4bb0',
    selected: '#ebe0f9',
    onAccent: '#ffffff',
    accentText: '#6d4bb0'
  } }
  sdk.provide('theme', { id: preset.id, name: preset.name, dark: preset.dark })
  ctx.themeEngine.apply(ctx, preset)
}
