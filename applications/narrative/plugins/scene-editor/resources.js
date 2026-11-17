export const RESOURCE_MIME = 'application/x-narrative-resource'
const el = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls || ''; if (text !== undefined) n.textContent = text; return n }

export function resourceReferences(engine, scene, resource) {
  const rows = []
  for (const s of scene.document.scenes) for (const o of scene.expanded(s.id).objects) {
    if (resource.kind === 'type' && o.type === resource.id) rows.push({ sceneId: s.id, objectId: o.id, label: s.name + ' / ' + (o.name || o.id) })
    const fields = scene.descriptor(o.type)?.fields || {}
    for (const [key, f] of Object.entries(fields)) if ((resource.kind === 'asset' && f.kind === 'asset' || resource.kind === 'character' && f.kind === 'character') && o.props?.[key] === resource.id) rows.push({ sceneId: s.id, objectId: o.id, label: s.name + ' / ' + (o.name || o.id) + ' · ' + f.label })
  }
  if (resource.kind === 'asset') {
    for (const c of engine.project.characters) if (c.portrait === resource.id || Object.values(c.expressions || {}).includes(resource.id)) rows.push({ characterId: c.id, label: c.name + ' · 立绘 / 表情' })
    if (engine.project.settings.bgm === resource.id) rows.push({ panel: 'sound', label: '作品背景音乐' })
  }
  if (resource.kind === 'prefab') for (const s of scene.document.scenes) for (const o of s.objects) if (o.prefab?.id === resource.id && o.prefab.version === resource.version) rows.push({ sceneId: s.id, objectId: o.id, label: s.name + ' / ' + (o.name || o.id) })
  return rows
}

export async function readAsset(file) {
  const mime = file.type === 'audio/x-wav' ? 'audio/wav' : file.type
  if (!['image/png', 'image/jpeg', 'image/webp', 'audio/mpeg', 'audio/wav', 'audio/ogg'].includes(mime) || !file.size || file.size > 5 * 1024 * 1024) throw Error('请选择不超过 5 MB 的 PNG、JPEG、WebP 图片或 MP3、WAV、OGG 音频')
  const url = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).replace('data:audio/x-wav;', 'data:audio/wav;')); r.onerror = () => reject(Error('素材读取失败')); r.readAsDataURL(file) })
  return { id: 'asset-' + crypto.randomUUID(), name: file.name.slice(0, 160), kind: mime.startsWith('image/') ? 'image' : 'audio', mime, size: file.size, url }
}

export function mountResources(host, { engine, scene, ui, run, button, field, input, select, place, jump, prefs }) {
  let category = 'all', query = '', selected, signature = '', disposed = false
  const head = el('div', 'scene-assets-head'), tabs = el('div', 'scene-asset-tabs'), cards = el('div', 'scene-assets-grid')
  let resourceSize = prefs?.value.resourceSize || 114
  const zoom = button('100%', () => { resourceSize = 114; applyZoom() }, 'scene-resource-zoom ne-button')
  zoom.title = 'Ctrl + 滚轮调整资源大小；点击恢复默认'; zoom.setAttribute('aria-label', '重置资源缩放')
  function applyZoom() {
    host.style.setProperty('--resource-width', resourceSize + 'px'); host.style.setProperty('--resource-art-height', Math.round(resourceSize * .48) + 'px')
    zoom.textContent = Math.round(resourceSize / 114 * 100) + '%'
    if (prefs) { prefs.value.resourceSize = resourceSize; prefs.save() }
  }
  function wheel(event) {
    if (!event.ctrlKey) return
    event.preventDefault(); event.stopPropagation()
    if (!event.deltaY) return
    resourceSize = Math.max(80, Math.min(240, resourceSize + (event.deltaY < 0 ? 8 : -8))); applyZoom()
  }
  host.addEventListener('wheel', wheel, { passive: false }); applyZoom()
  const search = el('input', 'ne-input scene-resource-search'); search.placeholder = '搜索资源…'; search.setAttribute('aria-label', '搜索资源')
  search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); renderCards() })
  const upload = el('input'); upload.type = 'file'; upload.multiple = true; upload.hidden = true; upload.accept = 'image/png,image/jpeg,image/webp,audio/mpeg,audio/wav,audio/ogg'
  const importButton = button('＋ 导入素材', () => upload.click())
  upload.addEventListener('change', () => run(async () => {
    const id = engine.project.id, files = [...upload.files]; upload.value = ''; if (!files.length) return
    if (files.length + engine.project.assets.length > 100) throw Error('一个作品最多保存 100 个素材')
    const assets = await Promise.all(files.map(readAsset))
    if (disposed || id !== engine.project.id || scene.playing) throw Error('作品状态已变化，请重新导入素材')
    engine.update(p => { p.assets.push(...assets) }); choose({ kind: 'asset', id: assets[0].id })
  }))
  for (const [id, label] of [['all', '全部'], ['image', '图片'], ['audio', '音频'], ['type', '对象类型'], ['prefab', '预制体'], ['character', '人物资料']]) { const b = button(label, () => { category = id; renderCards() }, 'scene-resource-tab'); b.dataset.category = id; tabs.append(b) }
  head.append(el('strong', '', '资源库'), tabs, search, zoom, importButton, upload); host.append(head, cards)
  function choose(value) { selected = value; select(value); mark() }
  function entries() {
    return [
      ...engine.project.assets.map(a => ({ kind: 'asset', id: a.id, category: a.kind, label: a.name, image: a.kind === 'image' ? a.url : '', detail: a.kind === 'image' ? '图片素材' : '音频素材', icon: a.kind === 'image' ? '▧' : '♫' })),
      ...scene.types().map(d => ({ kind: 'type', id: d.type, category: 'type', label: d.label, detail: d.visual === false ? '逻辑对象' : '界面对象', icon: d.visual === false ? '◇' : '▦' })),
      ...scene.document.prefabs.map(p => ({ kind: 'prefab', id: p.id, version: p.version, category: 'prefab', label: p.name, detail: '预制体 v' + p.version, icon: '▣' })),
      ...engine.project.characters.map(c => ({ kind: 'character', id: c.id, category: 'character', label: c.name, detail: '人物资料', image: engine.asset(c.portrait), icon: '◎' })),
    ]
  }
  function key(r) { return r ? [r.kind, r.id, r.version || ''].join(':') : '' }
  function mark() { for (const card of cards.children) { const active = card.dataset.resource === key(selected); card.classList.toggle('is-selected', active); card.setAttribute('aria-pressed', String(active)) } }
  function renderCards() {
    cards.replaceChildren()
    for (const tab of tabs.children) tab.setAttribute('aria-pressed', String(tab.dataset.category === category))
    for (const r of entries().filter(r => (category === 'all' || r.category === category) && (r.label + r.detail).toLowerCase().includes(query))) {
      const value = { kind: r.kind, id: r.id, ...(r.version ? { version: r.version } : {}) }
      const card = button('', () => choose(value), 'scene-resource-card'); card.title = r.label; card.dataset.resource = key(r); card.draggable = !scene.playing
      const art = el('div', 'scene-resource-art', r.icon)
      if (r.image) { const img = el('img'); img.src = r.image; img.alt = ''; img.draggable = false; art.replaceChildren(img) }
      card.append(art, el('strong', '', r.label), el('small', '', r.detail))
      card.addEventListener('dragstart', e => { if (scene.playing) { e.preventDefault(); return } e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData(RESOURCE_MIME, JSON.stringify(value)) })
      card.addEventListener('dblclick', () => { if (!scene.playing) run(() => place(value)) }); cards.append(card)
    }
    if (!cards.children.length) cards.append(el('p', 'scene-help', '没有匹配的资源。可导入图片和音频，或换一个分类。'))
    mark()
  }
  function renderInspector(resource, container) {
    const entry = entries().find(r => key(r) === key(resource)); if (!entry) { container.append(el('p', 'scene-help', '此资源已移除。')); return }
    container.append(el('h3', '', entry.label), el('p', 'scene-help', entry.detail))
    if (entry.image) { const img = el('img', 'scene-resource-preview'); img.src = entry.image; img.alt = entry.label; container.append(img) }
    if (resource.kind === 'asset') {
      const a = engine.project.assets.find(a => a.id === resource.id)
      container.append(field('素材名称', input(a.name, value => engine.update(p => { p.assets.find(a => a.id === resource.id).name = value }), '素材名称')))
      container.append(el('p', 'scene-help', (a.mime || a.kind) + (a.size ? ' · ' + (a.size / 1024).toFixed(1) + ' KB' : ' · 内置素材')))
      if (a.kind === 'audio') { const audio = el('audio', 'scene-audio-preview'); audio.controls = true; audio.src = a.url; container.append(audio, button('设为背景音乐', () => engine.update(p => { p.settings.bgm = a.id }))) }
    }
    if (resource.kind === 'type') { const d = scene.descriptor(resource.id); container.append(el('p', 'scene-help', '提供插件：' + (d.plugin || '已注册插件')), el('p', 'scene-help', '可调参数：' + (Object.values(d.fields || {}).map(f => f.label).join('、') || '无'))) }
    if (resource.kind === 'prefab') { const p = scene.document.prefabs.find(p => p.id === resource.id && p.version === resource.version); container.append(el('p', 'scene-help', p.objects.length + ' 个对象 · ' + p.connections.length + ' 条事件连接。放入场景后可单独编辑实例。')) }
    if (resource.kind === 'character') {
      const c = engine.project.characters.find(c => c.id === resource.id)
      container.append(el('p', 'scene-help', c.description), el('p', 'scene-help', c.personality), button('编辑人物档案', () => { engine.select({ characterId: c.id }); return ui.navigate('characters') }))
    }
    if (resource.kind !== 'asset' || entry.category === 'image') container.append(button(resource.kind === 'character' ? '创建独立角色聊天' : '放入场景', () => place(resource), 'ne-button ne-primary'))
    container.append(el('h3', '', '引用位置'))
    const refs = resourceReferences(engine, scene, resource)
    for (const ref of refs) container.append(button(ref.label, () => jump(ref), 'scene-reference-link'))
    if (!refs.length) container.append(el('p', 'scene-help', '当前没有引用此资源。'))
  }
  function refresh() { const stamp = JSON.stringify([engine.project.assets, engine.project.characters, scene.document.prefabs, scene.types(), scene.playing]); if (stamp !== signature) { signature = stamp; renderCards() } importButton.disabled = scene.playing }
  refresh()
  return { refresh, renderInspector, clearSelection() { selected = null; mark() }, dispose() { disposed = true; host.removeEventListener('wheel', wheel); host.replaceChildren() } }
}
