export default function (ctx, sdk) {
  const s = ctx.canvasSession, view = ctx.canvasUI
  const { el, button, safe, field, flush, edit, board, api, refresh } = view
  s.actions.register(ctx, { id: 'generate', label: '生成图片', schema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] },
    async run({ nodeId, revision }) {
      if (revision !== undefined && revision !== s.board().revision) throw Error('画布已变化，请重新读取')
      const job = await api('/generate', { boardId: s.boardId, nodeId, revision: revision ?? s.board().revision, requestId: crypto.randomUUID() })
      await refresh(); return job
    },
  })
  view.menu(ctx, { id: 'generator', label: '✦ 生成卡片', order: 30, className: 'studio-primary', run: () => view.add('generator') })
  const createFirst = button('创建第一张生成卡片', () => view.add('generator'), 'studio-primary')
  view.empty.insertBefore(createFirst, view.empty.querySelector('small'))
  ctx.effect(() => () => createFirst.remove())
  view.register(ctx, { id: 'generator', label: '生成卡片', icon: '✦', input: true, height: 400,
    actions: [{ label: '编辑提示词', run: node => view.cards.querySelector(`[data-node="${node.id}"] textarea`)?.focus() }],
    render(node, card) {
      const providers = s.state.providers || [], provider = node.provider ? providers.find(p => p.id === node.provider) : providers[0]
      if (providers.length > 1 || node.provider) {
        const selector = el('select', { 'aria-label': '图片服务' })
        selector.append(el('option', { value: '' }, '默认图片服务'))
        for (const item of providers) selector.append(el('option', { value: item.id }, item.label))
        if (node.provider && !provider) selector.append(el('option', { value: node.provider }, node.provider + '（不可用）'))
        selector.value = node.provider || ''
        selector.onchange = safe(async () => { await flush(); await edit([{ type: 'update', id: node.id, patch: { provider: selector.value } }]) })
        card.append(selector)
      }
      card.append(field(node, 'prompt', true))
      const options = el('div', { class: 'studio-generation-options' })
      for (const [prop, values] of [['ratio', provider?.ratios || [node.ratio]], ['resolution', provider?.resolutions || [node.resolution]]]) {
        const select = el('select', { 'aria-label': node.title + (prop === 'ratio' ? ' 比例' : ' 分辨率') })
        for (const value of values) select.append(el('option', { value }, value))
        select.value = node[prop]; select.onchange = safe(async () => { await flush(); await edit([{ type: 'update', id: node.id, patch: { [prop]: select.value } }]) }); options.append(select)
      }
      const inputs = el('div', { class: 'studio-inputs' }), incoming = board().edges.filter(e => e.to === node.id)
      inputs.append(el('small', {}, incoming.length ? '输入顺序' : '拖入连线，或直接填写提示词'))
      incoming.forEach((edge, index) => {
        const from = board().nodes.find(n => n.id === edge.from), row = el('div')
        row.append(el('span', {}, `${index + 1}. ${from.title}`), button('↑', async () => { if (!index) return; const ids = incoming.map(e => e.id); [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]; await edit([{ type: 'reorder', id: node.id, edges: ids }]) }), button('×', () => edit([{ type: 'disconnect', id: edge.id }])))
        inputs.append(row)
      })
      const jobs = (s.state.jobs || []).filter(j => j.boardId === s.boardId && j.nodeId === node.id), job = jobs.at(-1), busy = ['queued', 'running'].includes(job?.status)
      const run = button(busy ? '■ 停止生成' : '✦ 生成图片', () => busy ? api('/cancel', { id: job.id }).then(refresh) : s.execute('generate', { nodeId: node.id }), busy ? '' : 'studio-primary')
      const status = el('div', { class: 'studio-job-status' }, job ? ({ queued: '排队中', running: '正在生成…', succeeded: '已生成 · 结果保留在右侧', failed: '生成失败', interrupted: '生成已中断' }[job.status] + (job.error ? ' · ' + job.error : '')) : provider ? (provider.hasKey === false ? '请先配置图片服务' : provider.model) : '图片服务不可用，请启用对应插件')
      if (!provider && job) status.textContent += ' · 图片服务已停用'
      run.disabled = !busy && !provider
      card.append(options, inputs, status, run)
    },
  })
}
