export default function(ctx, sdk) {
  const preset = { id: 'theme', name: '苔绿主题', colors: ['#f6f5f0', '#fffefa', '#f0f2e9', '#30372f', '#77816e', '#dce2d1', '#526c49', '#e7efdf'] }
  sdk.provide('theme', { id: preset.id, name: preset.name })
  ctx.themeEngine.apply(ctx, preset)
}
