import { el, button, input, select, field, uid } from '../ui.js'
import { createAvatarRenderer, actorParameters } from './renderer.js'
import { defaults, roles, parameterLabels, DEFAULT_TRANSFORM, defaultWarpDeformer, inspectModel } from './document.js'
import { inspectionPoses, inspectionValues } from './poses.js'
import { resolveArtMesh } from './vendor/standrig/runtime.js'

export function modelStudio({ project, controller: c, assetUrl, request, notify, update }) {
  project = { ...project, models: (project.models || []).filter(m => m.engine !== 'mesh-avatar') }
  const root = el('section', 'rig-studio'), left = el('aside', 'rig-sidebar'), center = el('div', 'rig-center'), right = el('aside', 'rig-inspector')
  const canvas = el('canvas', 'rig-canvas'), status = el('span', 'rig-status'), toolbar = el('div', 'rig-toolbar')
  canvas.setAttribute('aria-label', '动态角色模型画布'); canvas.tabIndex = 0
  const viewport = el('div', 'rig-viewport', canvas), timeline = el('div', 'rig-timeline'), tabs = el('div', 'rig-tabs'), details = el('div')
  let disposed = false, frame, previous = performance.now(), loaded, loading, drag = null, values = {}, poll, polling = false
  const renderer = createAvatarRenderer(canvas, assetUrl), s = c.state
  const previewDisposers = new Set()
  const run = fn => async () => { try { await fn() } catch (e) { notify(e.message) } }
  const edit = ops => { try { c.edit(ops) } catch (e) { notify(e.message) } }
  const change = (value, action, type = 'text') => { const n = input(value, () => {}); n.type = type; if (type === 'number') n.step = 'any'; n.addEventListener('change', () => { try { action(type === 'number' ? Number(n.value) : n.value) } catch (e) { notify(e.message) } }); return n }
  const check = (value, fn) => { const n = el('input'); n.type = 'checkbox'; n.checked = !!value; n.addEventListener('change', () => fn(n.checked)); return n }
  const choose = (value, rows, fn, empty = '无') => select(value, [{ value: '', label: empty }, ...rows.map(x => ({ value: x.id, label: x.name || parameterLabels[x.id] || x.label || x.id }))], fn)
  const panel = (title, ...children) => el('section', 'rig-panel', el('h3', '', title), ...children)
  const part = () => c.model?.rig.parts.find(p => p.id === s.selectedPartId)
  const options = () => ({ fitPadding: 22, zoom: s.zoom, freezePhysics:!!s.poseId, selectedPartId: s.mode === 'mesh' ? s.selectedPartId : undefined, selectedArtMeshVertexIndex: s.mode === 'mesh' ? part()?.artMesh?.vertices.findIndex(v => v.id === s.selectedVertexId) ?? -1 : undefined, showBounds: s.mode === 'mesh' })
  const title = el('div', 'rig-heading', el('span', 'novel-eyebrow', 'CHARACTER / 角色工作室'), el('h2', '', '赋予角色生命'), el('p', '', '从一张立绘，到属于故事的每一次呼吸。'))
  const undo = button('撤销', run(() => c.history('undo')), 'novel-secondary'), redo = button('重做', run(() => c.history('redo')), 'novel-secondary')
  const save = button('保存模型', run(() => c.save()), 'novel-primary')
  toolbar.append(undo, redo, save, status, select(s.mode, [{ value: 'select', label: '预览 / 移动部件' }, { value: 'mesh', label: '网格 / 关键形' }], v => { s.mode = v; c.emit() }), button('还原参数', () => { if (!c.model) return; s.parameters = defaults(c.model); s.poseId = ''; s.expressionId = ''; s.motionId = ''; s.manual = true; s.playing = false; s.playhead = 0; renderer.reset(); c.emit() }, 'novel-secondary'))
  const zoom = input(s.zoom, v => { s.zoom = Number(v) }); zoom.type = 'range'; zoom.min = .4; zoom.max = 2.5; zoom.step = .05; zoom.value = s.zoom; zoom.setAttribute('aria-label', '画布缩放'); toolbar.append(zoom)
  center.append(toolbar, viewport, timeline)
  const tabRows=[['parts','部件'],['parameters','参数'],['expressions','表情'],['motions','动作'],['deformers','变形器'],['physics','物理'],['face','眼嘴素材'],['checks','姿态检查']]
  for (const [id, name] of tabRows) tabs.append(button(name, () => { s.tab = id; c.emit() }, 'novel-secondary'))
  right.append(tabs, details)
  root.append(title, left, center, right)

  function refreshLeft() {
    left.replaceChildren()
    left.append(panel('模型工程', choose(c.model?.id, project.models || [], id => { if (id) void run(() => c.open(id))() }, '打开一个模型'), button('＋ 空白模型', run(() => c.create('新角色模型')), 'novel-secondary')))
    if (c.model) {
      const m = c.model
      left.append(field('模型名称', change(m.name, name => edit([{ type: 'rename', name }]))))
      left.append(panel('用于剧情角色', choose('', project.cast, id => { if (id) update(p => { p.cast.find(x => x.id === id).modelId = m.id }, true) }, '选择并关联角色'), el('small', '', '已关联：' + (project.cast.filter(x => x.modelId === m.id).map(x => x.name).join('、') || '暂无'))))
      const source = el('details', 'rig-panel', el('summary', '', '立绘原图对照'))
      if (m.sourceAssetId) { const img = el('img', 'rig-source'); img.src = assetUrl(m.sourceAssetId); img.alt = '建模原图'; source.append(img) }
      left.append(source)
      const diag = c.snapshot().diagnostics
      left.append(panel('工程检查', el('small', '', `${diag.counts.parts} 个部件 · ${diag.counts.vertices} 顶点 · ${diag.counts.keyforms} 关键形`), ...diag.issues.map(x => el('p', 'rig-warning', x)), button('自动绑定语义部件', run(() => c.autoRig()), 'novel-secondary')))
    }
    generationPanel()
  }
  function generationPanel() {
    const draft = s.generationDraft ||= { source: c.model?.sourceAssetId || project.assets.find(a => a.kind === 'image')?.id || '', segmentation: '', repair: '', features:'', name: '我的动态角色' }
    if (!draft.touched && c.model?.sourceAssetId) draft.source = c.model.sourceAssetId
    let { source, segmentation, repair } = draft
    const images = project.assets.filter(a => a.kind === 'image'), name = input(draft.name, value => draft.name = value)
    const ai = panel('从单张立绘制作', el('p', 'rig-hint', 'AI 分区 → 脸部与眼嘴补画 → 拆层 → 局部形变绑定。先生成候选，检查后采用。'), field('原始立绘', choose(source, images, id => { draft.source = source = id; draft.touched = true })), field('角色名称', name))
    const more = el('details', '', el('summary', '', '复用或修正阶段图片'), field('已有分区图', choose(segmentation, images, id => draft.segmentation = segmentation = id)), field('已有脸部补画', choose(repair, images, id => draft.repair = repair = id)))
    more.append(field('已有闭眼 / 张嘴补画',choose(draft.features,images,id=>draft.features=id)))
    ai.append(more, button('✦ 开始 AI 制作', run(() => c.startGeneration({ sourceAssetId: source, name: name.value, segmentationAssetId: segmentation, repairAssetId: repair,featureAssetId:draft.features })), 'novel-primary'))
    const provider = el('details', '', el('summary', '', '图像服务设置')), form = el('div')
    provider.append(form); provider.addEventListener('toggle', () => { if (provider.open && !form.childNodes.length) void run(async () => {
      const config = await request('/api/novel/model-provider'), base = input(config.baseUrl, () => {}), model = input(config.model, () => {}), key = input('', () => {}, config.hasKey ? '已配置，留空保留' : '输入 API Key'); key.type = 'password'; key.autocomplete = 'new-password'
      form.append(field('服务地址', base), field('图像模型', model), field('API Key', key), button('保存服务配置', run(async () => { await request('/api/novel/model-provider', 'PUT', { baseUrl: base.value, model: model.value, apiKey: key.value }); key.value = ''; notify('图像服务已保存') }), 'novel-secondary'))
    })() })
    ai.append(provider); left.append(ai)
    const job = c.job; if (!job) return
    const progress = el('progress'); progress.max = 100; progress.value = job.percent
    const task = panel('制作任务 · ' + ({ running: '进行中', completed: '待检查', adopted: '已采用', failed: '失败', cancelled: '已取消', interrupted: '已中断', queued: '准备中' }[job.status] || job.status), progress, el('p', '', job.message), el('small', 'rig-warning', job.error || ''))
    if (['queued', 'running'].includes(job.status)) task.append(button('取消制作', run(() => c.jobAction('cancel')), 'novel-secondary'))
    if (['failed', 'cancelled', 'interrupted'].includes(job.status)) task.append(button('保留阶段并重试', run(() => c.jobAction('retry')), 'novel-secondary'))
    if (['completed','adopted'].includes(job.status)) task.append(button('预览候选模型', run(() => candidatePreview(job)), 'novel-secondary'))
    if (job.status === 'completed') task.append(button('采用候选模型', run(() => c.jobAction('adopt')), 'novel-primary'))
    for (const [id, label] of [[job.segmentationAssetId, '分区图'], [job.repairAssetId, '脸部补画'],[job.featureAssetId,'闭眼 / 张嘴补画']]) if (id) {
      const image = el('img', 'rig-stage-image'); image.src = jobImage(job, id); image.alt = label
      task.append(el('details', '', el('summary', '', label), image))
      if (id === job.segmentationAssetId) task.append(button('画笔修正分区', run(() => maskEditor(job)), 'novel-secondary'))
    }
    left.append(task)
  }
  const jobImage = (job, id) => '/api/novel/projects/' + project.id + '/model-jobs/' + job.id + '/images/' + id
  async function candidatePreview(job) {
    const model = await request('/api/novel/projects/' + project.id + '/model-jobs/' + job.id + '/candidate'); if (disposed) return
    const dialog = el('dialog', 'rig-mask-dialog'), preview = el('canvas', 'rig-candidate-canvas'), original = el('img', 'rig-candidate-original'), compare = el('div', 'rig-candidate-compare')
    original.src = assetUrl(job.sourceAssetId); original.alt = '原始立绘对照'; preview.setAttribute('aria-label', '候选模型实时预览')
    let poseId='live'
    const poseButtons=el('div','rig-pose-grid')
    for(const pose of [{id:'live',name:'动态待机'},...inspectionPoses])poseButtons.append(button(pose.name,()=>{poseId=pose.id;r.reset();for(const b of poseButtons.children)b.classList.toggle('active',b.textContent===pose.name)},'novel-secondary'))
    const diagnostics=inspectModel(model)
    compare.append(original, preview); dialog.append(el('h3', '', '候选检查 · 原图 / 动态模型'), button('关闭预览', () => dialog.close(), 'novel-secondary'),poseButtons,el('p','rig-hint','固定姿态冻结待机和物理，便于检查眼嘴对齐、破图和网格。'),...diagnostics.issues.map(x=>el('p','rig-warning',x)), compare)
    const r = createAvatarRenderer(preview, id => job.assets.some(a => a.id === id) ? jobImage(job, id) : assetUrl(id)); let raf, ended = false
    const cleanup = () => { if (ended) return; ended = true; window.cancelAnimationFrame(raf); r.dispose(); dialog.remove(); previewDisposers.delete(cleanup) }
    previewDisposers.add(cleanup); dialog.addEventListener('close', cleanup); root.append(dialog); dialog.showModal()
    try { await r.setModel(model); const draw = time => { if (ended) return; r.render(poseId==='live'?actorParameters(model, { idle: true, motionId: model.motions[0]?.id }, time):inspectionValues(model,poseId), { fitPadding: 12,freezePhysics:poseId!=='live' }); raf = window.requestAnimationFrame(draw) }; raf = window.requestAnimationFrame(draw) } catch (e) { cleanup(); throw e }
  }
  async function maskEditor(job) {
    const image = new Image(); image.src = jobImage(job, job.segmentationAssetId); await image.decode(); if (disposed) return
    const dialog = el('dialog', 'rig-mask-dialog'), painting = el('canvas'), tools = el('div', 'rig-toolbar'), context = painting.getContext('2d')
    painting.width = image.naturalWidth; painting.height = image.naturalHeight; context.drawImage(image, 0, 0)
    let color = '#ff0000', radius = 12, drawing = false
    const colors = [['#000000', '背景'], ['#ffff00', '后发'], ['#ff00ff', '身体'], ['#ff0000', '脸部'], ['#0000ff', '前发'], ['#00ffff', '左眼'], ['#ff8000', '右眼'], ['#8000ff', '左眉'], ['#0080ff', '右眉'], ['#804000', '嘴巴'], ['#ff8080', '饰品']]
    tools.append(select(color, colors.map(([value, label]) => ({ value, label })), v => color = v), field('画笔半径', change(radius, v => radius = Math.max(1, Math.min(100, v)), 'number')), button('保存并重新制作', run(async () => { const blob = await new Promise(resolve => painting.toBlob(resolve, 'image/png')); const asset = await c.uploadImage('手工修正分区.png', blob); let repairAssetId = ''; if (job.repairAssetId) { const response = await fetch(jobImage(job, job.repairAssetId)); if (!response.ok) throw Error('无法复用脸部补画'); repairAssetId = (await c.uploadImage('修正使用的脸部补画.png', await response.blob())).id } let featureAssetId = ''; if (job.featureAssetId) { const response = await fetch(jobImage(job, job.featureAssetId)); if (!response.ok) throw Error('无法复用眼嘴补画'); featureAssetId = (await c.uploadImage('修正使用的眼嘴补画.png', await response.blob())).id } await c.startGeneration({ sourceAssetId: job.sourceAssetId, name: job.name, segmentationAssetId: asset.id, repairAssetId, featureAssetId }); dialog.close(); dialog.remove() }), 'novel-primary'), button('关闭', () => { dialog.close(); dialog.remove() }, 'novel-secondary'))
    const paint = e => { if (!drawing) return; const r = painting.getBoundingClientRect(); context.fillStyle = color; context.beginPath(); context.arc((e.clientX - r.left) / r.width * painting.width, (e.clientY - r.top) / r.height * painting.height, radius, 0, Math.PI * 2); context.fill() }
    painting.addEventListener('pointerdown', e => { drawing = true; painting.setPointerCapture(e.pointerId); paint(e) }); painting.addEventListener('pointermove', paint); painting.addEventListener('pointerup', () => drawing = false); painting.addEventListener('pointercancel', () => drawing = false)
    dialog.append(tools, painting); root.append(dialog); dialog.showModal()
  }
  function refreshInspector() {
    details.replaceChildren(); const m = c.model; if (!m) return
    for (const [i, node] of [...tabs.children].entries()) node.classList.toggle('active', tabRows[i][0] === s.tab)
    if (s.tab==='checks') {
      details.append(el('p','rig-hint','逐个冻结姿态检查。自动检查网格翻折；素材对齐与表情自然度仍需看图。修改模型后，本轮检查记录清空。'))
      const grid=el('div','rig-pose-grid')
      for(const pose of inspectionPoses){const review=s.poseReviews?.[pose.id];grid.append(button((review?.verdict==='pass'?'✓ ':review?.verdict==='repair'?'! ':'')+pose.name,()=>{renderer.reset();c.checkPose(pose.id)},'novel-secondary'+(s.poseId===pose.id?' active':'')))}
      details.append(grid)
      if(s.poseId){const note=change(s.poseReviews?.[s.poseId]?.note||'',()=>{});note.placeholder='例如：右眼边缘需要补画';details.append(panel('当前姿态 · '+inspectionPoses.find(p=>p.id===s.poseId)?.name,field('返修备注',note),button('✓ 视觉检查通过',()=>c.checkPose(s.poseId,'pass',note.value),'novel-secondary'),button('标记待返修',()=>c.checkPose(s.poseId,'repair',note.value),'novel-secondary')))}
      for(const f of c.snapshot().diagnostics.findings)details.append(panel('待检查',el('p','rig-warning',f.message),button('定位部件与姿态',()=>{s.selectedPartId=f.partId;if(f.poseId)c.checkPose(f.poseId);s.tab='parts';s.mode='mesh';c.emit()},'novel-secondary')))
    }
    if(s.tab==='face'){
      details.append(el('p','rig-hint','自动制作会补画闭眼与张嘴。也可选择作品中的透明素材或导入图片；素材应与对应眼嘴同尺寸、同中心。添加后可在部件面板微调。'))
      for(const [baseRole,role,name] of [['eye-left','eye-left-closed','左眼闭眼'],['eye-right','eye-right-closed','右眼闭眼'],['mouth','mouth-open','张嘴素材']]){
        const existing=m.rig.parts.find(p=>p.role===role),base=m.rig.parts.find(p=>p.role===baseRole)
        const attach=async asset=>{const image=new Image();image.src=assetUrl(asset.id);await image.decode();c.edit([{type:'add_image',asset:{...asset,width:image.naturalWidth,height:image.naturalHeight},role,x:base?.transform.x,y:base?.transform.y}]);c.autoRig();notify('已添加素材，可在部件面板调整位置与缩放')}
        const box=panel(name,el('small','',existing?'已有素材：'+existing.name:'尚未配置，自动绑定使用兼容形变'))
        if(existing)box.append(button('选中素材部件',()=>{s.selectedPartId=existing.id;s.tab='parts';c.emit()},'novel-secondary'))
        else{const file=el('input');file.type='file';file.accept='image/png';file.setAttribute('aria-label','导入'+name);file.addEventListener('change',()=>{const f=file.files?.[0];if(f)void run(async()=>attach(await c.uploadImage(f.name,f)))()});box.append(field('选择已有素材',choose('',project.assets.filter(a=>a.kind==='image'),id=>{if(id)void run(()=>attach(project.assets.find(a=>a.id===id)))()})),field('导入图片',file))}
        details.append(box)
      }
    }
    if (s.tab === 'parts') {
      const tree = el('div', 'rig-parts')
      for (const p of [...m.rig.parts].sort((a, b) => b.drawOrder - a.drawOrder)) {
        const row = el('div', 'rig-part-row' + (p.id === s.selectedPartId ? ' selected' : ''))
        row.append(check(p.visible, visible => edit([{ type: 'set_part', id: p.id, patch: { visible } }])), button(p.name, () => { s.selectedPartId = p.id; c.emit() }, 'novel-icon'), button(p.locked ? '锁定' : '锁', () => edit([{ type: 'set_part', id: p.id, patch: { locked: !p.locked } }]), 'novel-icon')); tree.append(row)
      }
      details.append(tree, field('添加图片部件', choose('', project.assets.filter(a => a.kind === 'image'), id => void run(async () => { if (!id) return; const a = project.assets.find(x => x.id === id), image = new Image(); image.src = assetUrl(id); await image.decode(); c.edit([{ type: 'add_image', asset: { ...a, width: image.naturalWidth, height: image.naturalHeight }, role: 'unknown' }]) })())))
      const p = part(); if (!p) return
      const props = panel('部件属性', field('名称', change(p.name, name => edit([{ type: 'set_part', id: p.id, patch: { name } }]))), field('语义分区', select(p.role || 'unknown', roles.map(([value, label]) => ({ value, label })), role => edit([{ type: 'set_part', id: p.id, patch: { role } }]))), field('父部件', choose(p.parentId, m.rig.parts.filter(x => x.id !== p.id), parentId => edit([{ type: 'set_part', id: p.id, patch: { parentId: parentId || null } }]))), field('变形器', choose(p.deformerId, m.rig.deformers, deformerId => edit([{ type: 'set_part', id: p.id, patch: { deformerId: deformerId || null } }]))), field('绘制顺序', change(p.drawOrder, drawOrder => edit([{ type: 'set_part', id: p.id, patch: { drawOrder } }]), 'number')))
      for (const [key, label] of [['x', '位置 X'], ['y', '位置 Y'], ['rotation', '旋转'], ['scaleX', '缩放 X'], ['scaleY', '缩放 Y'], ['pivotX', '锚点 X'], ['pivotY', '锚点 Y'], ['opacity', '透明度']]) props.append(field(label, change(p.transform[key], v => edit([{ type: 'transform', id: p.id, patch: { [key]: v } }]), 'number')))
      props.append(field('透明遮罩', choose(p.clip?.maskPartId, m.rig.parts.filter(x => x.id !== p.id), id => edit([{ type: 'set_part', id: p.id, patch: { clip: id ? { mode: 'alpha', maskPartId: id } : null } }]))), button('重建网格 6 × 6', () => edit([{ type: 'generate_mesh', id: p.id }]), 'novel-secondary'), button('镜像网格', () => edit([{ type: 'mirror_mesh', id: p.id }]), 'novel-secondary'), button('删除选中顶点', () => edit([{ type: 'remove_vertex', id: p.id, vertexId: s.selectedVertexId }]), 'novel-secondary'), button('删除部件', () => { if (confirm('删除此部件？可以撤销。')) edit([{ type: 'remove_part', id: p.id }]) }, 'novel-text-danger'))
      const bindings = panel('参数驱动部件变换')
      let parameter = 'ParamAngleX', property = 'rotation'
      const lo = change(-5, () => {}, 'number'), hi = change(5, () => {}, 'number')
      bindings.append(choose(parameter, m.rig.parameters, id => parameter = id), select(property, Object.keys(DEFAULT_TRANSFORM).map(value => ({ value, label: value })), value => property = value), field('参数最小值时的增量', lo), field('参数最大值时的增量', hi), button('添加 / 更新绑定', () => { const def = m.rig.parameters.find(x => x.id === parameter); if (def) edit([{ type: 'bind_transform', id: p.id, binding: { parameter, property, keys: [{ input: def.min, value: Number(lo.value) }, { input: def.default, value: 0 }, { input: def.max, value: Number(hi.value) }].filter((k, i, list) => i === 0 || k.input !== list[i-1].input) } }]) }, 'novel-secondary'))
      for (const b of p.bindings || []) bindings.append(el('div', 'rig-key-row', el('small', '', (parameterLabels[b.parameter] || b.parameter) + ' → ' + b.property), button('×', () => edit([{ type: 'remove_binding', id: p.id, parameter: b.parameter, property: b.property }]), 'novel-icon')))
      details.append(props, keyformPanel(m, p), bindings)
    }
    if (s.tab === 'parameters') {
      details.append(el('p', 'rig-hint', '滑杆只改变预览。关闭待机和动作后可精确编辑关键形。'), field('自动呼吸与眨眼', check(s.idle, v => { s.idle = v; c.emit() })))
      for (const p of m.rig.parameters) { const range = input(s.parameters[p.id] ?? p.default, v => { if (!s.manual) s.parameters = { ...defaults(m), ...values }; s.parameters[p.id] = Number(v); s.poseId = ''; s.manual = true; s.expressionId = ''; s.idle = false; s.playing = false; output.textContent = Number(v).toFixed(2) }); range.type = 'range'; range.min = p.min; range.max = p.max; range.step = p.step || .01; range.value = s.parameters[p.id] ?? p.default; range.setAttribute('aria-label', parameterLabels[p.id] || p.label); range.addEventListener('change', () => c.emit()); const output = el('output', '', Number(range.value).toFixed(2)); details.append(el('div', 'rig-parameter', field(parameterLabels[p.id] || p.label, range), output)) }
      const add = button('＋ 参数', () => { const id = 'ParamCustom' + m.rig.parameters.length; edit([{ type: 'upsert_parameter', value: { id, label: '自定义参数', min: -1, max: 1, default: 0, step: .01 } }]) }, 'novel-secondary'); details.append(add)
      for (const p of m.rig.parameters.filter(p => p.id.startsWith('ParamCustom'))) details.append(el('details', 'rig-panel', el('summary', '', p.id), ...['label', 'min', 'max', 'default'].map(key => field(key, change(p[key], value => edit([{ type: 'upsert_parameter', value: { ...p, [key]: value } }]), key === 'label' ? 'text' : 'number')))))
    }
    if (s.tab === 'expressions') {
      details.append(button('将当前参数保存为表情', () => edit([{ type: 'upsert_expression', value: { id: uid(), name: '新表情', values: { ...defaults(m), ...values } } }]), 'novel-primary'))
      for (const e of m.expressions) details.append(panel(e.name, field('名称', change(e.name, name => edit([{ type: 'upsert_expression', value: { ...e, name } }]))), button('预览', () => { s.parameters = defaults(m); s.motionId = ''; s.manual = false; s.expressionId = e.id; c.emit() }, 'novel-secondary'), button('用当前参数覆盖', () => edit([{ type: 'upsert_expression', value: { ...e, values: { ...defaults(m), ...values } } }]), 'novel-secondary'), button('删除', () => edit([{ type: 'remove_expression', id: e.id }]), 'novel-text-danger')))
    }
    if (s.tab === 'motions') motionInspector(m)
    if (s.tab === 'deformers') {
      for (const kind of ['rotate', 'warp']) details.append(button('＋ ' + (kind === 'rotate' ? '旋转变形器' : '曲面变形器'), () => edit([{ type: 'upsert_deformer', value: { id: uid(), name: kind === 'rotate' ? '旋转变形器' : '曲面变形器', kind, parentId: null, origin: { x: m.rig.stage.width / 2, y: m.rig.stage.height / 2 }, transform: { ...DEFAULT_TRANSFORM, pivotX: 0, pivotY: 0 }, bindings: [], ...(kind === 'warp' ? { warp: defaultWarpDeformer() } : {}) } }]), 'novel-secondary'))
      for (const d of m.rig.deformers) {
        const changeD = patch => edit([{ type: 'upsert_deformer', value: { ...d, ...patch } }])
        const box = panel(d.name, field('名称', change(d.name, name => changeD({ name }))), field('父变形器', choose(d.parentId, m.rig.deformers.filter(x => x.id !== d.id), parentId => changeD({ parentId: parentId || null }))))
        for (const key of ['x', 'y']) box.append(field('旋转中心 ' + key.toUpperCase(), change(d.origin?.[key] || 0, v => changeD({ origin: { ...d.origin, [key]: v } }), 'number')))
        for (const key of ['x', 'y', 'rotation', 'scaleX', 'scaleY']) box.append(field(key, change(d.transform[key], v => changeD({ transform: { ...d.transform, [key]: v } }), 'number')))
        if (d.warp) for (const key of ['bendX', 'bendY', 'taperX', 'taperY']) box.append(field(key, change(d.warp[key] || 0, v => changeD({ warp: { ...d.warp, [key]: v } }), 'number')))
        box.append(button('删除变形器', () => edit([{ type: 'remove_deformer', id: d.id }]), 'novel-text-danger')); details.append(box)
      }
    }
    if (s.tab === 'physics') {
      details.append(button('＋ 物理链', () => { if (!part()) return; edit([{ type: 'upsert_physics', value: { id: uid(), name: '新物理链', enabled: true, targetPartIds: [part().id], sourceParameters: [{ parameter: 'ParamAngleX', scale: .2 }], stiffness: 24, damping: 5, mass: 1, gravity: 0, wind: .1, output: { property: 'rotation', scale: .5 } } }]) }, 'novel-secondary'))
      for (const chain of m.rig.physics.chains) {
        const changeP = patch => edit([{ type: 'upsert_physics', value: { ...chain, ...patch } }])
        const box = panel(chain.name, field('启用', check(chain.enabled, enabled => changeP({ enabled }))), field('目标部件', choose(chain.targetPartIds[0], m.rig.parts, id => changeP({ targetPartIds: id ? [id] : [] }))), field('输入参数', choose(chain.sourceParameters[0]?.parameter, m.rig.parameters, id => changeP({ sourceParameters: id ? [{ parameter: id, scale: .2 }] : [] }))))
        for (const [key, label] of [['stiffness', '弹性'], ['damping', '阻尼'], ['mass', '质量'], ['gravity', '重力'], ['wind', '风力']]) box.append(field(label, change(chain[key], v => changeP({ [key]: v }), 'number')))
        box.append(field('输出方式',select(chain.parameterOutput?'parameter':'rotation',[{value:'parameter',label:'参数 → 局部网格'},{value:'rotation',label:'部件整体旋转'}],mode=>changeP({parameterOutput:mode==='parameter'?{parameter:'ParamHairFront',scale:1,min:-1,max:1}:null,output:{property:'rotation',scale:mode==='parameter'?0:.5}}))))
        if(chain.parameterOutput)box.append(field('输出参数',choose(chain.parameterOutput.parameter,m.rig.parameters,id=>{const p=m.rig.parameters.find(p=>p.id===id);if(p)changeP({parameterOutput:{...chain.parameterOutput,parameter:id,min:p.min,max:p.max}})})),el('small','','参数输出驱动所有绑定该参数的网格，发根固定，发梢跟随。'))
        box.append(field('输出幅度', change(chain.parameterOutput?.scale??chain.output.scale, scale => changeP(chain.parameterOutput?{parameterOutput:{...chain.parameterOutput,scale}}:{ output: { ...chain.output, scale } }), 'number')), button('删除物理链', () => edit([{ type: 'remove_physics', id: chain.id }]), 'novel-text-danger')); details.append(box)
      }
    }
  }
  function keyformPanel(m, p) {
    const box = panel('参数关键形', field('编辑关键形', check(s.keyEdit, value => { s.keyEdit = value; s.idle = false; s.playing = false; s.expressionId = ''; s.motionId = ''; s.manual = true; c.emit() })), el('p', 'rig-hint', '设置参数位置后拖动网格顶点，记录这个姿态。关闭关键形编辑会直接修改基础网格。双击画布添加顶点。'))
    for (let i = 0; i < 2; i++) box.append(field(i ? '第二维（可选）' : '第一维', choose(s.keyParameters[i], m.rig.parameters, id => { s.keyParameters[i] = id; c.emit() })))
    box.append(button('记录当前姿态', () => recordKey(p), 'novel-secondary'))
    for (const b of [...p.artMesh?.bindings || [], ...p.artMesh?.multiBindings || []]) {
      const ids = b.parameters || [b.parameter], list = el('details', '', el('summary', '', ids.map(id => parameterLabels[id] || id).join(' × ') + ' · ' + (b.keys || b.keyforms).length + ' 个关键形'))
      for (const k of b.keys || b.keyforms) list.append(el('div', 'rig-key-row', button(ids.map(id => b.parameters ? k.inputs[id] : k.input).join(' / '), () => { s.keyParameters = ids; s.keyEdit = true; c.preview(b.parameters ? k.inputs : { [b.parameter]: k.input }) }, 'novel-secondary'), button('×', () => edit([{ type: 'remove_keyform', id: p.id, parameters: ids, input: k.input, inputs: k.inputs }]), 'novel-icon')))
      box.append(list)
    }
    return box
  }
  function recordKey(p, moved) {
    const ids = s.keyParameters.filter(Boolean), runtime = renderer.runtime; if (!runtime || !p.artMesh || !ids.length) return
    const offsets = p.artMesh.vertices.map(v => ({ vertexId: v.id, x: 0, y: 0 }))
    // Preserve the selected binding's offsets; other bindings stay additive.
    const bindings = ids.length > 1 ? p.artMesh.multiBindings || [] : p.artMesh.bindings || []
    const binding = bindings.find(b => ids.length > 1 ? JSON.stringify(b.parameters) === JSON.stringify(ids) : b.parameter === ids[0])
    const keys = binding?.keys || binding?.keyforms || []
    if (binding) {
      const isolated = structuredClone(p), asset = c.model.rig.assets.find(a => a.id === p.assetId)
      isolated.artMesh.bindings = ids.length === 1 ? [binding] : []; isolated.artMesh.multiBindings = ids.length > 1 ? [binding] : []
      const mesh = resolveArtMesh(isolated, asset.width, asset.height, s.parameters)
      for (const o of offsets) { const base = p.artMesh.vertices.find(v => v.id === o.vertexId), at = mesh.vertices.find(v => v.id === o.vertexId); o.x = at.x - base.x; o.y = at.y - base.y }
    }
    if (moved) { const o = offsets.find(v => v.vertexId === moved.id); o.x += moved.dx; o.y += moved.dy }
    edit([{ type: 'set_keyform', id: p.id, parameters: ids, input: s.parameters[ids[0]], inputs: Object.fromEntries(ids.map(id => [id, s.parameters[id]])), offsets }])
  }
  function motionInspector(m) {
    details.append(button('＋ 新动作', () => { const id = uid(); s.motionId = id; edit([{ type: 'upsert_motion', value: { id, name: '新动作', duration: 3000, loop: true, tracks: [] } }]) }, 'novel-primary'))
    for (const motion of m.motions) {
      const box = panel(motion.name, field('名称', change(motion.name, name => edit([{ type: 'upsert_motion', value: { ...motion, name } }]))), field('时长 ms', change(motion.duration, duration => edit([{ type: 'upsert_motion', value: { ...motion, duration } }]), 'number')), field('循环', check(motion.loop, loop => edit([{ type: 'upsert_motion', value: { ...motion, loop } }]))), button('选择动作', () => { s.motionId = motion.id; s.expressionId = ''; s.manual = false; s.playhead = 0; s.parameters = defaults(m); c.emit() }, 'novel-secondary'))
      if (s.motionId === motion.id) {
        box.append(button('在当前位置记录参数', () => { const next = structuredClone(motion), at = Math.round(s.playhead / motion.duration * 10000) / 10000, pose = s.manual ? s.parameters : { ...defaults(m), ...values }; for (const p of m.rig.parameters) { let t = next.tracks.find(x => x.parameter === p.id); if (!t) { t = { parameter: p.id, keys: [] }; next.tracks.push(t) } const old = t.keys.find(k => k.at === at); if (old) old.value = pose[p.id]; else t.keys.push({ at, value: pose[p.id], easing: 'smooth' }); t.keys.sort((a, b) => a.at - b.at) } edit([{ type: 'upsert_motion', value: next }]) }, 'novel-secondary'))
        for (const t of motion.tracks) {
          const track = el('details', 'rig-track', el('summary', '', (parameterLabels[t.parameter] || t.parameter) + ' · ' + t.keys.length + ' 关键帧'))
          const changeKey = (i, patch) => { const next = structuredClone(motion), row = next.tracks.find(x => x.parameter === t.parameter); Object.assign(row.keys[i], patch); row.keys.sort((a, b) => a.at - b.at); edit([{ type: 'upsert_motion', value: next }]) }
          for (const [i, k] of t.keys.entries()) track.append(el('div', 'rig-key-row', change(Math.round(k.at * motion.duration), v => changeKey(i, { at: v / motion.duration }), 'number'), change(k.value, value => changeKey(i, { value }), 'number'), select(k.easing || 'linear', ['linear', 'smooth', 'hold'].map(value => ({ value, label: { linear: '线性', smooth: '平滑', hold: '保持' }[value] })), easing => changeKey(i, { easing })), button('×', () => { const next = structuredClone(motion), row = next.tracks.find(x => x.parameter === t.parameter); row.keys.splice(i, 1); next.tracks = next.tracks.filter(x => x.keys.length); edit([{ type: 'upsert_motion', value: next }]) }, 'novel-icon')))
          box.append(track)
        }
      }
      box.append(button('删除动作', () => edit([{ type: 'remove_motion', id: motion.id }]), 'novel-text-danger')); details.append(box)
    }
  }
  let scrub, clock
  function refreshTimeline() {
    timeline.replaceChildren(); const m = c.model; if (!m) return
    const motion = m.motions.find(x => x.id === s.motionId)
    scrub = input(s.playhead, v => { s.playhead = Number(v); s.playing = false; s.manual = false }); scrub.type = 'range'; scrub.min = 0; scrub.max = motion?.duration || 3000; scrub.step = 10; scrub.value = s.playhead; scrub.setAttribute('aria-label', '动作时间轴')
    clock = el('output', '', '0.00 s')
    timeline.append(button(s.playing ? '暂停' : '▶ 播放', () => { s.playing = !s.playing; s.manual = false; s.poseId = ''; c.emit() }, 'novel-accent'), choose(s.motionId, m.motions, id => { s.motionId = id; s.expressionId = ''; s.manual = false; s.playhead = 0; c.emit() }, '无动作'), scrub, clock, field('待机', check(s.idle, v => { s.idle = v; s.manual = false; s.poseId = ''; c.emit() })))
  }
  function refresh() {
    if (disposed || drag) return
    undo.disabled = !c.snapshot().canUndo || !!c.saving; redo.disabled = !c.snapshot().canRedo || !!c.saving; save.disabled = !!c.saving
    status.textContent = c.saving ? '正在保存…' : c.dirty ? '未保存 · 自动备份中' : c.model ? '已保存 · v' + c.model.revision : '打开或制作一个模型'
    if (c.model && loaded !== c.model) { loaded = c.model; loading = renderer.setModel(c.model); void loading.catch(e => notify(e.message)) }
    refreshLeft(); refreshInspector(); refreshTimeline()
  }
  function tick(now) {
    if (disposed) return; const dt = Math.min(80, now - previous); previous = now
    const m = c.model
    if (m) { const motion = m.motions.find(x => x.id === s.motionId); if (s.playing && motion) { s.playhead += dt; if (s.playhead > motion.duration) { if (motion.loop) s.playhead %= motion.duration; else { s.playhead = motion.duration; s.playing = false } } }
      const manual = Object.fromEntries(Object.entries(s.parameters).filter(([id, value]) => !s.idle || value !== defaults(m)[id]))
      values = actorParameters(m, { idle: s.idle, expressionId: s.expressionId, motionId: s.motionId, parameters: s.manual ? manual : s.expressionId || s.motionId ? {} : manual }, s.motionId ? s.playhead : now)
      renderer.render(values, options()); if (scrub) scrub.value = s.playhead; if (clock) clock.textContent = (s.playhead / 1000).toFixed(2) + ' s'
    }
    frame = window.requestAnimationFrame(tick)
  }
  canvas.addEventListener('pointerdown', e => {
    const p = part(), runtime = renderer.runtime; if (!p || p.locked || !runtime || c.saving) return
    const handle = s.mode === 'mesh' ? runtime.hitTestArtMeshVertex(canvas, values, p.id, e.clientX, e.clientY, options()) : null
    if (s.mode === 'mesh' && !handle) return
    const point = s.mode === 'mesh' ? runtime.clientPointToPartLocal(canvas, values, p.id, e.clientX, e.clientY, options()) : runtime.clientPointToParentSpace(canvas, values, p.id, e.clientX, e.clientY, options()); if (!point) return
    runtime.rig = structuredClone(c.model.rig)
    drag = { p: structuredClone(p), handle, point, x: e.clientX, y: e.clientY }; s.selectedVertexId = handle?.vertexId || ''; s.idle = false; s.playing = false
    canvas.setPointerCapture(e.pointerId); e.preventDefault()
  })
  canvas.addEventListener('pointermove', e => { if (!drag) return; const runtime = renderer.runtime, point = drag.handle ? runtime.clientPointToPartLocal(canvas, values, drag.p.id, e.clientX, e.clientY, options()) : runtime.clientPointToParentSpace(canvas, values, drag.p.id, e.clientX, e.clientY, options()); if (!point) return; drag.dx = point.x - drag.point.x; drag.dy = point.y - drag.point.y; const target = runtime.rig.parts.find(p => p.id === drag.p.id); if (drag.handle) { const vertex = target.artMesh.vertices.find(v => v.id === drag.handle.vertexId), old = drag.p.artMesh.vertices.find(v => v.id === drag.handle.vertexId); vertex.x = old.x + drag.dx; vertex.y = old.y + drag.dy } else { target.transform.x = drag.p.transform.x + drag.dx; target.transform.y = drag.p.transform.y + drag.dy } })
  const finish = () => { if (!drag) return; const d = drag; drag = null; renderer.runtime.rig = structuredClone(c.model.rig); if (!d.dx && !d.dy) return refresh(); if (d.handle) { if (s.keyEdit) recordKey(d.p, { id: d.handle.vertexId, dx: d.dx || 0, dy: d.dy || 0 }); else { const v = d.p.artMesh.vertices.find(x => x.id === d.handle.vertexId); edit([{ type: 'move_vertex', id: d.p.id, vertexId: v.id, x: v.x + (d.dx || 0), y: v.y + (d.dy || 0) }]) } } else edit([{ type: 'transform', id: d.p.id, patch: { x: d.p.transform.x + (d.dx || 0), y: d.p.transform.y + (d.dy || 0) } }]); refresh() }
  canvas.addEventListener('pointerup', finish); canvas.addEventListener('pointercancel', () => { drag = null; if (renderer.runtime && c.model) renderer.runtime.rig = structuredClone(c.model.rig); refresh() })
  canvas.addEventListener('dblclick', e => { const p = part(), runtime = renderer.runtime; if (s.mode !== 'mesh' || !p?.artMesh || !runtime) return; const point = runtime.clientPointToPartLocal(canvas, values, p.id, e.clientX, e.clientY, options()), a = c.model.rig.assets.find(a => a.id === p.assetId); if (point) { const x = point.x + p.transform.pivotX * a.width, y = point.y + p.transform.pivotY * a.height; edit([{ type: 'add_vertex', id: p.id, value: { id: uid(), x, y, u: Math.max(0, Math.min(1, x / a.width)), v: Math.max(0, Math.min(1, y / a.height)) } }]) } })
  const unsubscribe = c.subscribe(refresh); refresh(); frame = window.requestAnimationFrame(tick)
  poll = setInterval(() => { if (!polling && ['running', 'queued'].includes(c.job?.status)) { polling = true; void c.jobAction('status').catch(e => notify(e.message)).finally(() => polling = false) } }, 2000)
  void c.restoreJob().catch(e => notify(e.message))
  return { root, dispose() { disposed = true; clearInterval(poll); window.cancelAnimationFrame(frame); unsubscribe(); renderer.dispose(); for (const cleanup of previewDisposers) cleanup(); for (const d of root.querySelectorAll('dialog')) { d.close(); d.remove() } } }
}
