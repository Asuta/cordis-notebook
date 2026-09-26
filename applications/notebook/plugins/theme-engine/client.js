import { applyTheme } from './styles.js'
export default function(ctx, sdk) {
  sdk.provide('themeEngine', { apply(owner, preset) { return applyTheme(owner, preset) } })
}
