import { createView } from './view.js'
import { configuration, EXPRESSIONS, EXPRESSION_LABELS, isAbort, missingConfiguration, patchConfiguration } from './helpers.js'

let sequence = 0
const el = (tag, className = '', text) => { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node }

export function createPanel(engine, container) {
  let disposed = false, preview, previewKey = '', activeId = '', generation = 0
  let loaded = { expressions: [], motions: [] }
  const listeners = []
  const root = el('section', 'ne-live2d-panel ne-stack')
  container.append(root)
  function listen(target, type, handler) { target.addEventListener(type, handler); listeners.push(() => target.removeEventListener(type, handler)) }
  function button(text, handler, className = 'ne-button') { const node = el('button', className, text); node.type = 'button'; listen(node, 'click', handler); return node }
  function field(parent, label, control, hint) {
    const wrap = el('label', 'ne-field')
    wrap.append(el('span', '', label), control)
    if (hint) wrap.append(el('small', 'ne-muted', hint))
    parent.append(wrap)
  }
  const characterSelect = el('select', 'ne-select')
  field(root, '配置角色', characterSelect)
  const empty = el('p', 'ne-empty', '先在角色档案中添加角色，再配置 Live2D。')
  root.append(empty, el('p', 'ne-muted', '可选功能。请提供获授权的模型与 Cubism SDK Core；未配置或加载失败时，故事继续使用静态立绘。'))
  const form = el('fieldset', 'ne-live2d-fields ne-stack')
  const legend = el('legend', 'ne-live2d-legend', '角色 Live2D 配置')
  form.append(legend); root.append(form)
  const inputs = {}
  for (const [key, label, placeholder, hint] of [
    ['modelUrl', '模型 URL（.model3.json）', '/models/character/character.model3.json', '保留模型原目录结构，提供 .moc3、纹理及引用的动作、表情等文件。'],
    ['coreUrl', 'Cubism Core URL', '/live2d/live2dcubismcore.js', '使用你从合法取得的 Cubism 4 SDK 中提供的 Core 文件；跨域地址需要允许 CORS。'],
  ]) {
    const input = el('input', 'ne-input'); input.type = 'text'; input.placeholder = placeholder; input.maxLength = 4000; input.autocomplete = 'off'
    inputs[key] = input; field(form, label, input, hint)
    listen(input, 'change', () => change({ [key]: input.value }))
  }
  const configurationStatus = el('p', 'ne-live2d-config-status ne-muted')
  configurationStatus.setAttribute('role', 'status')
  form.append(configurationStatus)
  const previewBox = el('div', 'ne-live2d-preview')
  const fallback = el('img', 'ne-live2d-preview-portrait'); fallback.alt = '角色静态立绘'; fallback.draggable = false; fallback.hidden = true
  const placeholder = el('span', 'ne-live2d-placeholder', '加载模型后在此预览')
  previewBox.append(fallback, placeholder); root.append(previewBox)
  listen(fallback, 'error', () => { fallback.hidden = true })
  const status = el('p', 'ne-live2d-status ne-muted')
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite')
  const tools = el('div', 'ne-row ne-live2d-tools')
  const loadButton = button('加载预览', () => { void loadPreview() }, 'ne-button ne-primary')
  const stopButton = button('停止预览', () => { stopPreview(); show('预览已停止，资源已释放。') })
  stopButton.disabled = true; tools.append(loadButton, stopButton); root.append(tools, status)
  const expressionFields = el('fieldset', 'ne-live2d-fields ne-stack')
  expressionFields.append(el('legend', 'ne-section-title', '剧情表情映射'))
  root.append(expressionFields)
  const expressionList = el('datalist'); expressionList.id = `ne-live2d-expressions-${++sequence}`; root.append(expressionList)
  const expressionInputs = {}, expressionButtons = []
  for (const key of EXPRESSIONS) {
    const input = el('input', 'ne-input'); input.type = 'text'; input.maxLength = 200; input.setAttribute('list', expressionList.id); input.placeholder = '模型中定义的表情 Name（留空为默认）'
    expressionInputs[key] = input
    field(expressionFields, `${EXPRESSION_LABELS[key]} · ${key}`, input)
    listen(input, 'change', () => change({ expressions: { [key]: input.value } }))
    const test = button(`预览${EXPRESSION_LABELS[key]}`, () => { void run(() => preview.expression(key, configuration(current()).expressions)) })
    expressionButtons.push(test); expressionFields.append(test)
  }
  expressionFields.append(el('p', 'ne-muted', '填写 .model3.json 中 Expressions 的 Name。加载预览后可从建议列表选择；留空会恢复模型默认表情。'))
  const tapFields = el('fieldset', 'ne-live2d-fields ne-stack')
  tapFields.append(el('legend', 'ne-section-title', '点击角色的动作'))
  const tapGroup = el('input', 'ne-input'); tapGroup.type = 'text'; tapGroup.maxLength = 200; tapGroup.placeholder = '留空关闭点击动作'
  const motionList = el('datalist'); motionList.id = `ne-live2d-motions-${sequence}`; tapGroup.setAttribute('list', motionList.id)
  const tapIndex = el('input', 'ne-input'); tapIndex.type = 'number'; tapIndex.min = '0'; tapIndex.step = '1'; tapIndex.placeholder = '留空则随机播放组内动作'
  field(tapFields, '动作组 group', tapGroup)
  field(tapFields, '动作序号 index（从 0 开始）', tapIndex)
  tapFields.append(motionList); root.append(tapFields)
  const motionButtons = el('div', 'ne-live2d-motions')
  root.append(el('h3', 'ne-section-title', '模型动作'), motionButtons)
  const clear = button('移除本角色的 Live2D 配置', () => {
    if (!canEdit()) return
    const id = activeId
    try { engine.update(project => { const character = project.characters.find(item => item.id === id); if (character) delete character.live2d }, { render: false }); stopPreview(); sync() } catch (error) { show(error.message, true) }
  }, 'ne-button ne-danger')
  root.append(clear)
  const current = () => engine.project?.characters.find(item => item.id === activeId)
  const canEdit = () => !disposed && engine.mode === 'edit' && !engine.held && Boolean(current())
  function show(message, error = false) { status.textContent = message; status.classList.toggle('ne-live2d-error', error) }
  function change(patch) {
    if (!canEdit()) return
    const id = activeId
    try { engine.update(project => { const character = project.characters.find(item => item.id === id); if (character) patchConfiguration(character, patch) }, { render: false }); sync() }
    catch (error) { show(error.message, true) }
  }
  function changeTap() {
    if (tapIndex.value !== '' && (!Number.isInteger(Number(tapIndex.value)) || Number(tapIndex.value) < 0)) { show('动作序号必须是从 0 开始的整数', true); return }
    change({ tapMotion: { group: tapGroup.value.trim(), ...(tapIndex.value === '' ? {} : { index: Number(tapIndex.value) }) } })
  }
  listen(tapGroup, 'change', changeTap); listen(tapIndex, 'change', changeTap)
  listen(characterSelect, 'change', () => { stopPreview(); engine.select({ characterId: characterSelect.value }); sync() })
  async function run(fn) {
    if (!preview) return
    try { await fn(); if (!disposed) show('预览已更新。') }
    catch (error) { if (!disposed && !isAbort(error)) show(error.message, true) }
  }
  function renderCatalog() {
    expressionList.replaceChildren(...loaded.expressions.map(item => { const option = el('option'); option.value = item.name; return option }))
    motionList.replaceChildren(...[...new Set(loaded.motions.map(item => item.group))].map(group => { const option = el('option'); option.value = group; return option }))
    motionButtons.replaceChildren()
    if (!preview || !loaded.motions.length) motionButtons.append(el('p', 'ne-muted', preview ? '该模型没有定义动作。' : '加载模型后显示实际动作列表。'))
    for (const item of loaded.motions) {
      // These buttons are rebuilt with their nodes and do not retain panel
      // cleanup closures per loaded model.
      const node = el('button', 'ne-button', `${item.group} · ${item.index}`); node.type = 'button'; node.title = item.file
      node.onclick = () => { void run(() => preview.motion(item)) }
      motionButtons.append(node)
    }
    for (const node of expressionButtons) node.disabled = !preview || !loaded.expressions.length
  }
  function stopPreview() {
    generation++; preview?.dispose(); preview = null; previewKey = ''
    loaded = { expressions: [], motions: [] }; previewBox.classList.remove('ne-live2d-active')
    placeholder.hidden = false; stopButton.disabled = true; loadButton.textContent = '加载预览'
    renderCatalog()
  }
  async function loadPreview() {
    if (!canEdit()) return
    stopPreview()
    const config = configuration(current()), missing = missingConfiguration(config), token = generation
    if (missing.length) { show(`尚缺少${missing.join('、')}`, true); return }
    previewKey = JSON.stringify([engine.project.id, activeId, config.modelUrl, config.coreUrl])
    show('正在加载 Core 与模型…'); stopButton.disabled = false; loadButton.textContent = '重新加载'
    try {
      const target = createView(previewBox, config, {
        stage: () => ({ position: 50, scale: 100 }),
        onError(error, detail) { if (disposed || token !== generation) return; if (!detail?.action) stopPreview(); show(`${error.message}；保留静态立绘。`, true) },
      })
      preview = target
      const entries = await target.ready
      if (disposed || token !== generation || preview !== target) { target.dispose(); return }
      loaded = entries; previewBox.classList.add('ne-live2d-active'); placeholder.hidden = true
      renderCatalog(); show(`模型已加载：${entries.motions.length} 个动作，${entries.expressions.length} 个表情。`)
      await run(() => target.expression('neutral', configuration(current()).expressions))
    } catch (error) { if (!disposed && token === generation && !isAbort(error)) { stopPreview(); show(error.message, true) } }
  }
  function sync() {
    if (disposed) return
    const characters = engine.project?.characters || []
    const selected = characters.find(item => item.id === engine.selection?.characterId) || characters[0]
    if (activeId !== (selected?.id || '')) { stopPreview(); show(''); activeId = selected?.id || '' }
    const config = configuration(current()), missing = missingConfiguration(config)
    if (preview && (engine.mode !== 'edit' || previewKey !== JSON.stringify([engine.project.id, activeId, config.modelUrl, config.coreUrl]))) { stopPreview(); show('预览已停止，资源已释放。') }
    const selectedOptions = JSON.stringify(characters.map(item => [item.id, item.name]))
    if (characterSelect.dataset.options !== selectedOptions) {
      characterSelect.replaceChildren(...characters.map(item => { const option = el('option', '', item.name); option.value = item.id; return option }))
      characterSelect.dataset.options = selectedOptions
    }
    characterSelect.value = activeId; characterSelect.disabled = !characters.length || engine.mode !== 'edit'
    empty.hidden = Boolean(current())
    for (const section of [form, expressionFields, tapFields]) section.disabled = !canEdit()
    clear.disabled = !canEdit() || !current()?.live2d
    loadButton.disabled = !canEdit() || Boolean(missing.length)
    for (const key of ['modelUrl', 'coreUrl']) if (document.activeElement !== inputs[key]) inputs[key].value = config[key]
    for (const key of EXPRESSIONS) if (document.activeElement !== expressionInputs[key]) expressionInputs[key].value = config.expressions[key]
    if (document.activeElement !== tapGroup) tapGroup.value = config.tapMotion.group || ''
    if (document.activeElement !== tapIndex) tapIndex.value = config.tapMotion.index === undefined ? '' : String(config.tapMotion.index)
    configurationStatus.textContent = !current() ? '' : missing.length ? `尚未配置：${missing.join('、')}。舞台使用静态立绘。` : '地址已配置；点击加载预览检查模型。'
    if (engine.mode === 'play') configurationStatus.textContent = '正在试玩；舞台自动加载出场角色的 Live2D。返回编辑后可调整配置。'
    const character = current(), portrait = character?.expressions?.neutral || character?.portrait
    const imageURL = portrait ? engine.asset(portrait) : ''
    fallback.hidden = !imageURL
    if (imageURL && fallback.getAttribute('src') !== imageURL) fallback.src = imageURL
    if (!imageURL) fallback.removeAttribute('src')
    preview?.configure(config)
  }
  sync(); renderCatalog()
  return {
    sync,
    dispose() { if (disposed) return; disposed = true; stopPreview(); for (const cleanup of listeners.splice(0)) cleanup(); root.remove() },
  }
}
