export function applicationView({ el, change }) {
  const dialog = document.querySelector('#application-picker'), list = document.querySelector('#application-list')
  const button = document.querySelector('#manage-applications'), close = document.querySelector('#close-applications')
  button.onclick = () => dialog.showModal()
  close.onclick = () => dialog.close()
  let busy = false
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault() })
  return {
    render(state, working) {
      busy = working || state.phase !== 'idle'
      button.disabled = close.disabled = busy
      document.querySelector('#current-application').textContent = state.current?.name || '选择应用'
      document.title = state.current?.name || '插件应用'
      document.querySelector('#application-error').textContent = state.error || ''
      list.replaceChildren()
      for (const app of state.applications) {
        const card = el('article', { class: 'application-card' }), title = el('div', { class: 'application-title' })
        if (app.icon) title.append(el('img', { src: app.icon, alt: '', width: 36, height: 36 }))
        title.append(el('h3', {}, app.name)); card.append(title, el('p', {}, app.description))
        if (app.error) card.append(el('p', { class: 'plugin-error' }, app.error))
        const active = state.current?.id === app.id
        const open = el('button', { disabled: busy || active || !!app.error, 'aria-label': `打开${app.name}应用` }, active ? '正在使用' : '打开应用')
        open.onclick = () => change(app.id); card.append(open); list.append(card)
      }
      if (!state.applications.length) list.append(el('p', {}, '尚未发现应用，请在 applications 目录添加应用。'))
      document.querySelector('#stop-application').hidden = !state.current
      document.querySelector('#stop-application').disabled = busy
      document.querySelector('#stop-application').onclick = () => change(null)
      document.querySelector('#app').inert = state.phase !== 'idle'
    },
    open() { if (!dialog.open) dialog.showModal() },
  }
}
