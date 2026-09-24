export default function(ctx, sdk) {
  const preset = { id: 'theme-night', name: '墨夜主题', dark: true, colors: ['#171e29', '#202a38', '#263145', '#e0e7f1', '#a0aec2', '#3a4960', '#547cab', '#344860'] }
  sdk.provide('theme', { id: preset.id, name: preset.name })
  ctx.themeEngine.apply(ctx, preset)
}
