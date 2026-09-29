export default function(ctx, sdk) {
  const preset = { id: 'theme-amber', name: '琥珀主题', dark: false, colors: ['#faf3e8', '#fffdf9', '#f4ead9', '#3d3227', '#87765f', '#e4d5bd', '#b3701f', '#f6e2c4'] }
  sdk.provide('theme', { id: preset.id, name: preset.name, dark: preset.dark })
  ctx.themeEngine.apply(ctx, preset)
}
