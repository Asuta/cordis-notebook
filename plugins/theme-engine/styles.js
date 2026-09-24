export function applyTheme(owner, { id, colors, dark = false }) {
  const style = document.createElement('style')
  style.dataset.themeStyle = id
  const [background, surface, panel, text, muted, border, accent, selected] = colors
  const scope = `:root[data-theme="${id}"]`
  style.textContent = `
    ${scope}{color-scheme:${dark ? 'dark' : 'light'};--theme-bg:${background};--theme-surface:${surface};--theme-panel:${panel};--theme-text:${text};--theme-muted:${muted};--theme-border:${border};--theme-accent:${accent};--theme-selected:${selected};background:var(--theme-bg);color:var(--theme-text)}
    ${scope} body{background:var(--theme-bg);color:var(--theme-text)}
    ${scope} :is(.host-bar,.workspace,.note-card.selected,dialog,.plugin-card,.extension-panel){background:var(--theme-surface);color:var(--theme-text);border-color:var(--theme-border)}
    ${scope} :is(.sidebar,.search,.dependency-tree,.manager-view-switch,#install-preview){background:var(--theme-panel);border-color:var(--theme-border)}
    ${scope} :is(button,input,textarea,#title,#content){color:var(--theme-text)}
    ${scope} :is(.card-preview,.card-date,.note-date,.editor-footer,.page-footer,.eyebrow,.sidebar-footer,.save-status,.no-results,.empty p,.extension-panel p,.host-brand span,#connection,#plugin-summary,.manager-footer,.plugin-card p,.plugin-card small,.dependency-legend,.dependency-tree-heading span,.dependency-count,.dependency-chips span){color:var(--theme-muted)}
    ${scope} :is(.workspace,.sidebar,.editor-toolbar,.editor-footer,.filters,.host-bar,.install-box,.dependency-tree-heading){border-color:var(--theme-border)}
    ${scope} :is(.new,.primary,.install-label,#install-plugin){background:var(--theme-accent);color:white}
    ${scope} :is(.filters button.active,.leaf,.paper-icon,.dependency-tree-heading strong){color:var(--theme-accent);border-color:var(--theme-accent)}
    ${scope} :is(.note-card:hover,.note-card.selected){background:var(--theme-selected)}
    ${scope} :is(#manage-plugins,.plugin-actions button,.extension-panel button){background:var(--theme-panel);border-color:var(--theme-border);color:var(--theme-text)}
    ${scope} #plugin-manager :is(.manager-viewbar,.dependency-controls p,.dependency-relations h3){color:var(--theme-muted)}
    ${scope} #plugin-manager :is(.manager-view-switch button,.dependency-node){color:var(--theme-text)}
    ${scope} #plugin-manager :is(.manager-view-switch button[aria-pressed=true],.dependency-node[aria-pressed=true],.dependency-node:hover){background:var(--theme-selected);border-color:var(--theme-border);color:var(--theme-text)}
    ${scope} #plugin-manager :is(.dependency-controls button,.dependency-chips button){background:var(--theme-panel);border-color:var(--theme-border);color:var(--theme-text)}
    ${scope} :is(.trust-notice,.dependency-impact){background:var(--theme-panel);color:var(--theme-muted)}
    ${scope} .plugin-status{background:var(--theme-panel);color:var(--theme-muted)}
    ${scope} .plugin-status.enabled{background:var(--theme-selected);color:var(--theme-text)}
    ${scope} :is(input,textarea)::placeholder{color:var(--theme-muted)}
    ${scope} .theme-group{color:var(--theme-muted)}
  `
  return owner.effect(() => {
    document.head.append(style); document.documentElement.dataset.theme = id
    return () => { style.remove(); if (document.documentElement.dataset.theme === id) delete document.documentElement.dataset.theme }
  })
}
