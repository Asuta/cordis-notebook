export default function (ctx, sdk) {
  const s = ctx.canvasSession, view = ctx.canvasUI, { el, button, refresh } = view
  const settings = el('dialog', { class: 'studio-dialog', 'aria-label': '速登 GPT Image 设置' })
  const baseUrl = el('input', { 'aria-label': '速登接口地址', placeholder: 'https://sudeng.cc' })
  const model = el('select', { 'aria-label': '速登默认模型' })
  const key = el('input', { type: 'password', autocomplete: 'new-password', 'aria-label': '速登 API Key', placeholder: '留空保留已配置 Key' })
  const state = el('p')
  settings.append(el('h2', {}, '速登 · GPT Image'), state, el('label', {}, '接口地址'), baseUrl, el('label', {}, '默认模型'), model, el('label', {}, 'API Key'), key,
    el('small', {}, '生成卡片可独立选择模型。Key 仅存储在本机服务端；留空保存会保留当前 Key。参考图编辑实测曾遇到连接中断，请勿在结果不明时重复提交。'),
    button('保存速登设置', async () => { await sdk.request('/api/studio/sudeng/config', 'POST', { baseUrl: baseUrl.value, model: model.value, apiKey: key.value }); key.value = ''; settings.close(); await refresh(); view.render() }, 'studio-primary'),
    button('取消', () => { key.value = ''; settings.close() }))
  settings.addEventListener('close', () => { key.value = '' })
  const entry = button('⚙ 速登', () => {
    const provider = (s.state.providers || []).find(item => item.id === 'sudeng')
    baseUrl.value = provider?.baseUrl || 'https://sudeng.cc'; key.value = ''
    const choices = provider?.models || [
      { id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare' },
      { id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst' },
    ]
    model.replaceChildren(...choices.map(item => el('option', { value: item.id }, item.label)))
    model.value = provider?.model || choices[0]?.id || ''
    state.textContent = provider?.hasKey ? '已配置 Key · 留空保存会继续使用当前 Key' : '尚未配置 API Key'
    settings.showModal()
  }, 'studio-settings')
  view.side.append(entry); view.root.append(settings)
  ctx.effect(() => () => { entry.remove(); settings.remove() })
}
