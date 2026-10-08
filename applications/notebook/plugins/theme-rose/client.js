export default function(ctx, sdk) {
  const preset = { id: 'theme-rose', name: '紫藤主题', dark: false, colors: ['#f8f5fb', '#fefdff', '#efe7f8', '#332b3d', '#7e7289', '#ddd0ec', '#6d4bb0', '#ebe0f9'] }
  sdk.provide('theme', { id: preset.id, name: preset.name, dark: preset.dark })
  ctx.themeEngine.apply(ctx, preset)
}
