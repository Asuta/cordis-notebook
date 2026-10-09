export default function(ctx, sdk) {
  const preset = { id: 'theme-graphite', name: '石墨主题', dark: true, colors: ['#1c1e20', '#242629', '#2b2e32', '#e7e9ea', '#9ba1a5', '#3b3f44', '#6fb3a3', '#333a3a'] }
  sdk.provide('theme', { id: preset.id, name: preset.name, dark: preset.dark })
  ctx.themeEngine.apply(ctx, preset)
}
