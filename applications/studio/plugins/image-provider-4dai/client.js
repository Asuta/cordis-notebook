export default function (ctx, sdk) {
  const s = ctx.canvasSession, view = ctx.canvasUI, { el, button, refresh } = view
  const api = (path, body) => sdk.request('/api/studio/four-dai' + path, body === undefined ? 'GET' : 'POST', body)
  const settings = el('dialog', { class: 'studio-dialog', 'aria-label': '4dai GPT Image 设置' })
  const baseUrl = el('input', { 'aria-label': '4dai 接口地址', placeholder: 'https://api.4dai.cc' })
  const model = el('select', { 'aria-label': 'GPT Image 模型' })
  const key = el('input', { type: 'password', autocomplete: 'new-password', 'aria-label': '4dai API Key', placeholder: '留空保留已配置 Key' })
  const state = el('p')
  function fillModels(selected) {
    const provider = (s.state.providers || []).find(item => item.id === 'four-dai')
    const choices = provider?.models || [
      { id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst' },
      { id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare' },
    ]
    model.replaceChildren(...choices.map(item => el('option', { value: item.id }, item.label)))
    model.value = selected || provider?.model || choices[0]?.id || ''
  }
  settings.append(el('h2', {}, '4dai · GPT Image'), state, el('label', {}, '接口地址'), baseUrl, el('label', {}, '模型'), model, el('label', {}, 'API Key'), key,
    el('small', {}, '支持文生图和参考图编辑。Key 仅存储在本机服务端；留空保存会保留当前 Key。'),
    button('保存 4dai 设置', async () => { await api('/config', { baseUrl: baseUrl.value, model: model.value, apiKey: key.value }); key.value = ''; settings.close(); await refresh(); view.render() }, 'studio-primary'),
    button('取消', () => { key.value = ''; settings.close() }))
  settings.addEventListener('close', () => { key.value = '' })
  const entry = button('⚙ 4dai', () => {
    const provider = (s.state.providers || []).find(item => item.id === 'four-dai')
    baseUrl.value = provider?.baseUrl || 'https://api.4dai.cc'; key.value = ''
    fillModels(provider?.model)
    state.textContent = provider?.hasKey ? '已配置 Key · 留空保存会继续使用当前 Key' : '尚未配置 API Key'
    settings.showModal()
  }, 'studio-settings')
  view.side.append(entry); view.root.append(settings)
  ctx.effect(() => () => { entry.remove(); settings.remove() })
}
