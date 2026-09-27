export default function(ctx, sdk) {
  const preset = { id: 'theme-blue', name: '晴蓝主题', dark: false, colors: ['#eef3f9', '#ffffff', '#e9f0f8', '#2e4057', '#687e97', '#d3dfed', '#4876a6', '#dbe9f8'] }
  sdk.provide('theme', { id: preset.id, name: preset.name, dark: preset.dark })
  ctx.themeEngine.apply(ctx, preset)
}
