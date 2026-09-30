export default function(ctx, sdk) {
  const preset = { id: 'theme-rose', name: '绯樱主题', dark: false, colors: ['#faf4f5', '#fffdfd', '#f6e8ec', '#3a2b30', '#8a737a', '#ecd7dd', '#b04a68', '#f7dde5'] }
  sdk.provide('theme', { id: preset.id, name: preset.name, dark: preset.dark })
  ctx.themeEngine.apply(ctx, preset)
}
