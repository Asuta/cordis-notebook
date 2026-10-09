export default function(ctx, sdk) {
  const preset = { id: 'theme-teal', name: '海盐主题', dark: false, colors: ['#eef5f4', '#ffffff', '#e2efee', '#22393b', '#5f7d7f', '#c6dedd', '#2f8f8a', '#d3eae7'] }
  sdk.provide('theme', { id: preset.id, name: preset.name, dark: preset.dark })
  ctx.themeEngine.apply(ctx, preset)
}
