import { normalizeColors } from './palette.js'
export function applyTheme(owner, { id, colors: input, dark = false }) {
  const colors = normalizeColors(input)
  const style = document.createElement('style')
  style.dataset.themeStyle = id
  const variables = Object.entries(colors).map(([key, value]) => `--theme-${key === 'background' ? 'bg' : key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())}:${value}`).join(';')
  style.textContent = `:root[data-theme="${id}"]{color-scheme:${dark ? 'dark' : 'light'};${variables}}`
  return owner.effect(() => {
    document.head.append(style); document.documentElement.dataset.theme = id
    document.documentElement.dataset.themeMode = dark ? 'dark' : 'light'
    return () => {
      style.remove()
      if (document.documentElement.dataset.theme === id) {
        delete document.documentElement.dataset.theme
        delete document.documentElement.dataset.themeMode
      }
    }
  })
}
