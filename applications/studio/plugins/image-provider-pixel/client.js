export default function (ctx, sdk) {
  const s = ctx.canvasSession, view = ctx.canvasUI, { el, button, refresh } = view
  const api = (path, body) => sdk.request('/api/studio' + path, body === undefined ? 'GET' : 'POST', body)
  const settings = el('dialog', { class: 'studio-dialog' })
  const serviceUrl = el('input', { 'aria-label': '图片接口地址' }), model = el('input', { 'aria-label': '图片模型' }), key = el('input', { type: 'password', autocomplete: 'new-password', 'aria-label': '图片 API Key', placeholder: '留空保留已配置 Key' })
  settings.append(el('h2', {}, '图片服务'), el('p', {}, 'AI Pixel · Key 仅存储在本机服务端'), el('label', {}, '接口地址'), serviceUrl, el('label', {}, '模型'), model, el('label', {}, 'API Key'), key,
    button('保存设置', async () => { await api('/config', { baseUrl: serviceUrl.value, model: model.value, apiKey: key.value }); key.value = ''; settings.close(); await refresh(); view.render() }, 'studio-primary'), button('取消', () => { key.value = ''; settings.close() }))
  function showSettings() { serviceUrl.value = (s.state.providers || []).find(p => p.id === 'pixel')?.baseUrl || ''; model.value = (s.state.providers || []).find(p => p.id === 'pixel')?.model || ''; key.value = ''; settings.showModal() }
  const entry = button('⚙ 图片服务', showSettings, 'studio-settings')
  view.side.append(entry); view.root.append(settings)
  ctx.effect(() => () => { entry.remove(); settings.remove() })
}
