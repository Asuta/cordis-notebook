export default function (ctx, sdk) {
  const s = ctx.canvasSession, view = ctx.canvasUI, { el, button, api, refresh } = view
  const settings = el('dialog', { class: 'studio-dialog', 'aria-label': 'WaveSpeed 设置' })
  const url = el('input', { 'aria-label': 'WaveSpeed 接口地址', placeholder: 'https://api.wavespeed.ai' })
  const key = el('input', { type: 'password', autocomplete: 'new-password', 'aria-label': 'WaveSpeed API Key', placeholder: '留空保留已配置 Key' })
  const state = el('p')
  settings.append(el('h2', {}, 'WaveSpeed 图片与视频'), state, el('label', {}, '接口地址'), url, el('label', {}, 'API Key'), key, el('small', {}, 'Key 仅存储在本机服务端。配置后可在生成卡片中搜索整个图片、视频目录。'),
    button('保存 WaveSpeed 设置', async () => { await api('/wavespeed/config', { baseUrl: url.value, apiKey: key.value }); key.value = ''; settings.close(); await refresh(); view.render() }, 'studio-primary'),
    button('取消', () => { key.value = ''; settings.close() }))
  settings.addEventListener('close', () => { key.value = '' })
  const entry = button('⚙ WaveSpeed', () => { const provider = (s.state.providers || []).find(p => p.id === 'wavespeed'); url.value = provider?.baseUrl || 'https://api.wavespeed.ai'; key.value = ''; state.textContent = provider?.hasKey ? '已配置 Key · 留空保存会继续使用当前 Key' : '尚未配置 API Key'; settings.showModal() }, 'studio-settings')
  view.side.append(entry); view.root.append(settings)
  ctx.effect(() => () => { entry.remove(); settings.remove() })
}
