export default function(ctx, sdk) {
  const preset = { id: 'theme-blue', name: '晴蓝主题', dark: false, colors: {
    background: '#eef3f9',
    surface: '#ffffff',
    panel: '#e9f0f8',
    text: '#2e4057',
    muted: '#5a6f87',
    border: '#d3dfed',
    accent: '#4876a6',
    selected: '#dbe9f8',
    onAccent: '#ffffff',
    accentText: '#426b97'
  } }
  sdk.provide('theme', { id: preset.id, name: preset.name, dark: preset.dark })
  ctx.themeEngine.apply(ctx, preset)
}
