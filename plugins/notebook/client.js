import { createNotebook } from './model.js'

export default async function (ctx, sdk) {
  let tabId = sessionStorage.getItem('cordis-tab-id')
  if (!tabId) { tabId = crypto.randomUUID(); sessionStorage.setItem('cordis-tab-id', tabId) }
  const service = await createNotebook(ctx, sdk, { storage: localStorage, draftKey: 'cordis-notebook-draft-v2-' + tabId, autosaveMs: sdk.config.autosaveMs })
  const selectionKey = 'cordis-selected-note'
  const selected = sessionStorage.getItem(selectionKey)
  if (!service.dirty && service.notes.some(note => note.id === selected)) await service.choose(selected)
  service.observe(ctx, () => { if (service.selected) sessionStorage.setItem(selectionKey, service.selected) })
  const status = sdk.el('button', { class: 'save-status' }); sdk.mount('status', status)
  service.observe(ctx, () => { status.textContent = service.status })
  sdk.listen(status, 'click', () => service.flush().catch(error => sdk.toast(error.message)))
  sdk.listen(window, 'beforeunload', event => { if (service.dirty) { event.preventDefault(); event.returnValue = '' } })
  sdk.listen(document, 'keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 's') { event.preventDefault(); service.flush().catch(error => sdk.toast(error.message)) } })
}
