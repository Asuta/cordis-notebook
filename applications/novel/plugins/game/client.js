import { validateProject, diagnose } from './model.js'
import { renderEditor } from './editor.js'
import { createPlayer } from './player.js'
import { exportPackage, importPackage } from './package.js'
import { el, button, input } from './ui.js'

const projectPath = id => '/api/novel/projects/' + encodeURIComponent(id)
const toBase64 = bytes => { let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(binary) }

export default async function (ctx, sdk) {
  const root = el('main', 'novel-app'), notice = el('div', 'novel-toast'); sdk.mount('app', root)
  let projects = await sdk.request('/api/novel/projects'), project = null, mode = 'library', player = null
  let timer, pending = null, operation = null, dirty = false, stopped = false, held = false, localVersion = 0, status = '已保存'
  const view = { section: 'story', sceneId: '' }
  const assetUrl = (id, projectId = project?.id) => projectPath(projectId) + '/assets/' + encodeURIComponent(id)
  function toast(message) { notice.textContent = message; notice.classList.add('visible'); setTimeout(() => notice.classList.remove('visible'), 5000) }
  const draftKey = () => 'draft-' + project?.id
  function remember() { try { if (project) sdk.storage.local.setItem(draftKey(), JSON.stringify(project)) } catch { toast('浏览器草稿备份失败，请立即保存') } }
  function changed() {
    localVersion++; dirty = true; status = '正在保存…'; remember(); clearTimeout(timer)
    timer = setTimeout(() => save().catch(error => { status = '保存失败'; toast(error.message); updateStatus() }), 600)
    updateStatus()
  }
  function updateStatus() { const node = root.querySelector('.novel-save-status'); if (node) node.textContent = status }
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
    fn(project)
    if (mark) changed()
    if (rerender) render()
  }
  async function exclusive(action) {
    if (held || operation || stopped) throw Error('正在保存或切换作品，请稍后再试')
    root.inert = true
    operation = Promise.resolve().then(action)
    try { return await operation } finally { operation = null; root.inert = held }
  }
  async function refresh() { projects = await sdk.request('/api/novel/projects') }
  async function load(id, destination = 'edit') {
      await save(); project = await sdk.request(projectPath(id)); dirty = false; localVersion = 0
      try {
        const draft = JSON.parse(sdk.storage.local.getItem(draftKey()))
        if (draft?.revision === project.revision) { project = validateProject(draft); dirty = true; status = '已恢复本机草稿'; changed() }
        else if (draft) toast('发现旧草稿，作品已在别处更新；旧草稿已保留在浏览器中')
      } catch { toast('浏览器草稿读取失败') }
      if (!dirty) status = '已保存'
      view.sceneId = project.startSceneId; view.section = 'story'; mode = destination; render()
  }
  const open = (id, destination) => exclusive(() => load(id, destination))
  const createProject = title => exclusive(async () => { await save(); const p = await sdk.request('/api/novel/projects', 'POST', { title }); await refresh(); await load(p.id); return { project: structuredClone(project), localVersion } })
  async function library() { try { await exclusive(async () => { await save(); player?.dispose(); player = null; project = null; mode = 'library'; await refresh(); render() }) } catch (error) { toast(error.message) } }
  async function play(sceneId) { try { await exclusive(async () => { await save(); mode = 'play'; player?.dispose(); player = null; render(sceneId) }) } catch (error) { toast(error.message) } }
  async function uploadAsset(file) {
    if (!file || file.size > 8 * 1024 * 1024) return toast('单个素材不能超过 8 MB')
    const mime = file.type === 'audio/x-wav' || file.type === 'audio/wave' ? 'audio/wav' : file.type
    try {
      await exclusive(async () => {
      await save()
      const bytes = new Uint8Array(await file.arrayBuffer())
      project = await sdk.request(projectPath(project.id) + '/assets', 'POST', { name: file.name, mime, base64: toBase64(bytes) })
      status = '已保存'; render(); toast('已添加素材：' + file.name)
      })
    } catch (error) { toast(error.message) }
  }
  async function download(p = project) { try { await exclusive(async () => { if (p === project) await save(); await exportPackage(structuredClone(p)); toast('作品包已下载') }) } catch (error) { toast(error.message) } }
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
  function render(sceneId) {
    player?.dispose(); player = null
    root.replaceChildren()
    if (mode === 'library') root.append(renderLibrary())
    else if (mode === 'play') {
      player = createPlayer(project, sdk, { startSceneId: sceneId, onExit: () => { mode = 'edit'; render() }, assetUrl })
      root.append(player.root)
    } else {
      const header = el('header', 'novel-app-header', button('← 作品库', library, 'novel-back'), el('div', 'novel-header-title', el('span', 'novel-eyebrow', 'VISUAL NOVEL EDITOR'), el('strong', '', project.title)), el('span', 'novel-save-status', status), button('▶ 试玩', () => play(project.startSceneId), 'novel-accent'), button('↓ 导出作品包', () => download(), 'novel-secondary'))
      root.append(header, renderEditor({ project, view, update, openScene: id => { view.sceneId = id; view.section = 'story'; render() }, play, uploadAsset, assetUrl }))
    }
    root.append(notice)
  }
  ctx.effect(() => () => { stopped = true; clearTimeout(timer); player?.dispose() })
  sdk.listen(window, 'beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = '' } })
  ctx.on('plugins/before-stop', async request => { held = true; root.inert = true; request.hold(() => { held = false; root.inert = !!operation }); if (operation) await operation; await save() })
  ctx.on('plugins/remote-stop', () => { if (dirty) remember() })
  const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
  const id = { type: 'string' }, version = { type: 'integer' }
  sdk.agent?.register({ name: 'novel_read', description: '读取当前视觉小说作品及本机未保存编辑、作品列表、剧情检查结果和 localVersion。编辑前先读取；若未打开作品，先 novel_open。', inputSchema: schema({}) }, () => ({ projects, project: project && structuredClone(project), localVersion, issues: project ? diagnose(project) : [] }))
  sdk.agent?.register({ name: 'novel_open', description: '在当前页面打开一部作品，返回其完整剧情。切换前保存当前编辑。', inputSchema: schema({ id }, ['id']) }, async args => { await open(args.id); return { project, localVersion } })
  sdk.agent?.register({ name: 'novel_create', description: '创建并打开一部空白视觉小说。', inputSchema: schema({ title: id }, ['title']) }, args => createProject(args.title))
  sdk.agent?.register({ name: 'novel_edit', description: '修改当前作品的剧情、角色或变量，使用 novel_read 的 project.id 和 localVersion 避免覆盖用户编辑。operations 可用 set_project{patch:{title?,description?,startSceneId?}}、upsert_scene{value:完整场景}、remove_scene{id}、upsert_character{value:完整角色}、remove_character{id}、upsert_variable{value:完整变量}、remove_variable{id}。素材通过页面上传；修改后自动保存并重新检查分支。', inputSchema: schema({ projectId: id, localVersion: version, operations: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object' } } }, ['projectId', 'localVersion', 'operations']) }, async args => {
    if (!project || mode === 'play' || held || operation || stopped || args.projectId !== project.id || args.localVersion !== localVersion) throw Error('请在编辑器中重新 novel_read，确认当前作品和版本')
    if (!Array.isArray(args.operations) || !args.operations.length || args.operations.length > 50) throw Error('请提供 1–50 个剧情编辑操作')
    const next = structuredClone(project)
    for (const op of args.operations) {
      if (!op || typeof op !== 'object') throw Error('剧情编辑操作无效')
      if (op.type === 'set_project' && op.patch && Object.keys(op.patch).every(k => ['title','description','startSceneId'].includes(k))) Object.assign(next, op.patch)
      else if (['scene','character','variable'].some(k => op.type === 'upsert_' + k) && op.value) {
        const list = op.type === 'upsert_scene' ? next.scenes : op.type === 'upsert_character' ? next.cast : next.variables
        const at = list.findIndex(x => x.id === op.value.id); if (at < 0) list.push(op.value); else list[at] = op.value
      } else if (['remove_scene','remove_character','remove_variable'].includes(op.type)) {
        const list = op.type === 'remove_scene' ? 'scenes' : op.type === 'remove_character' ? 'cast' : 'variables'
        next[list] = next[list].filter(x => x.id !== op.id)
      } else throw Error('未知操作或字段：' + op.type)
    }
    validateProject(next)
    update(() => { project = next }, true)
    return exclusive(async () => { await save(); return { revision: project.revision, localVersion, issues: diagnose(project) } })
  })
  render()
}
