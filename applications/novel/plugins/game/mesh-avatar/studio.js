import { el, button, select } from '../ui.js'

export function createMeshStudioController({ request, getProject, acceptProject, notify }) {
  let frame, state = {}, disposed = false, ready, resolveReady, rejectReady, readyTimer, token = 0
  const pending = new Map(), listeners = new Set()
  const emit = () => { for (const fn of listeners) fn() }
  const snapshot = () => ({ ...structuredClone(state), connected: !!frame, projectId: getProject()?.id })
  const onMessage = event => {
    if (disposed || event.origin !== location.origin || event.source !== frame?.contentWindow || event.data?.channel !== 'novel-mesh') return
    const data = event.data
    if (data.state) { state = data.state; if (state.projectName && !state.busy) { clearTimeout(readyTimer); resolveReady?.(); resolveReady = null }; emit() }
    if (data.play) { frame.dispatchEvent(new CustomEvent('mesh-play')); return }
    const request = pending.get(data.requestId)
    if (request) { clearTimeout(request.timer); pending.delete(data.requestId); if (data.error) request.reject(Error(data.error)); else request.resolve(data.result) }
  }
  window.addEventListener('message', onMessage)
  function detach() {
    clearTimeout(readyTimer); rejectReady?.(Error('角色编辑器已关闭')); resolveReady = rejectReady = null
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error('角色编辑器已关闭')) }; pending.clear()
    frame = null; state = {}; emit()
  }
  async function command(action, args = {}) {
    if (!frame || disposed) throw Error('请先用 novel_mesh_open 打开 Mesh Avatar Studio')
    await ready
    const requestId = 'mesh-' + ++token
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(Error('角色编辑器操作超时；请检查编辑器里的提示')) }, action === 'rebuild' ? 180000 : 30000)
      pending.set(requestId, { resolve, reject, timer })
      frame.contentWindow.postMessage({ channel: 'novel-mesh', requestId, action, args }, location.origin)
    })
  }
  async function flush() {
    if (!frame) return
    await command('save')
    const pid = getProject()?.id, saved = await request('/api/novel/projects/' + encodeURIComponent(pid))
    if (getProject()?.id !== pid) throw Error('作品已切换')
    acceptProject(saved)
  }
  return {
    snapshot, command, flush, get dirty() { return !!state.dirty },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    attach(next) {
      detach(); frame = next
      ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; readyTimer = setTimeout(() => reject(Error('角色编辑器加载超时，请重新打开')), 25000) }); ready.catch(() => {})
      return detach
    },
    async adopt() {
      await command('save')
      const result = await request('/api/novel/projects/' + encodeURIComponent(getProject().id) + '/mesh-avatars/adopt', 'POST', { editorProject: state.projectName })
      acceptProject(result.project); notify('角色已加入作品，可在角色设定中关联'); return result
    },
    dispose() { disposed = true; detach(); window.removeEventListener('message', onMessage); listeners.clear() },
  }
}

export function meshStudio({ project, controller, request, notify, session, selectedId, selectModel, play }) {
  const root = el('section', 'novel-mesh-workspace'), toolbar = el('div', 'novel-mesh-toolbar'), status = el('span', 'novel-mesh-status')
  const models = (project.models || []).filter(m => m.engine === 'mesh-avatar')
  const selected = models.find(m => m.id === selectedId) || models[0]
  const run = fn => async () => { try { await fn() } catch (e) { notify(e.message) } }
  toolbar.append(el('div', '', el('span', 'novel-eyebrow', 'CHARACTER STUDIO'), el('strong', '', 'Mesh Avatar Studio')), status)
  if (!selected) {
    root.append(toolbar, el('p', 'novel-preview-note', '从作品库创建「Miko 官方角色示例」或「汐音原创角色示例」，也可导入包含 Mesh Avatar 角色的作品包。'))
    return { root, dispose() {} }
  }
  const selector = select(selected.id, models.map(m => ({ value: m.id, label: m.name })), run(async () => { await controller.flush(); selectModel(selector.value) }))
  selector.setAttribute('aria-label', '原生角色模型')
  toolbar.append(selector, button('保存并用于游戏', run(() => controller.flush().then(() => notify('角色已保存到游戏'))), 'novel-primary'), button('▶ 游戏中预览', run(async () => { await controller.flush(); await play() }), 'novel-accent'), button('将当前工程加入作品', run(() => controller.adopt()), 'novel-secondary'))
  const frame = el('iframe', 'novel-mesh-frame'); frame.title = 'Mesh Avatar Studio 完整角色编辑器'
  const detach = controller.attach(frame)
  frame.src = '/api/novel/projects/' + encodeURIComponent(project.id) + '/mesh-studio/editor.html?project=' + encodeURIComponent(selected.editorProject) + '&appSession=' + encodeURIComponent(session)
  frame.addEventListener('mesh-play', run(async () => { await controller.flush(); await play() }))
  const refresh = () => { const s = controller.snapshot(); status.textContent = !s.projectName ? '正在打开角色工程…' : s.busy ? '正在处理…' : s.dirty ? '有未保存修改' : '角色已保存' }
  const unsubscribe = controller.subscribe(refresh); refresh()
  root.append(toolbar, frame, el('small', 'novel-mesh-credit', 'Mesh Avatar Studio · 独立集成，无官方关联。各角色的来源与素材说明保留在工程中，并随作品包导出。'))
  return { root, dispose() { unsubscribe(); detach() } }
}

export function registerMeshTools(sdk, controller, { showStudio, getProject, guarded }) {
  const schema = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
  const str = { type: 'string' }, version = { type: 'integer' }
  const register = (name, description, properties, required, fn) => sdk.agent?.register({ name, description, inputSchema: schema(properties, required) }, guarded(fn))
  register('novel_mesh_open', '打开已关联作品的 Mesh Avatar 完整编辑器。modelId 可选；返回原生绑定、localVersion 和未保存状态。', { modelId: str }, [], async args => { await showStudio(args.modelId); return controller.command('read') })
  register('novel_mesh_read', '读取当前 Mesh Avatar Studio 的真实未保存绑定、口型配置和 localVersion。', {}, [], () => controller.command('read'))
  register('novel_mesh_edit', '批量修改当前原生绑定。先 read；path 如 head.shiftX、eyes.0.x0，value 为替换值，字段以当前工程为准。整批通过官方验证才写入编辑器，支持撤销。', { localVersion: version, operations: { type: 'array', items: { type: 'object', properties: { path: str, value: {} }, required: ['path', 'value'], additionalProperties: false } } }, ['localVersion', 'operations'], args => controller.command('edit', args))
  register('novel_mesh_preview', '控制官方编辑器中的真实姿态预览，参数使用 angleX/angleY/angleZ/gazeX/mouthOpen 等原生名称。', { parameters: { type: 'object', additionalProperties: { type: 'number' } }, expression: { enum: ['neutral','smile','shy','surprise','halfLidded','angry','sad','wink'] }, idle: { type: 'boolean' } }, [], args => controller.command('preview', args))
  register('novel_mesh_save', '保存编辑器修改并同步为游戏里的新模型版本；旧存档仍使用原版本。', {}, [], async () => { await controller.flush(); return { ...controller.snapshot(), models: getProject().models } })
  register('novel_mesh_check', '使用官方验证器检查当前原生绑定，返回 issues。姿态视觉质量仍需在预览中检查。', {}, [], () => controller.command('check'))
  register('novel_mesh_rebuild', '保存当前标注并运行官方分层重建工具，完成后更新游戏模型；需要本地 uv 和 Python 图像依赖。', {}, [], async () => { const result = await controller.command('rebuild'); await controller.flush(); return result })
}
