import { createModelCatalog } from './model-catalog-ui.js'
import { createModelForm } from './model-form.js'
import { createReferenceUI } from './references-ui.js'
import { createLibraryUI } from './library-ui.js'
import { createCardLayout } from './card-layout.js'

export default function (ctx, sdk) {
  const s = ctx.canvasSession, view = ctx.canvasUI
  const { el, button, safe, field, flush, edit, board, api, refresh } = view
  const details = new Map(), form = createModelForm(view, s), references = createReferenceUI(ctx, view, s, sdk)
  const library = createLibraryUI(ctx, view, s, sdk), layout = createCardLayout(ctx, view, s, sdk)
  let stopped = false, submissions = Promise.resolve()
  ctx.effect(() => () => { stopped = true; details.clear() })
  function getModel(provider, id, retry = false) {
    const key = provider.id + ':' + (provider.catalogVersion || '') + ':' + id
    if (retry) details.delete(key)
    if (!details.has(key)) {
      const entry = {}; details.set(key, entry)
      entry.task = api('/providers/' + provider.id + '/model?id=' + encodeURIComponent(id)).then(model => { entry.model = model; return model }, error => { entry.error = error.message; throw error })
      void entry.task.then(() => { if (!stopped) view.render() }, () => { if (!stopped) view.render() })
      if (details.size > 100) details.delete(details.keys().next().value)
    }
    return details.get(key)
  }
  const catalog = createModelCatalog(ctx, view, s, sdk, async (target, provider, id) => {
    const model = await getModel(provider, id, true).task
    if (!model.supported) throw Error(model.unsupportedReason)
    await flush(); await edit([{ type: 'update', id: target.nodeId, patch: { provider: provider.id, model: id } }], { targetBoard: target.boardId })
  }, library)
  const providersNow = () => s.state.providers || []
  const selectedProvider = node => node?.provider ? providersNow().find(item => item.id === node.provider) : providersNow().find(item => item.id === 'pixel') || providersNow()[0]
  s.actions.register(ctx, { id: 'generate', label: '生成图片或视频', schema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] },
    async run({ nodeId, revision }) {
      const boardId = s.boardId
      const task = submissions.then(async () => {
        if (stopped || s.boardId !== boardId) throw Error('画板已切换，请重新生成')
        await flush(); await refresh({ fresh: true })
        if (revision !== undefined && revision !== s.board().revision) throw Error('画布已变化，请重新读取')
        const node = board().nodes.find(item => item.id === nodeId), provider = selectedProvider(node)
        if (node && provider?.modelCatalog && form.hasErrors(node, provider)) throw Error('请先修正模型参数中的错误')
        const job = await api('/generate', { boardId, nodeId, revision: revision ?? s.board().revision, requestId: crypto.randomUUID() })
        await refresh({ fresh: true }); return job
      })
      submissions = task.catch(() => {}); return task
    },
  })
  for (const [id, label] of [['models', '搜索图片、视频模型目录'], ['model', '读取模型参数定义']]) s.actions.register(ctx, {
    id, label, mutates: false, schema: { type: 'object', properties: { provider: { type: 'string' }, model: { type: 'string' }, query: { type: 'string' }, kind: { enum: ['image', 'video', ''] }, type: { type: 'string' }, offset: { type: 'integer' } } },
    run(args) { const query = new URLSearchParams(id === 'model' ? { id: args.model || '' } : { q: args.query || '', kind: args.kind || '', type: args.type || '', offset: String(args.offset || 0) }); return api('/providers/' + encodeURIComponent(args.provider || 'wavespeed') + '/' + id + '?' + query) },
  })
  for (const id of ['resume', 'detach']) s.actions.register(ctx, { id, label: id === 'resume' ? '恢复远端任务查询' : '结束本地任务跟踪', schema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] }, async run({ jobId }) { const result = await api('/' + id, { id: jobId }); await refresh(); return result } })
  const addGenerator = () => view.add('generator', { provider: 'wavespeed' })
  view.menu(ctx, { id: 'generator', label: '✦ 生成卡片', order: 30, className: 'studio-primary', run: addGenerator })
  const createFirst = button('创建第一张生成卡片', addGenerator, 'studio-primary')
  view.empty.insertBefore(createFirst, view.empty.querySelector('small'))
  ctx.effect(() => () => createFirst.remove())
  view.register(ctx, { id: 'generator', label: '生成卡片', icon: '✦', input: true, height: 720,
    actions: [{ label: '编辑提示词', run: node => view.cards.querySelector('[data-node="' + node.id + '"] textarea')?.focus() }, { label: '收藏卡片', run: node => library.favoriteCard(node) }],
    render(node, card) {
      const providers = providersNow(), provider = selectedProvider(node)
      let updateRun = () => {}
      const body = el('div', { class: 'studio-generator-body studio-scroll' })
      const folded = el('section', { class: 'studio-collapsed-parameters', hidden: true }); folded.append(el('strong', {}, '已收起参数'))
      card.classList.add('studio-catalog-generator')
      const favorite = button('☆', () => library.favoriteCard(node), 'studio-favorite-card'); favorite.setAttribute('aria-label', '收藏生成卡片'); card.querySelector('.studio-card-head').append(favorite)
      if (body !== card) {
        body.dataset.scrollKey = (provider?.id || '') + ':' + (node.model || '')
        const previous = view.cards.querySelector('[data-node="' + node.id + '"] .studio-generator-body')
        const top = previous?.dataset.scrollKey === body.dataset.scrollKey ? previous.scrollTop : 0
        card.append(body)
        queueMicrotask(() => { if (body.isConnected) body.scrollTop = top })
      }
      if (providers.length > 1 || node.provider) {
        const selector = el('select', { 'aria-label': '图片服务', class: 'studio-provider-select' })
        selector.append(el('option', { value: '' }, '默认生成服务'))
        for (const item of providers) selector.append(el('option', { value: item.id }, item.label))
        if (node.provider && !provider) selector.append(el('option', { value: node.provider }, node.provider + '（不可用）'))
        selector.value = node.provider || ''
        selector.onchange = safe(async () => { await flush(); await edit([{ type: 'update', id: node.id, patch: { provider: selector.value } }]) })
        body.append(selector)
      }
      let model
      if (provider?.modelCatalog) {
        const area = el('div', { class: 'studio-selected-model' })
        area.append(el('small', {}, '模型选择器'), button(node.model || '搜索并选择图片、视频模型', () => catalog(node, provider)))
        if (node.model) {
          const entry = getModel(provider, node.model); model = entry.model
          if (model) { area.append(el('small', {}, (model.outputKind === 'video' ? '视频' : '图片') + ' · ' + model.label)); if (!model.supported) area.append(el('small', { class: 'studio-field-error' }, model.unsupportedReason)) }
          else if (entry.error) area.append(el('small', { class: 'studio-field-error' }, entry.error), button('重新加载模型', () => { getModel(provider, node.model, true); view.render() }))
          else area.append(el('small', {}, '正在读取模型参数…'))
        }
        body.append(area)
      }
      const promptLabel = el('div', { class: 'studio-prompt-label' }, '提示词' + (model?.fields.find(item => item.path === '/prompt')?.required ? ' *' : ''))
      const promptHistory = button('历史 / 收藏', () => library.prompts(node)); promptHistory.setAttribute('aria-label', '提示词历史与收藏'); promptLabel.append(promptHistory)
      const promptInput = field(node, 'prompt', true), activeSuffixes = (node.promptSuffixes || []).filter(item => item.enabled)
      let promptArea = promptInput
      if (activeSuffixes.length) {
        const preview = el('div', { class: 'studio-prompt-suffix-preview', role: 'note', 'aria-label': '固定尾缀，只读内容' })
        preview.append(el('small', { class: 'studio-prompt-suffix-label' }, '尾缀 · 只读'))
        for (const suffix of activeSuffixes) {
          const line = el('p', {}, suffix.text)
          preview.append(line)
        }
        promptArea = el('div', { class: 'studio-prompt-area' })
        promptArea.append(promptInput, preview)
      }
      body.append(promptLabel, promptArea, library.suffixBar(node))
      if (model && !model.fields.some(item => item.path === '/prompt')) body.append(el('small', { class: 'studio-no-prompt' }, '此模型不接受提示词，请清空文字并断开文字输入。'))
      if (provider?.modelCatalog) { if (model) body.append(form.render(node, provider, model, () => updateRun(), layout, folded)) }
      else {
        const options = el('div', { class: 'studio-generation-options' })
        for (const [prop, values] of [['ratio', provider?.ratios || [node.ratio]], ['resolution', provider?.resolutions || [node.resolution]]]) {
          const select = el('select', { 'aria-label': node.title + (prop === 'ratio' ? ' 比例' : ' 分辨率') })
          for (const value of values) select.append(el('option', { value }, prop === 'ratio' && value === 'auto' ? '自动' : value))
          select.value = node[prop]; select.onchange = safe(async () => { await flush(); await edit([{ type: 'update', id: node.id, patch: { [prop]: select.value } }]) })
          const row = el('div', { class: 'studio-model-field' }); row.append(select)
          const visible = layout.parameter(node, (provider?.id || '') + ':legacy', prop, prop === 'ratio' ? '图片比例' : '图片分辨率', node[prop], row, folded); if (visible) options.append(visible)
        }
        body.append(options)
      }
      body.append(references(node, provider, model))
      const inputs = layout.texts(node)
      const jobs = (s.state.jobs || []).filter(j => j.boardId === s.boardId && j.nodeId === node.id), job = jobs.at(-1), busy = ['queued', 'running'].includes(job?.status), unresolved = ['paused', 'uncertain'].includes(job?.status)
      const jobProvider = providers.find(item => item.id === job?.provider)
      const run = button('✦ 生成' + (model?.outputKind === 'video' ? '视频' : '图片'), () => s.execute('generate', { nodeId: node.id }), 'studio-primary')
      run.classList.add('studio-generate-run')
      const states = { queued: '排队中', running: '正在生成…', succeeded: '已生成 · 结果保留在右侧', failed: '生成失败', interrupted: '生成已中断', paused: '查询已暂停', uncertain: '提交结果待确认', detached: '本地跟踪已结束' }
      const status = el('div', { class: 'studio-job-status', role: 'status' }, job ? (states[job.status] || job.status) + (job.error ? ' · ' + job.error : '') : provider ? (provider.hasKey === false ? '请先在侧栏配置 ' + provider.label : provider.modelCatalog ? '选择模型并填写参数后生成' : provider.model) : '图片服务不可用，请启用对应插件')
      if (job?.remote?.taskId) status.append(el('code', { class: 'studio-remote-id' }, '远端 ID：' + job.remote.taskId))
      const working = jobs.filter(item => ['queued', 'running'].includes(item.status))
      if (working.length) status.prepend(el('div', { class: 'studio-active-jobs' }, `${working.length} 个任务进行中 · 可继续提交`))
      if (busy) status.append(button(jobProvider?.resumable ? '■ 暂停查询' : '■ 停止生成', () => api('/cancel', { id: job.id }).then(refresh)))
      if (!provider && job) status.textContent += ' · 生成服务已停用'
      if (unresolved) {
        const recovery = el('div', { class: 'studio-job-recovery' })
        if (job.status === 'paused') recovery.append(button('恢复查询', () => s.execute('resume', { jobId: job.id }), 'studio-primary'))
        recovery.append(button('结束本地跟踪', () => { if (window.confirm('远端任务可能仍在运行并计费。结束本地跟踪后，可以重新生成；请先核对 WaveSpeed 任务记录。是否结束跟踪？')) return s.execute('detach', { jobId: job.id }) })); status.append(recovery)
      }
      updateRun = () => { run.disabled = !provider || jobs.some(item => item.status === 'uncertain') || provider.modelCatalog && (!model?.supported || form.hasErrors(node, provider)) }
      updateRun()
      body.append(inputs, folded); card.append(status, run); layout.resize(node, card)
    },
  })
}
