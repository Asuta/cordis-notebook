export function applyTheme(owner, { id, colors, dark = false }) {
  const style = document.createElement('style')
  style.dataset.themeStyle = id
  const [background, surface, panel, text, muted, border, accent, selected] = colors
  style.textContent = `:root[data-theme="${id}"]{color-scheme:${dark ? 'dark' : 'light'};--theme-bg:${background};--theme-surface:${surface};--theme-panel:${panel};--theme-text:${text};--theme-muted:${muted};--theme-border:${border};--theme-accent:${accent};--theme-selected:${selected}}`
  return owner.effect(() => {
    document.head.append(style); document.documentElement.dataset.theme = id
    return () => { style.remove(); if (document.documentElement.dataset.theme === id) delete document.documentElement.dataset.theme }
  })
}
