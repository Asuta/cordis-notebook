// The scene editor owns the one game viewport. Other plugins open on demand.
export function mountWorkspace(ctx, sdk, engine, { projectPanel, showLibrary, download }) {
  const panels = new Map([['project', projectPanel]]), surfaces = new Map(), tools = new Map(), mounted = new Map()
  const el = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls || ''; if (text != null) n.textContent = text; return n }
  const run = fn => Promise.resolve().then(fn).catch(e => sdk.toast(e.message))
  const button = (label, fn, cls = 'ne-button') => { const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', () => run(fn)); return b }
  const root = el('main', 'ne-app'), header = el('header', 'ne-header'), workspace = el('section', 'ne-workspace-host')
  const title = el('input', 'ne-project-title'), status = el('span', 'ne-save-status'), headerTools = el('div', 'ne-header-tools')
  const settings = el('select', 'ne-select ne-settings-menu'), mode = button('▶ 试玩', () => engine.mode === 'play' ? engine.stop() : engine.play(), 'ne-button ne-primary')
  title.setAttribute('aria-label', '作品名称'); title.maxLength = 120
  title.addEventListener('change', () => run(() => engine.update(p => { p.title = title.value.trim() || p.title })))
  settings.setAttribute('aria-label', '全局设置')
  settings.addEventListener('change', () => { const id = settings.value; settings.value = ''; run(() => id === 'plugins' ? document.querySelector('#manage-plugins')?.click() : navigate(id)) })
  const projectHead = el('div', 'ne-project-heading'); projectHead.append(title, status)
  const editorTools=el('div','ne-editor-tools')
  header.append(projectHead, editorTools, headerTools)
  const save = button('保存', () => engine.save()), restart = button('重新开始', () => engine.play())
  projectHead.prepend(button('作品库', () => showLibrary(false)))
  const more=el('details','ne-tools-more'),moreTitle=el('summary','','更多'),moreBody=el('div','ne-tools-more-body')
  more.append(moreTitle,moreBody);headerTools.append(save,mode,more)
  const contributedTools = el('div', 'ne-contributed-tools'); moreBody.append(settings,restart,contributedTools)
  const fitHeader=()=>{if(window.innerWidth<=800){moreBody.prepend(title,save)}else{projectHead.insertBefore(title,status);headerTools.prepend(save)}}
  window.addEventListener('resize',fitHeader);fitHeader()
  const error = el('div', 'ne-runtime-error'); error.setAttribute('role', 'alert'); error.hidden = true
  root.append(header, workspace, error); sdk.mount('app', root)
  let editorDispose, editorDescriptor, editorProject, dialog, panelDispose, active = '', disposed = false, scheduled = false, panelRefresh = false
  const sorted = map => [...map.values()].sort((a, b) => (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id))
  function closePanel() { panelDispose?.(); panelDispose = null; dialog?.remove(); dialog = null; active = '' }
  function renderPanel() {
    const p = panels.get(active); if (!dialog || !p) return
    panelDispose?.(); panelDispose = null
    const body = dialog.querySelector('.ne-settings-body'); body.replaceChildren()
    const content = el('div', 'ne-stack'); body.append(content)
    try { panelDispose = p.render(content) } catch (e) { content.append(el('p', 'ne-empty', e.message)) }
    // Most plugin panels author project data. Saves must remain interactive in play.
    content.inert = engine.mode === 'play' && active !== 'saves'
    if (content.inert) body.prepend(el('p', 'ne-muted', '正在试玩，停止试玩后可修改设置。'))
  }
  async function navigate(id) {
    if (id === 'scene.editor') { await panels.get(active)?.beforeLeave?.(); closePanel(); return }
    if (!panels.has(id)) return
    await panels.get(active)?.beforeLeave?.(); closePanel(); active = id
    dialog = el('dialog', 'ne-library-dialog ne-settings-dialog')
    const head = el('div', 'ne-modal-heading'); head.append(el('h2', '', panels.get(id).label), button('关闭', async () => { await panels.get(active)?.beforeLeave?.(); closePanel() }))
    dialog.append(head, el('div', 'ne-modal-body ne-settings-body')); root.append(dialog)
    dialog.addEventListener('cancel', event => { event.preventDefault(); run(async () => { await panels.get(active)?.beforeLeave?.(); closePanel() }) })
    renderPanel(); dialog.showModal()
  }
  function renderWorkspace() {
    const editor = panels.get('scene.editor')
    if (editor && editor === editorDescriptor && engine.project.id === editorProject) return
    editorDispose?.(); editorDispose = null; editorDescriptor = editor; editorProject = engine.project.id
    for (const m of mounted.values()) m.dispose?.(); mounted.clear(); workspace.replaceChildren()
    if (editor) { editorDispose = editor.render(workspace); return }
    if (!surfaces.size) workspace.append(el('p', 'ne-empty', '启用场景搭建编辑器，开始编辑作品。'))
    for (const s of sorted(surfaces)) { const host = el('div', 'ne-fallback-player'); workspace.append(host); mounted.set(s.id, { dispose: s.mount(host) }) }
  }
  function renderTools() {
    settings.replaceChildren(el('option', '', '设置…')); settings.firstChild.value = ''
    for (const p of sorted(panels).filter(p => p.id !== 'scene.editor')) { const o = el('option', '', p.label); o.value = p.id; settings.append(o) }
    const plugins = el('option', '', '插件管理'); plugins.value = 'plugins'; settings.append(plugins)
    contributedTools.replaceChildren()
    for (const t of sorted(tools)) contributedTools.append(button((t.icon ? t.icon + ' ' : '') + t.label, t.run))
  }
  function renderState() {
    const playing = engine.mode === 'play'; root.classList.toggle('is-playing', playing); root.inert = engine.held
    root.style.setProperty('--ne-accent', engine.project.settings.accent)
    if (document.activeElement !== title) title.value = engine.project.title
    title.disabled = save.disabled = playing; status.textContent = engine.status
    status.classList.toggle('is-saving', engine.status.includes('保存…'))
    mode.textContent = playing ? '■ 停止试玩' : '▶ 试玩'; mode.setAttribute('aria-pressed', String(playing)); restart.hidden = !playing
    error.hidden = !engine.runtime?.error; error.textContent = engine.runtime?.error || ''
  }
  function refresh() { if (disposed) return; renderWorkspace(); renderTools(); renderState() }
  function register(map, owner, descriptor) {
    if (map.has(descriptor.id)) throw Error('界面贡献重复：' + descriptor.id)
    map.set(descriptor.id, descriptor); refresh()
    owner.effect(() => () => { map.delete(descriptor.id); if (active === descriptor.id) closePanel(); if (!disposed) refresh() })
  }
  const ui = { mountEditorToolbar(node) { editorTools.replaceChildren(node); return () => node.remove() }, registerPanel: (o, d) => register(panels, o, d), registerSurface: (o, d) => register(surfaces, o, d), registerToolbar: (o, d) => register(tools, o, d), navigate, refresh }
  sdk.provide('narrativeUI', ui)
  engine.observe(ctx, event => {
    renderState()
    if (event.type === 'project' || event.type === 'mode') {
      panelRefresh ||= event.type === 'mode' || event.render !== false
      if (scheduled) return
      scheduled = true
      // Let every service synchronize the new project before mounting its views.
      queueMicrotask(() => {
        scheduled = false
        const updatePanel = panelRefresh; panelRefresh = false
        if (disposed) return
        renderWorkspace(); if (updatePanel) renderPanel()
      })
    }
  })
  ctx.effect(() => () => { disposed = true; window.removeEventListener('resize',fitHeader); closePanel(); editorDispose?.(); for (const m of mounted.values()) m.dispose?.(); root.remove() })
  refresh()
  return { root, ui }
}
