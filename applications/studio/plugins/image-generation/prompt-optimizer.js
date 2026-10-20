import { reasoningModes, reasoningEfforts, reasoningLabel } from './prompt-optimizer-reasoning.js'

export function createPromptOptimizer(ctx, view, s, sdk) {
  const { el, button, safe } = view
  let stopped = false, loading = null
  let data = { models: [], defaultModelId: null, templates: [] }

  const manager = el('dialog', { class: 'studio-optimizer-dialog', 'aria-labelledby': 'studio-optimizer-title' })
  const preview = el('dialog', { class: 'studio-optimizer-preview', 'aria-labelledby': 'studio-optimizer-preview-title' })
  const templateList = el('div', { class: 'studio-optimizer-template-list' })
  const templateTitle = el('input', { type: 'text', maxlength: 60, placeholder: '例如：改成英文', autocomplete: 'off' })
  const templateInstruction = el('textarea', { maxlength: 8000, rows: 7, placeholder: '例如：请优化这个提示词，把提示词内容全部改成英文。' })
  const templateEditorTitle = el('h3', {}, '新建优化按钮')
  const templateStatus = el('p', { class: 'studio-optimizer-status', role: 'status' })
  const saveTemplateButton = button('保存优化按钮', () => saveTemplate(), 'studio-primary')
  const resetTemplateButton = button('新建', () => resetTemplate(), 'studio-optimizer-secondary')
  let editingTemplate = null

  manager.append(
    el('header', { class: 'studio-optimizer-dialog-head' }),
    el('p', { class: 'studio-optimizer-hint' }, '每个按钮对应一条独立的优化指令。生成卡上的所有优化按钮统一使用设置中的默认大模型。'),
    templateList,
    el('section', { class: 'studio-optimizer-editor' }),
  )
  const managerHead = manager.firstElementChild
  managerHead.append(el('h2', { id: 'studio-optimizer-title' }, '提示词优化按钮'), button('关闭', () => manager.close(), 'studio-optimizer-close'))
  const templateEditor = manager.querySelector('.studio-optimizer-editor')
  templateEditor.append(
    templateEditorTitle,
    el('label', { class: 'studio-optimizer-field' }, '按钮名称'),
    templateTitle,
    el('label', { class: 'studio-optimizer-field' }, '发给模型的优化指令'),
    templateInstruction,
    templateStatus,
    el('div', { class: 'studio-optimizer-editor-actions' }),
  )
  templateEditor.lastElementChild.append(saveTemplateButton, resetTemplateButton)

  const previewOriginal = el('pre', { class: 'studio-optimizer-preview-text' })
  const previewResult = el('pre', { class: 'studio-optimizer-preview-text is-result' })
  const previewMeta = el('p', { class: 'studio-optimizer-preview-meta' })
  const applyResultButton = button('使用优化结果', () => applyResult(), 'studio-primary')
  const copyResultButton = button('复制结果', () => copyResult(), 'studio-optimizer-secondary')
  preview.append(
    el('header', { class: 'studio-optimizer-dialog-head' }),
    previewMeta,
    el('div', { class: 'studio-optimizer-preview-columns' }),
    el('footer', { class: 'studio-optimizer-preview-actions' }),
  )
  const previewHead = preview.firstElementChild
  previewHead.append(el('h2', { id: 'studio-optimizer-preview-title' }, '优化结果预览'), button('关闭', () => preview.close(), 'studio-optimizer-close'))
  const previewColumns = preview.querySelector('.studio-optimizer-preview-columns')
  const originalColumn = el('section'), resultColumn = el('section')
  originalColumn.append(el('h3', {}, '当前提示词'), previewOriginal)
  resultColumn.append(el('h3', {}, '优化后'), previewResult)
  previewColumns.append(originalColumn, resultColumn)
  preview.querySelector('.studio-optimizer-preview-actions').append(copyResultButton, applyResultButton)
  let previewContext = null

  const settingsHost = el('div', { class: 'studio-llm-settings' })
  const modelSummary = el('p', { class: 'studio-llm-summary' }, '正在读取大模型配置…')
  const modelList = el('div', { class: 'studio-llm-model-list' })
  const modelName = el('input', { type: 'text', maxlength: 120, autocomplete: 'off', placeholder: '例如：OpenAI 主模型' })
  const modelBaseUrl = el('input', { type: 'url', maxlength: 2000, autocomplete: 'off', placeholder: 'https://api.openai.com/v1' })
  const modelIdInput = el('input', { type: 'text', maxlength: 200, autocomplete: 'off', placeholder: '例如：gpt-5.1' })
  const modelKey = el('input', { type: 'password', maxlength: 8000, autocomplete: 'new-password', placeholder: '填写 API Key' })
  const modelReasoningMode = el('select', { id: 'studio-llm-reasoning-mode', 'aria-label': '推理模式' })
  const modelReasoningEffort = el('select', { id: 'studio-llm-reasoning-effort', 'aria-label': '推理强度', disabled: true })
  for (const [value, label] of reasoningModes) modelReasoningMode.append(el('option', { value }, label))
  for (const [value, label] of reasoningEfforts) modelReasoningEffort.append(el('option', { value }, label))
  modelReasoningMode.value = 'default'; modelReasoningEffort.value = 'medium'
  sdk.listen(modelReasoningMode, 'change', () => { modelReasoningEffort.disabled = modelReasoningMode.value !== 'on' })
  const makeDefault = el('input', { type: 'checkbox' })
  const modelStatus = el('p', { class: 'studio-llm-status', role: 'status' })
  const formTitle = el('h4', {}, '添加模型')
  const saveModelButton = button('保存模型', () => saveModel(), 'studio-primary')
  const resetModelButton = button('清空', () => resetModel(), 'studio-optimizer-secondary')
  let editingModel = null

  const modelForm = el('section', { class: 'studio-llm-model-editor' })
  const defaultLabel = el('label', { class: 'studio-llm-default' })
  defaultLabel.append(makeDefault, el('span', {}, '设为所有提示词优化按钮的默认模型'))
  const modelActions = el('div', { class: 'studio-optimizer-editor-actions' })
  modelActions.append(saveModelButton, resetModelButton)
  const manageButtons = button('管理优化按钮', () => openManager(), 'studio-optimizer-secondary')
  const settingsActions = el('div', { class: 'studio-llm-settings-actions' })
  settingsActions.append(manageButtons)
  modelForm.append(
    formTitle,
    el('label', { class: 'studio-optimizer-field' }, '配置名称'), modelName,
    el('label', { class: 'studio-optimizer-field' }, '接口地址（OpenAI Responses API）'), modelBaseUrl,
    el('label', { class: 'studio-optimizer-field' }, '模型 ID'), modelIdInput,
    el('label', { class: 'studio-optimizer-field' }, 'API Key'), modelKey,
    el('label', { class: 'studio-optimizer-field', htmlFor: modelReasoningMode.id }, '推理模式'), modelReasoningMode,
    el('label', { class: 'studio-optimizer-field', htmlFor: modelReasoningEffort.id }, '推理强度'), modelReasoningEffort,
    el('p', { class: 'studio-llm-reasoning-hint' }, '跟随服务默认时不指定推理参数。关闭推理或选择强度需要模型和接口支持；不支持时可切回服务默认。'),
    defaultLabel, modelStatus, modelActions,
  )
  settingsHost.append(
    el('p', { class: 'studio-llm-hint' }, '可以配置多个 OpenAI Responses 兼容模型。API Key 仅保存在当前应用数据目录，不会通过配置读取接口返回。'),
    modelSummary,
    modelList,
    settingsActions,
    modelForm,
  )

  view.root.append(manager, preview)
  view.settings(ctx, {
    id: 'llm-prompt-optimization',
    title: '大模型服务与提示词优化',
    description: '添加多个 OpenAI Responses 兼容模型，并让所有提示词优化按钮统一使用默认模型。',
    scope: '仅当前应用',
    render(container) { container.append(settingsHost) },
    refresh: async () => { await load(); drawSettings(); drawTemplates() },
  })
  closeOnBackdrop(manager)
  closeOnBackdrop(preview)

  function closeOnBackdrop(dialog) {
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return
      const bounds = dialog.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close()
    })
  }

  async function load() {
    const version = (loading?.version || 0) + 1
    const task = Promise.all([view.api('/llm/config'), view.api('/prompt-optimizations')])
    loading = { version, task }
    try {
      const [config, templates] = await task
      if (stopped || loading.version !== version) return data
      data = {
        models: Array.isArray(config.models) ? config.models : [],
        defaultModelId: config.defaultModelId || null,
        templates: Array.isArray(templates.templates) ? templates.templates : [],
      }
      return data
    } finally {
      if (loading?.version === version) loading = null
    }
  }

  function openManager() {
    Promise.resolve(load()).then(() => {
      if (stopped) return
      drawTemplates()
      if (!manager.open) manager.showModal()
    }).catch(error => sdk.toast(error.message))
  }

  function resetTemplate() {
    editingTemplate = null
    templateTitle.value = ''; templateInstruction.value = ''; templateStatus.textContent = ''
    templateEditorTitle.textContent = '新建优化按钮'
    saveTemplateButton.textContent = '保存优化按钮'
  }

  function editTemplate(item) {
    editingTemplate = item
    templateTitle.value = item.title
    templateInstruction.value = item.instruction
    templateStatus.textContent = ''
    templateEditorTitle.textContent = '编辑优化按钮'
    saveTemplateButton.textContent = '保存修改'
    templateTitle.focus(); templateTitle.select()
  }

  function drawTemplates() {
    templateList.replaceChildren(...data.templates.map(item => {
      const row = el('article', { class: 'studio-optimizer-template' }), actions = el('div')
      row.append(el('strong', {}, item.title), el('p', {}, item.instruction))
      actions.append(button('编辑', () => editTemplate(item), 'studio-optimizer-secondary'), button('删除', () => deleteTemplate(item), 'studio-danger'))
      row.append(actions)
      return row
    }))
    if (!data.templates.length) templateList.append(el('p', { class: 'studio-optimizer-empty' }, '还没有优化按钮。新建后，它会显示在每张生成卡的提示词下方。'))
  }

  async function saveTemplate() {
    const title = templateTitle.value.trim(), instruction = templateInstruction.value.trim()
    if (!title) { templateStatus.textContent = '请输入按钮名称'; templateTitle.focus(); return }
    if (!instruction) { templateStatus.textContent = '请输入发给模型的优化指令'; templateInstruction.focus(); return }
    saveTemplateButton.disabled = true; templateStatus.textContent = '正在保存…'
    try {
      const result = await view.api('/prompt-optimizations', {
        ...(editingTemplate ? { id: editingTemplate.id, updatedAt: editingTemplate.updatedAt } : {}),
        title, instruction,
      })
      data.templates = result.templates
      drawTemplates(); resetTemplate(); view.render()
    } catch (error) { templateStatus.textContent = error.message } finally { saveTemplateButton.disabled = false }
  }

  async function deleteTemplate(item) {
    if (!window.confirm(`删除“${item.title}”这个优化按钮？`)) return
    templateStatus.textContent = '正在删除…'
    try {
      const result = await view.api('/prompt-optimizations', { action: 'delete', id: item.id })
      data.templates = result.templates
      if (editingTemplate?.id === item.id) resetTemplate()
      drawTemplates(); view.render(); templateStatus.textContent = ''
    } catch (error) { templateStatus.textContent = error.message }
  }

  function optimizerBar(node) {
    const wrap = el('div', { class: 'studio-prompt-optimizers', 'aria-label': '提示词优化' })
    for (const template of data.templates) {
      const action = button(template.title, async () => {
        action.disabled = true; action.dataset.busy = 'true'; action.textContent = template.title + ' · 优化中'
        try { await optimizePrompt(node, template) }
        finally { action.disabled = false; delete action.dataset.busy; action.textContent = template.title }
      }, 'studio-prompt-optimizer')
      action.title = template.instruction
      wrap.append(action)
    }
    wrap.append(button('管理优化', openManager, 'studio-optimizer-manage'))
    return wrap
  }

  async function optimizePrompt(node, template) {
    const boardId = s.boardId
    await view.flush()
    if (stopped || s.boardId !== boardId) throw Error('画板已切换，请重新优化')
    const current = s.state.boards.find(board => board.id === boardId)?.nodes.find(item => item.id === node.id)
    if (!current) throw Error('生成卡片已删除')
    if (!String(current.prompt || '').trim()) throw Error('请先填写主提示词')
    const result = await view.api('/prompt-optimize', { prompt: current.prompt, templateId: template.id })
    if (stopped || s.boardId !== boardId) return
    previewContext = { boardId, nodeId: node.id, original: current.prompt, optimized: result.prompt }
    previewOriginal.textContent = result.originalPrompt
    previewResult.textContent = result.prompt
    previewMeta.textContent = `${result.template.title} · ${result.model.name || result.model.model}`
    if (!preview.open) preview.showModal()
  }

  async function applyResult() {
    if (!previewContext) return
    const context = previewContext
    applyResultButton.disabled = true
    try {
      await view.flush()
      if (s.boardId !== context.boardId) throw Error('画板已切换，优化结果未应用')
      const current = s.state.boards.find(board => board.id === context.boardId)?.nodes.find(item => item.id === context.nodeId)
      if (!current) throw Error('生成卡片已删除')
      if (current.prompt !== context.original) throw Error('提示词在优化后已经修改，请重新优化')
      await view.edit([{ type: 'update', id: context.nodeId, patch: { prompt: context.optimized } }], { targetBoard: context.boardId })
      preview.close(); previewContext = null
      sdk.toast('已使用优化后的提示词')
    } finally { applyResultButton.disabled = false }
  }

  async function copyResult() {
    if (!previewContext) return
    if (!navigator.clipboard?.writeText) throw Error('当前环境不支持写入剪贴板')
    await navigator.clipboard.writeText(previewContext.optimized)
    sdk.toast('优化结果已复制')
  }

  function resetModel() {
    editingModel = null
    modelName.value = ''; modelBaseUrl.value = ''; modelIdInput.value = ''; modelKey.value = ''; makeDefault.checked = false
    modelReasoningMode.value = 'default'; modelReasoningEffort.value = 'medium'; modelReasoningEffort.disabled = true
    modelKey.placeholder = '填写 API Key'
    formTitle.textContent = '添加模型'; saveModelButton.textContent = '保存模型'; modelStatus.textContent = ''
  }

  function editModel(item) {
    editingModel = item
    modelName.value = item.name; modelBaseUrl.value = item.baseUrl; modelIdInput.value = item.model; modelKey.value = ''
    modelReasoningMode.value = item.reasoningMode || 'default'; modelReasoningEffort.value = item.reasoningEffort || 'medium'
    modelReasoningEffort.disabled = modelReasoningMode.value !== 'on'
    modelKey.placeholder = item.hasKey ? '已保存 Key；留空表示不修改' : '填写 API Key'
    makeDefault.checked = item.id === data.defaultModelId
    formTitle.textContent = '编辑模型'; saveModelButton.textContent = '保存修改'; modelStatus.textContent = ''
    modelName.focus(); modelName.select()
  }

  function drawSettings() {
    const current = data.models.find(item => item.id === data.defaultModelId)
    modelSummary.textContent = current ? `默认模型：${current.name} · ${current.model} · ${reasoningLabel(current)}` : '尚未设置默认模型。提示词优化按钮需要先配置并选择一个默认模型。'
    modelList.replaceChildren(...data.models.map(item => {
      const row = el('article', { class: 'studio-llm-model' + (item.id === data.defaultModelId ? ' is-default' : '') }), actions = el('div')
      const copy = el('div', { class: 'studio-llm-model-copy' })
      copy.append(el('strong', {}, item.name), el('small', {}, item.model), el('small', {}, reasoningLabel(item)), el('code', {}, item.baseUrl))
      if (item.id === data.defaultModelId) copy.append(el('span', { class: 'studio-llm-default-badge' }, '默认'))
      row.append(copy, actions)
      actions.append(button('编辑', () => editModel(item), 'studio-optimizer-secondary'), button('测试', () => testModel(item), 'studio-optimizer-secondary'))
      if (item.id !== data.defaultModelId) actions.append(button('设为默认', () => setDefaultModel(item)))
      actions.append(button('删除', () => deleteModel(item), 'studio-danger'))
      return row
    }))
    if (!data.models.length) modelList.append(el('p', { class: 'studio-optimizer-empty' }, '还没有配置大模型。填写接口地址、模型 ID 和 API Key 后保存。'))
  }

  async function saveModel() {
    saveModelButton.disabled = true; modelStatus.textContent = '正在保存…'
    try {
      const config = await view.api('/llm/config', {
        ...(editingModel ? { id: editingModel.id } : {}),
        name: modelName.value.trim(), baseUrl: modelBaseUrl.value.trim(), model: modelIdInput.value.trim(), apiKey: modelKey.value,
        reasoningMode: modelReasoningMode.value, reasoningEffort: modelReasoningEffort.value,
        default: makeDefault.checked,
      })
      data.models = config.models; data.defaultModelId = config.defaultModelId
      drawSettings(); resetModel(); modelStatus.textContent = '已保存'
    } catch (error) { modelStatus.textContent = error.message } finally { saveModelButton.disabled = false }
  }

  async function setDefaultModel(item) {
    modelStatus.textContent = '正在切换默认模型…'
    try {
      const config = await view.api('/llm/config', { action: 'default', id: item.id })
      data.models = config.models; data.defaultModelId = config.defaultModelId
      drawSettings(); modelStatus.textContent = '已设为默认模型'
    } catch (error) { modelStatus.textContent = error.message }
  }

  async function deleteModel(item) {
    if (!window.confirm(`删除模型“${item.name}”？`)) return
    modelStatus.textContent = '正在删除…'
    try {
      const config = await view.api('/llm/config', { action: 'delete', id: item.id })
      data.models = config.models; data.defaultModelId = config.defaultModelId
      if (editingModel?.id === item.id) resetModel()
      drawSettings(); modelStatus.textContent = '已删除'
    } catch (error) { modelStatus.textContent = error.message }
  }

  async function testModel(item) {
    modelStatus.textContent = `正在测试“${item.name}”…`
    try {
      const result = await view.api('/llm/test', { id: item.id })
      modelStatus.textContent = `连接成功：${result.message || 'OK'}`
    } catch (error) { modelStatus.textContent = error.message }
  }

  sdk.listen(preview, 'cancel', () => { previewContext = null })
  sdk.listen(manager, 'cancel', () => resetTemplate())
  ctx.effect(() => () => { stopped = true; manager.remove(); preview.remove() })
  void load().then(() => { if (!stopped) { drawSettings(); drawTemplates(); view.render() } }).catch(() => { if (!stopped) modelSummary.textContent = '读取大模型配置失败，请打开应用设置后重试。' })

  return { bar: optimizerBar, openManager, refresh: load }
}
