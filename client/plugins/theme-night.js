import { applyTheme } from './theme-support.js'
export default function(ctx, sdk) {
  applyTheme(ctx, sdk, { id: 'theme-night', name: '墨夜主题', dark: true, colors: ['#171e29', '#202a38', '#263145', '#e0e7f1', '#a0aec2', '#3a4960', '#547cab', '#344860'] })
}
