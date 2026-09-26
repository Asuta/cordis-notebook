import { createNotebook } from './model.js'

export default async function (ctx, sdk) {
  const local = sdk.storage?.local || localStorage, session = sdk.storage?.session || sessionStorage
  if (sdk.application?.legacyBrowserStorage && sdk.storage) {
    try {
      if (!session.getItem('legacy-imported')) {
        const legacyTabId = sessionStorage.getItem('cordis-tab-id')
        // Import only when this tab first adopts scoped storage. Other old tabs may still be editing.
        if (legacyTabId && !session.getItem('cordis-tab-id')) {
          const draftKey = 'cordis-notebook-draft-v2-' + legacyTabId, marker = 'legacy-draft-imported:' + legacyTabId
          if (!local.getItem(marker)) {
            const draft = localStorage.getItem(draftKey)
            // Replace an eager copy left by the old global migration, including one already saved/deleted.
            if (draft !== null) local.setItem(draftKey, draft)
            else local.removeItem(draftKey)
            local.setItem(marker, '1')
          }
        }
        for (const key of ['cordis-tab-id', 'cordis-selected-note']) {
          const value = sessionStorage.getItem(key)
          if (value !== null && session.getItem(key) === null) session.setItem(key, value)
        }
        session.setItem('legacy-imported', '1')
      }
    } catch (error) { sdk.toast('旧草稿读取失败：' + error.message) }
  }
  let tabId = session.getItem('cordis-tab-id')
  if (!tabId) { tabId = crypto.randomUUID(); session.setItem('cordis-tab-id', tabId) }
  const service = await createNotebook(ctx, sdk, { storage: local, draftKey: 'cordis-notebook-draft-v2-' + tabId, autosaveMs: sdk.config.autosaveMs })
  ctx.on('plugins/remote-stop', () => {
    if (service.dirty) sdk.toast('其他页面已停用插件，未保存草稿保留在此浏览器。')
  })
  const selectionKey = 'cordis-selected-note'
  const selected = session.getItem(selectionKey)
  if (!service.dirty && service.notes.some(note => note.id === selected)) await service.choose(selected)
  service.observe(ctx, () => { if (service.selected) session.setItem(selectionKey, service.selected) })
  const status = sdk.el('button', { class: 'save-status' }); sdk.mount('status', status)
  service.observe(ctx, () => { status.textContent = service.status; status.dataset.error = String(service.status.includes('失败')); status.title = '点击立即保存或重试' })
  sdk.listen(status, 'click', () => service.flush().catch(error => sdk.toast(error.message)))
  sdk.listen(window, 'beforeunload', event => { if (service.dirty) { event.preventDefault(); event.returnValue = '' } })
  sdk.listen(document, 'keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 's') { event.preventDefault(); service.flush().catch(error => sdk.toast(error.message)) } })
}
