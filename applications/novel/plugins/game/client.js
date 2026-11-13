import { validateProject, diagnose, upgradeProject, syncLegacy, commandIssues } from './model.js'
import { previewState } from './engine.js'
import { renderEditor } from './editor.js'
import { createPlayer } from './player.js'
import { exportPackage, importPackage } from './package.js'
import { el, button, input } from './ui.js'
import { createModelController, registerModelTools } from './live2d/controller.js'
import { createMeshStudioController, registerMeshTools } from './mesh-avatar/studio.js'

const projectPath = id => '/api/novel/projects/' + encodeURIComponent(id)
const toBase64 = bytes => { let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(binary) }

export default async function (ctx, sdk) {
  const root = el('main', 'novel-app'), notice = el('div', 'novel-toast'); sdk.mount('app', root)
  let projects = await sdk.request('/api/novel/projects'), project = null, mode = 'library', player = null
  let timer, pending = null, operation = null, dirty = false, stopped = false, held = false, localVersion = 0, status = '已保存'
  const view = { section: 'story', sceneId: '' }
  const undo = [], redo = []
  const appSession = (await sdk.request('/api/applications')).session
  const acceptModelProject = saved => {
    if (project?.id !== saved.id) throw Error('作品已切换')
    project.revision = saved.revision; project.models = saved.models || []; project.assets = saved.assets
    localVersion++; status = '已保存'; updateStatus()
  }
  const meshController = createMeshStudioController({ request: sdk.request, getProject: () => project, acceptProject: acceptModelProject, notify: toast })
  const modelController = createModelController({ request: sdk.request, getProject: () => project, storage: sdk.storage.local, notify: toast, write: action => exclusive(async () => { await save(); return action() }), acceptProject: acceptModelProject })
  const flushModels = async () => { await meshController.flush(); await modelController.flush() }
  const assetUrl = (id, projectId = project?.id) => projectPath(projectId) + '/assets/' + encodeURIComponent(id)
  function toast(message) { notice.textContent = message; notice.classList.add('visible'); setTimeout(() => notice.classList.remove('visible'), 5000) }
  const draftKey = () => 'draft-' + project?.id
  function remember() { try { if (project) sdk.storage.local.setItem(draftKey(), JSON.stringify(project)) } catch { toast('浏览器草稿备份失败，请立即保存') } }
  function changed() {
    localVersion++; dirty = true; status = '正在保存…'; remember(); clearTimeout(timer)
    timer = setTimeout(() => save().catch(error => { status = '保存失败'; toast(error.message); updateStatus() }), 600)
    updateStatus()
  }
  function updateStatus() {
    const node = root.querySelector('.novel-save-status'); if (node) node.textContent = status
    const undoButton = root.querySelector('[data-history="undo"]'), redoButton = root.querySelector('[data-history="redo"]')
    if (undoButton) undoButton.disabled = !undo.length
    if (redoButton) redoButton.disabled = !redo.length
  }
  async function save() {
    clearTimeout(timer)
    if (!project || stopped) return
    if (pending) return pending
    pending = Promise.resolve().then(async () => {
      while (dirty && !stopped) {
        const id = project.id, version = localVersion, snapshot = structuredClone(project)
        validateProject(snapshot)
        const saved = await sdk.request(projectPath(id), 'PUT', snapshot)
        if (!project || project.id !== id || stopped) return
        project.revision = saved.revision
        if (version === localVersion) { dirty = false; status = '已保存'; sdk.storage.local.removeItem(draftKey()) }
        else remember()
        updateStatus()
      }
    }).finally(() => { pending = null })
    return pending
  }
  function update(fn, rerender = false, mark = true) {
    if (held || operation || stopped || !project) return
    if (mark) { undo.push(structuredClone(project)); if (undo.length > 60) undo.shift(); redo.length = 0 }
    fn(project)
    if (mark) changed()
    if (rerender) render()
    else view.refreshPreview?.()
  }
  function historyAction(direction) {
    if (held || operation || stopped || !project || mode !== 'edit') return
    const from = direction === 'undo' ? undo : redo, to = direction === 'undo' ? redo : undo
    if (!from.length) return
    to.push(structuredClone(project)); const { revision, assets, models } = project; project = from.pop(); Object.assign(project, { revision, assets, models })
    changed(); render()
  }
  async function exclusive(action) {
    if (held || operation || stopped) throw Error('正在保存或切换作品，请稍后再试')
    root.inert = true
    operation = Promise.resolve().then(action)
    try { return await operation } finally { operation = null; root.inert = held }
  }
  async function refresh() { projects = await sdk.request('/api/novel/projects') }
  async function load(id, destination = 'edit') {
      await save(); project = await sdk.request(projectPath(id)); dirty = false; localVersion = 0; undo.length = redo.length = 0
      try {
        const draft = JSON.parse(sdk.storage.local.getItem(draftKey()))
        if (draft?.revision === project.revision) { project = validateProject(draft); dirty = true; status = '已恢复本机草稿'; changed() }
        else if (draft) toast('发现旧草稿，作品已在别处更新；旧草稿已保留在浏览器中')
      } catch { toast('浏览器草稿读取失败') }
      project = upgradeProject(project)
      if (!dirty) status = '已保存'
      modelController.syncProject(); view.sceneId = project.startSceneId; view.section = 'story'; mode = destination; render()
  }
  const open = async (id, destination) => { await flushModels(); return exclusive(() => load(id, destination)) }
  const createProject = title => exclusive(async () => { await save(); const p = await sdk.request('/api/novel/projects', 'POST', { title }); await refresh(); await load(p.id); return { project: structuredClone(project), localVersion } })
  async function library() { try { await flushModels(); await exclusive(async () => { await save(); player?.dispose(); player = null; project = null; modelController.syncProject(); mode = 'library'; await refresh(); render() }) } catch (error) { toast(error.message) } }
  const playStatus = () => ({ mode, ...player.getStatus() })
  const exitPlay = () => { mode = 'edit'; render(); return { mode, projectId: project.id, localVersion } }
  const startPlay = async (sceneId, commandId, values = view.testValues) => { await flushModels(); return exclusive(async () => {
    await save(); mode = 'play'; render({ sceneId, commandId, values })
    try { return playStatus() } catch (error) { exitPlay(); throw error }
  }) }
  async function play(sceneId, commandId) { try { await startPlay(sceneId, commandId) } catch (error) { toast(error.message) } }
  async function uploadAsset(file) {
    if (!file || file.size > 8 * 1024 * 1024) return toast('单个素材不能超过 8 MB')
    const mime = file.type === 'audio/x-wav' || file.type === 'audio/wave' ? 'audio/wav' : file.type
    try {
      await exclusive(async () => {
      await save()
      const bytes = new Uint8Array(await file.arrayBuffer())
      project = await sdk.request(projectPath(project.id) + '/assets', 'POST', { name: file.name, mime, base64: toBase64(bytes) })
      project = upgradeProject(project); undo.length = redo.length = 0
      status = '已保存'; render(); toast('已添加素材：' + file.name)
      })
    } catch (error) { toast(error.message) }
  }
  async function download(p = project) { try { await flushModels(); await exclusive(async () => { if (p === project) await save(); await exportPackage(structuredClone(p)); toast('作品包已下载') }) } catch (error) { toast(error.message) } }
  async function importFile(file) {
    if (!file) return
    try { await exclusive(async () => { await save(); toast('正在导入作品与素材…'); const p = await importPackage(file, sdk.request); await refresh(); toast('导入完成，已创建独立副本'); await load(p.id) }) }
    catch (error) { toast(error.message); await refresh(); render() }
  }
  function renderLibrary() {
    const page = el('div', 'novel-library')
    const titleInput = input('', () => {}, '给新故事起个名字'); titleInput.setAttribute('aria-label', '新作品名称')
    const createPanel = el('div', 'novel-create-inline'); createPanel.hidden = true
    const create = async () => {
      const title = titleInput.value.trim(); if (!title) return toast('请输入作品名称')
      try { await createProject(title) } catch (error) { toast(error.message) }
    }
    titleInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void create() } })
    createPanel.append(titleInput, button('创建故事', create, 'novel-primary'), button('取消', () => { createPanel.hidden = true }, 'novel-ghost'))
    page.append(el('div', 'novel-library-hero', el('div', '', el('span', 'novel-eyebrow', 'STORY STUDIO / 视觉小说工坊'), el('h1', '', '写下故事，走进故事。'), el('p', '', '让每一次选择，都通向一个不一样的夜晚。'), el('div', 'novel-hero-actions', button('＋ 创建新作品', () => { createPanel.hidden = false; titleInput.focus() }, 'novel-primary'), button('导入作品包', () => picker.click(), 'novel-ghost')), createPanel), el('div', 'novel-hero-ornament', '✦')))
    page.querySelector('.novel-hero-actions').append(button('＋ 演出示例', async () => {
      try { await exclusive(async () => { await save(); const p = await sdk.request('/api/novel/demo', 'POST'); await refresh(); await load(p.id) }) } catch (error) { toast(error.message) }
    }, 'novel-secondary'))
    page.querySelector('.novel-hero-actions').append(button('✦ 动态角色示例', async () => {
      try { await exclusive(async () => { await save(); const p = await sdk.request('/api/novel/avatar-demo', 'POST'); await refresh(); await load(p.id) }) } catch (error) { toast(error.message) }
    }, 'novel-secondary'))
    page.querySelector('.novel-hero-actions').append(button('✦ Miko 官方角色示例', async () => {
      try { await exclusive(async () => { await save(); toast('正在载入官方角色与演出…'); const p = await sdk.request('/api/novel/miko-demo', 'POST'); await refresh(); await load(p.id); view.section = 'mesh-models'; render() }) } catch (error) { toast(error.message) }
    }, 'novel-accent'))
    page.querySelector('.novel-hero-actions').append(button('✦ 汐音原创角色示例', async () => {
      try { await exclusive(async () => { await save(); toast('正在载入汐音与演出…'); const p = await sdk.request('/api/novel/shion-demo', 'POST'); await refresh(); await load(p.id) }) } catch (error) { toast(error.message) }
    }, 'novel-accent'))
    const picker = el('input'); picker.type = 'file'; picker.accept = '.zip,.novel.zip,application/zip'; picker.hidden = true
    picker.addEventListener('change', () => { const file = picker.files[0]; picker.value = ''; void importFile(file) }); page.append(picker)
    page.append(el('div', 'novel-library-heading', el('div', '', el('span', 'novel-eyebrow', 'YOUR LIBRARY'), el('h2', '', '作品库')), el('span', '', projects.length + ' 部作品')))
    const grid = el('div', 'novel-library-grid')
    for (const item of projects) {
      const card = el('article', 'novel-project-card'), cover = el('div', 'novel-project-cover', el('span', '', 'VISUAL NOVEL'))
      if (item.coverId) cover.style.backgroundImage = 'linear-gradient(0deg, #172235bb, transparent 60%), url("' + assetUrl(item.coverId, item.id) + '")'
      card.append(cover, el('div', 'novel-project-info', el('h3', '', item.title), el('p', '', item.description || '一个等待被讲述的新故事。'), el('small', '', item.scenes + ' 个场景'), el('div', 'novel-card-actions', button('▶ 开始游玩', () => open(item.id, 'play').catch(error => toast(error.message)), 'novel-accent'), button('编辑作品', () => open(item.id).catch(error => toast(error.message)), 'novel-secondary'), button('导出', async () => { try { await download(await sdk.request(projectPath(item.id))) } catch (error) { toast(error.message) } }, 'novel-secondary'), button('⋯', () => {
        if (!confirm('永久删除「' + item.title + '」及其素材？此操作无法撤销。')) return
        sdk.request(projectPath(item.id), 'DELETE').then(refresh).then(render).catch(error => toast(error.message))
      }, 'novel-icon'))))
      grid.append(card)
    }
    page.append(grid); return page
  }
  function render(position = {}) {
    view.disposePreview?.(); view.disposePreview = view.refreshPreview = null
    player?.dispose(); player = null
    root.replaceChildren()
    if (mode === 'library') root.append(renderLibrary())
    else if (mode === 'play') {
      player = createPlayer(project, sdk, { startSceneId: position.sceneId, startCommandId: position.commandId, previewValues: position.values ?? view.testValues, onPosition: point => { view.sceneId = point.sceneId; view.commandId = point.commandId }, onExit: exitPlay, assetUrl })
      root.append(player.root)
    } else {
      const header = el('header', 'novel-app-header', button('← 作品库', library, 'novel-back'), el('div', 'novel-header-title', el('span', 'novel-eyebrow', 'VISUAL NOVEL EDITOR'), el('strong', '', project.title)), el('span', 'novel-save-status', status), button('▶ 试玩', () => play(project.startSceneId), 'novel-accent'), button('↓ 导出作品包', () => download(), 'novel-secondary'))
      const undoButton = button('撤销', () => historyAction('undo'), 'novel-secondary'), redoButton = button('重做', () => historyAction('redo'), 'novel-secondary')
      undoButton.dataset.history = 'undo'; redoButton.dataset.history = 'redo'; undoButton.disabled = !undo.length; redoButton.disabled = !redo.length; header.append(undoButton, redoButton)
      root.append(header, renderEditor({ project, view, update, openScene: id => { void flushModels().then(() => { view.sceneId = id; view.section = 'story'; render() }).catch(error => toast(error.message)) }, play, uploadAsset, assetUrl, modelController, meshController, appSession, request: sdk.request, notify: toast }))
    }
    root.append(notice)
  }
  ctx.effect(() => () => { stopped = true; clearTimeout(timer); player?.dispose(); view.disposePreview?.(); modelController.dispose(); meshController.dispose() })
  sdk.listen(window, 'keydown', event => { if (mode === 'edit' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.target?.closest?.('input,textarea,select')) { event.preventDefault(); if (view.section === 'models') { try { modelController.history(event.shiftKey ? 'redo' : 'undo') } catch (e) { toast(e.message) } } else historyAction(event.shiftKey ? 'redo' : 'undo') } })
  sdk.listen(window, 'beforeunload', event => { if (dirty || modelController.dirty || meshController.dirty) { event.preventDefault(); event.returnValue = '' } })
  ctx.on('plugins/before-stop', async request => { if (operation) await operation; await flushModels(); held = true; root.inert = true; request.hold(() => { held = false; root.inert = !!operation }); await save() })
  ctx.on('plugins/remote-stop', () => { if (dirty) remember() })
  const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
  const id = { type: 'string' }, version = { type: 'integer' }
  registerModelTools(sdk, modelController, { getProject: () => project, showStudio: () => { mode = 'edit'; view.section = 'models'; render() } })
  registerMeshTools(sdk, meshController, { getProject: () => project, guarded: fn => async args => { if (!project || stopped || held || operation) throw Error('请先打开作品，并等待当前操作完成'); return fn(args) }, showStudio: async modelId => {
    await flushModels(); await save()
    const model = (project.models || []).find(m => m.engine === 'mesh-avatar' && (!modelId || m.id === modelId))
    if (!model) throw Error('作品中没有此原生角色模型')
    mode = 'edit'; view.section = 'mesh-models'; view.meshModelId = model.id; render()
  } })
  sdk.agent?.register({ name: 'novel_read', description: '读取当前视觉小说作品、演出指令、本机未保存编辑、当前模式 mode、当前场景和指令、剧情检查结果及 localVersion。编辑前先读取。', inputSchema: schema({}) }, () => ({ projects, project: project && structuredClone(project), mode, localVersion, selection: { sceneId: view.sceneId, commandId: view.commandId }, canUndo: !!undo.length, canRedo: !!redo.length, issues: project ? [...diagnose(project), ...commandIssues(project)] : [] }))
  sdk.agent?.register({ name: 'novel_open', description: '在当前页面打开一部作品，返回其完整剧情。切换前保存当前编辑。', inputSchema: schema({ id }, ['id']) }, async args => { await open(args.id); return { project, localVersion } })
  sdk.agent?.register({ name: 'novel_create', description: '创建并打开一部空白视觉小说。', inputSchema: schema({ title: id }, ['title']) }, args => createProject(args.title))
  sdk.agent?.register({ name: 'novel_play', description: '控制当前页面的真实试玩。action：start 从作品起点或 sceneId/commandId 启动并保存编辑（values 可传测试变量）；status 读取状态；advance 补全当前文字并推进一步，也可跳过等待；choose 用 choiceId 选择当前可用分支；rollback 回退；restart 从作品起点重开；exit 回编辑器。可传 projectId 防止操作已切换的作品。返回当前位置、对白、舞台、变量、ended、可用 choices 和回退能力。控制动作会关闭面板并停止自动/已读快进；与页面、存档和解锁共享状态。', inputSchema: schema({ action: { type: 'string', enum: ['start', 'status', 'advance', 'choose', 'rollback', 'restart', 'exit'] }, projectId: id, sceneId: id, commandId: id, values: { type: 'object' }, choiceId: id }, ['action']) }, async args => {
    if (!['start', 'status', 'advance', 'choose', 'rollback', 'restart', 'exit'].includes(args.action)) throw Error('未知试玩动作')
    if (held || operation || stopped) throw Error('正在保存或切换作品，请稍后再试')
    if (!project) throw Error('请先用 novel_open 打开要试玩的作品')
    if (args.projectId !== undefined && args.projectId !== project.id) throw Error('作品已切换，请重新 novel_read 确认当前作品')
    if (args.action === 'start') {
      const sceneId = args.sceneId ?? project.startSceneId, scene = project.scenes.find(s => s.id === sceneId)
      if (!scene || args.commandId !== undefined && !scene.commands.some(c => c.id === args.commandId)) throw Error('场景或指令不存在，请重新 novel_read')
      if (args.values !== undefined && (!args.values || typeof args.values !== 'object' || Array.isArray(args.values))) throw Error('测试变量必须是对象')
      for (const [key, value] of Object.entries(args.values || {})) {
        const v = project.variables.find(v => v.id === key)
        if (!v || typeof value !== typeof v.initial || typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 9999)) throw Error('测试变量无效：' + key)
      }
      return startPlay(sceneId, args.commandId, args.values || {})
    }
    if (mode !== 'play' || !player) throw Error('当前未在试玩，请先 novel_play action:start')
    if (args.action === 'status') return playStatus()
    if (args.action === 'exit') return exitPlay()
    if (args.action === 'choose' && (typeof args.choiceId !== 'string' || !args.choiceId)) throw Error('请选择当前可用选项并提供 choiceId')
    if (args.action === 'choose') player.choose(args.choiceId)
    else player[args.action]()
    return playStatus()
  })
  sdk.agent?.register({ name: 'novel_edit', description: '使用 novel_read 的 project.id 和 localVersion 编辑。operations 支持 set_project{patch:{title?,description?,startSceneId?}}；upsert_scene/upsert_character/upsert_variable/upsert_animation{value:完整对象}；remove_scene/remove_character/remove_variable/remove_animation{id}；upsert_command{sceneId,value:完整指令,index?:零基位置}、remove_command{sceneId,id}、move_command{sceneId,id,index}。支持镜头、震动、天气、滤镜、动画、独白、字幕与文字样式，格式见应用 agent.md。素材通过页面上传。编辑共用撤销重做、自动保存和剧情校验。', inputSchema: schema({ projectId: id, localVersion: version, operations: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object' } } }, ['projectId', 'localVersion', 'operations']) }, async args => {
    if (!project || mode === 'play' || held || operation || stopped || args.projectId !== project.id || args.localVersion !== localVersion) throw Error('请在编辑器中重新 novel_read，确认当前作品和版本')
    if (!Array.isArray(args.operations) || !args.operations.length || args.operations.length > 50) throw Error('请提供 1–50 个剧情编辑操作')
    const next = structuredClone(project)
    for (const op of args.operations) {
      if (!op || typeof op !== 'object') throw Error('剧情编辑操作无效')
      if (op.type === 'set_project' && op.patch && Object.keys(op.patch).every(k => ['title','description','startSceneId'].includes(k))) Object.assign(next, op.patch)
      else if (['scene','character','variable','animation'].some(k => op.type === 'upsert_' + k) && op.value) {
        const list = op.type === 'upsert_scene' ? next.scenes : op.type === 'upsert_character' ? next.cast : op.type === 'upsert_variable' ? next.variables : (next.animations ||= [])
        const at = list.findIndex(x => x.id === op.value.id); if (at < 0) list.push(op.value); else list[at] = op.value
      } else if (['upsert_command', 'remove_command', 'move_command'].includes(op.type)) {
        const scene = next.scenes.find(s => s.id === op.sceneId)
        if (!scene) throw Error('指令所属场景不存在')
        const at = scene.commands.findIndex(c => c.id === (op.value?.id || op.id))
        if (op.type === 'upsert_command' && op.value) { if (at < 0) scene.commands.splice(Number.isInteger(op.index) ? Math.max(0, op.index) : scene.commands.length, 0, op.value); else scene.commands[at] = op.value }
        else if (at >= 0 && op.type === 'remove_command') scene.commands.splice(at, 1)
        else if (at >= 0 && op.type === 'move_command' && Number.isInteger(op.index)) { const [command] = scene.commands.splice(at, 1); scene.commands.splice(Math.max(0, op.index), 0, command) }
        else throw Error('指令操作无效')
        syncLegacy(scene)
      } else if (['remove_scene','remove_character','remove_variable','remove_animation'].includes(op.type)) {
        const list = op.type === 'remove_scene' ? 'scenes' : op.type === 'remove_character' ? 'cast' : op.type === 'remove_variable' ? 'variables' : 'animations'
        if (list === 'animations' && next.scenes.some(s => s.commands.some(c => c.type === 'animate' && c.animationId === op.id))) throw Error('动画仍被剧情引用，请先更换或停止对应指令')
        next[list] = (next[list] || []).filter(x => x.id !== op.id)
      } else throw Error('未知操作或字段：' + op.type)
    }
    for (const scene of next.scenes) syncLegacy(scene)
    validateProject(next)
    update(() => { project = next }, true)
    return exclusive(async () => { await save(); return { revision: project.revision, localVersion, issues: [...diagnose(project), ...commandIssues(project)] } })
  })
  sdk.agent?.register({ name: 'novel_preview', description: '选中并预览一条演出指令。返回重建后的舞台和变量；不写入游玩进度。values 是可选测试变量值。', inputSchema: schema({ sceneId: id, commandId: id, values: { type: 'object' } }, ['sceneId', 'commandId']) }, args => {
    if (!project || mode !== 'edit' || held || operation) throw Error('请先打开作品编辑器')
    const scene = project.scenes.find(s => s.id === args.sceneId)
    if (!scene?.commands.some(c => c.id === args.commandId)) throw Error('场景或指令不存在')
    for (const [key, value] of Object.entries(args.values || {})) { const v = project.variables.find(v => v.id === key); if (!v || typeof value !== typeof v.initial || typeof value === 'number' && !Number.isFinite(value)) throw Error('测试变量无效') }
    view.sceneId = args.sceneId; view.commandId = args.commandId; view.testValues = args.values || {}; view.section = 'story'; render()
    return previewState(project, args.sceneId, args.commandId, view.testValues)
  })
  sdk.agent?.register({ name: 'novel_history', description: '撤销或重做一次手工或 Agent 编辑，需要当前作品与 localVersion。', inputSchema: schema({ projectId: id, localVersion: version, direction: { enum: ['undo', 'redo'] } }, ['projectId', 'localVersion', 'direction']) }, async args => {
    if (!project || args.projectId !== project.id || args.localVersion !== localVersion || !['undo', 'redo'].includes(args.direction) || mode !== 'edit' || held || operation) throw Error('请重新 novel_read 确认作品和版本')
    historyAction(args.direction); await save(); return { localVersion, revision: project.revision }
  })
  render()
}
