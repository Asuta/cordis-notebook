import { createStudioController } from './controller.js'
import { createSurface } from './surface.js'
import { PARAMS, LIVE_EXPRESSIONS } from './compiled/runtime.js'
import { configureDemo } from './demo.js'

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n }
const base64 = async file => { const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(binary) }
export default function meshStudioPlugin(ctx, sdk) {
  const engine = ctx.narrative, ui = ctx.narrativeUI, controller = createStudioController(sdk.request), surfaces = new Set()
  let currentPanel, disposed = false, opening = false
  const editable = () => { if (disposed || engine.mode !== 'edit' || engine.held) throw Error('请先返回编辑器，等待保存完成') }
  sdk.listen(window, 'beforeunload', event => { if (controller.dirty) { event.preventDefault(); event.returnValue = '' } })
  async function flush() {
    editable(); const next = structuredClone(engine.project), stamp = engine.version
    if (await controller.flushInto(next)) {
      if (engine.project.id !== next.id || engine.version !== stamp) throw Error('作品已改变，请重新保存角色')
      if (JSON.stringify(next.characters) !== JSON.stringify(engine.project.characters)) engine.update(p => { p.characters = next.characters }, { render: false })
      await engine.save()
    }
  }
  async function open(characterId, sample = false) {
    editable(); if (opening) throw Error('角色工程正在打开')
    opening = true
    try {
      await flush()
      if (sample) {
        characterId = 'character-' + crypto.randomUUID()
        engine.update(p => { p.characters.push({ id: characterId, name: 'Miko', description: 'Mesh Avatar Studio 预制示例角色', personality: '温柔、开朗', portrait: '', expressions: { neutral: '', happy: '', sad: '' }, color: '#a489bd' }) }, { render: false })
      }
      const projectId = engine.project.id, character = engine.project.characters.find(c => c.id === (characterId || engine.selection.characterId))
      if (!character) throw Error('请先选择一位角色')
      if (!sample && !character.meshAvatar) throw Error('这位角色尚无动态立绘，请导入 .mavatar 角色包，或载入 Miko 示例')
      const stamp = engine.version
      const result = await sdk.request('/api/narrative/mesh/projects/' + encodeURIComponent(projectId) + '/open', 'POST', { ...(sample ? {} : { archiveId: character.meshAvatar.archiveId }) })
      if (disposed || engine.project.id !== projectId || engine.version !== stamp || engine.mode !== 'edit') throw Error('作品已切换或修改，请重新打开角色工程')
      if (sample) engine.update(p => { p.characters.find(c => c.id === character.id).meshAvatar = result.model; const scene = p.nodes.find(n => n.id === engine.selection.nodeId); if (scene) scene.stage.characterId = character.id }, { render: false })
      engine.select({ characterId: character.id })
      await ui.navigate('mesh-studio')
      if (!currentPanel) throw Error('角色工作室尚未挂载')
      const frame = el('iframe', 'ne-mesh-frame'); frame.title = 'Mesh Avatar Studio 完整角色编辑器'
      controller.attach(frame, { projectId, characterId: character.id, ...result })
      frame.src = '/api/narrative/mesh/projects/' + encodeURIComponent(projectId) + '/studio/editor.html?project=' + encodeURIComponent(result.editorProject) + '&appSession=' + encodeURIComponent(result.session)
      currentPanel.frameHost.replaceChildren(frame); currentPanel.character.value = character.id
      await engine.save()
    } finally { opening = false }
  }
  function mountPanel(container) {
    if (engine.mode === 'play') { container.append(el('p', 'ne-muted', '返回编辑后可继续调整角色。')); return }
    const root = el('section', 'ne-mesh-workspace'), toolbar = el('div', 'ne-mesh-toolbar'), status = el('span', 'ne-muted'), character = el('select', 'ne-select'), frameHost = el('div', 'ne-mesh-frame-host')
    character.setAttribute('aria-label', '工作室角色')
    const run = fn => async () => { try { editable(); await fn() } catch (e) { sdk.toast(e.message) } }
    const button = (label, fn, primary = false) => { const b = el('button', 'ne-button' + (primary ? ' ne-primary' : ''), label); b.type = 'button'; b.addEventListener('click', run(fn)); return b }
    function sync() {
      const previous = character.value || engine.selection.characterId
      character.replaceChildren(...engine.project.characters.map(c => { const o = el('option', '', c.name + (c.meshAvatar ? ' · 动态角色' : '')); o.value = c.id; return o }))
      character.value = controller.opened?.characterId || previous
      const s = controller.snapshot(); status.textContent = !s.connected ? '选择角色开始编辑' : !s.projectName ? '正在打开工程…' : s.busy ? '正在处理…' : s.dirty ? '有未保存修改' : '编辑器已就绪'
    }
    const upload = el('input'); upload.type = 'file'; upload.accept = '.mavatar'; upload.hidden = true
    upload.addEventListener('change', run(async () => {
      const file = upload.files[0]; if (!file) return; if (file.size > 64 * 1024 * 1024) throw Error('角色包不能超过 64 MB')
      await flush(); const pid = engine.project.id, cid = character.value, stamp = engine.version
      if (!engine.project.characters.some(c => c.id === cid)) throw Error('请先在角色档案添加角色')
      const model = await sdk.request('/api/narrative/mesh/archives', 'POST', { base64: await base64(file) })
      if (engine.project.id !== pid || engine.version !== stamp || engine.mode !== 'edit') throw Error('作品已改变，请重新导入角色')
      engine.update(p => { p.characters.find(c => c.id === cid).meshAvatar = model }, { render: false }); await open(cid); upload.value = ''
    }))
    toolbar.append(character, button('打开角色工程', () => open(character.value)), button('载入 Miko 示例', () => open(undefined, true)), button('导入角色包', () => upload.click()), upload, button('保存并用于游戏', async () => { await flush(); sdk.toast('角色已保存到作品') }, true), button('用于当前场景', async () => { await flush(); engine.update(p => { p.nodes.find(n => n.id === engine.selection.nodeId).stage.characterId = character.value }, { render: false }); await engine.save() }), button('▶ 剧情中预览', async () => { await flush(); await engine.play(engine.selection.nodeId) }), status)
    frameHost.append(el('div', 'ne-mesh-empty', '打开已有动态角色，或载入 Miko 示例，即可编辑五官绑定并实时测试动作。支持导入含原生工程的 .mavatar 角色包。'))
    const demoButton = button('创建 Miko 演示作品', async () => { await flush(); await engine.create('galgame', 'Miko · 动态角色演示'); await open(undefined, true); const cid = controller.opened.characterId; engine.update(p => configureDemo(p, cid), { render: false }); engine.select({ nodeId: 'welcome', characterId: cid }); await engine.save() })
    toolbar.append(demoButton)
    root.append(toolbar, frameHost, el('small', 'ne-mesh-credit', 'Mesh Avatar Studio · 动态立绘编辑器 · 原生 .mavatar 格式。角色来源与许可说明随作品包保留。')); container.append(root)
    const panel = { root, frameHost, character, sync }; currentPanel = panel; sync()
    const unsubscribe = controller.subscribe(event => { sync(); if (event === 'play') void run(async () => { await flush(); await engine.play(engine.selection.nodeId) })() })
    return () => { unsubscribe(); if (currentPanel === panel) currentPanel = null; controller.detach(); root.remove() }
  }
  ui.registerPanel(ctx, { id: 'mesh-studio', label: '角色工作室', icon: 'PersonStanding', order: 34, wide: true, beforeLeave: flush, render: mountPanel })
  ui.registerSurface(ctx, { id: 'mesh-studio', order: 12, mount(container) { const view = createSurface(engine, container); surfaces.add(view); return () => { surfaces.delete(view); view.dispose() } } })
  engine.observe(ctx, event => { if (disposed) return; for (const view of surfaces) view.sync(); if (['project', 'selection'].includes(event.type)) currentPanel?.sync() })
  engine.registerResources(ctx, {
    id: 'mesh-studio', prepare: project => controller.flushInto(project),
    async export(project) {
      const ids = [...new Set(project.characters.filter(c => c.meshAvatar).map(c => c.meshAvatar.archiveId))], archives = {}
      let size = 0
      for (const id of ids) { const result = await sdk.request('/api/narrative/mesh/archives/' + id + '/export'); size += result.base64.length; if (size > 100 * 1024 * 1024) throw Error('角色资源总量过大，请减少作品中的角色后导出'); archives[id] = result.base64 }
      return ids.length ? { archives } : undefined
    },
    async import(project, bundle) {
      if (!bundle || typeof bundle.archives !== 'object') throw Error('角色资源包无效')
      for (const character of project.characters) if (character.meshAvatar) {
        const id = character.meshAvatar.archiveId, content = bundle.archives[id]
        if (typeof content !== 'string') throw Error('作品包缺少角色：' + character.name)
        const model = await sdk.request('/api/narrative/mesh/archives', 'POST', { base64: content })
        if (model.archiveId !== id) throw Error('角色资源校验失败')
        character.meshAvatar = model
      }
    },
  })
  const parameters = action => { const values = {}; for (const p of PARAMS) if (action[p.id] !== undefined) { if (typeof action[p.id] !== 'number' || !Number.isFinite(action[p.id]) || action[p.id] < p.min || action[p.id] > p.max) throw Error(p.id + ' 超出参数范围'); values[p.id] = action[p.id] } return values }
  engine.registerAction(ctx, { type: 'mesh-pose', label: '动态角色 · 姿态', fields: [{ key: 'angleX', label: '左右转头（-30～30）', kind: 'number', default: 0 }, { key: 'angleY', label: '抬头低头（-30～30）', kind: 'number', default: 0 }, { key: 'angleZ', label: '歪头（-30～30）', kind: 'number', default: 0 }], async execute(action) { const values = parameters(action); if (engine.mode !== 'play') throw Error('角色姿态仅在试玩时执行'); await Promise.all([...surfaces].map(s => s.ready())); engine.transact(r => { r.stage.meshParameters = values }) } })
  engine.registerAction(ctx, { type: 'mesh-motion', label: '动态角色 · 动作', fields: [{ key: 'id', label: '动作 ID（如 lookAround、shakeHead）', kind: 'string', default: 'lookAround' }], async execute(action) { if (engine.mode !== 'play') throw Error('角色动作仅在试玩时执行'); const avatars = await Promise.all([...surfaces].map(s => s.ready())); if (!avatars.length || !avatars.every(a => a.motions.some(m => m.id === action.id))) throw Error('找不到角色动作：' + action.id); engine.transact(r => { r.stage.meshMotion = { id: action.id, token: crypto.randomUUID() } }) } })
  const schema = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
  const register = (name, description, properties, required, fn) => sdk.agent?.register({ name, description, inputSchema: schema(properties, required) }, async args => { editable(); return fn(args) })
  register('narrative_mesh_open', '打开完整角色编辑器。sample=true 会新增 Miko 示例角色并用于当前场景；否则指定已有动态角色 characterId。', { characterId: { type: 'string' }, sample: { type: 'boolean' } }, [], async args => { await open(args.characterId, args.sample); return controller.command('read') })
  register('narrative_mesh_read', '读取编辑器真实绑定、口型设置、localVersion 和未保存状态。', {}, [], () => controller.command('read'))
  register('narrative_mesh_edit', '批量调整绑定，先 read；path 如 head.shiftX 或 eyes.0.x0，校验后一次写入并支持撤销。', { localVersion: { type: 'integer' }, operations: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, value: {} }, required: ['path', 'value'], additionalProperties: false } } }, ['localVersion', 'operations'], args => controller.command('edit', args))
  register('narrative_mesh_preview', '控制编辑器姿态、表情和待机预览。', { parameters: { type: 'object', additionalProperties: { type: 'number' } }, expression: { enum: LIVE_EXPRESSIONS }, idle: { type: 'boolean' } }, [], args => { parameters(args.parameters || {}); return controller.command('preview', args) })
  register('narrative_mesh_save', '保存角色原生工程并同步到叙事作品。', {}, [], async () => { await flush(); return { ...controller.snapshot(), character: engine.project.characters.find(c => c.id === controller.opened?.characterId) } })
  register('narrative_mesh_check', '使用原生校验器检查绑定，视觉质量需另在预览中确认。', {}, [], () => controller.command('check'))
  register('narrative_mesh_rebuild', '保存标注并重建分层，需要 uv 和 Python 图像依赖。', {}, [], async () => { const result = await controller.command('rebuild'); controller.invalidate(); await flush(); return result })
  ctx.effect(() => () => { disposed = true; controller.dispose(); for (const view of surfaces) view.dispose(); surfaces.clear() })
}
