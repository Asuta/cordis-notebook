import { createVideoThumbnails } from './library-thumbnails.js'

const DRAG = 'application/x-cordis-library-selection'
const SINGLE = 'application/x-cordis-studio-asset'
const MULTI = 'application/x-cordis-studio-assets'
const STORAGE = 'studio-asset-workspace-v1'
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const blankTab = (location = 'all') => ({ id: crypto.randomUUID(), location, query: '', global: false, kind: 'all', sort: 'newest', scroll: 0, selected: new Set(), anchor: null, expanded: new Set(), history: [], future: [] })

export function createLibraryBrowser(ctx, sdk, view, session, storeAsset) {
  const { el, button, safe } = view
  const api = (path, body) => sdk.request('/api/studio/asset-library' + path, body === undefined ? 'GET' : 'POST', body)
  let data = { revision: -1, folders: [], collections: [{ id: 'favorites', name: '收藏', assetIds: [] }], items: {} }
  let stopped = false, loading, queue = Promise.resolve(), clipboard = null, z = 100, saving, indexedAssets, assets = [], indexedRevision = -1, indexedCount = -1, indexedContent = ''
  const windows = new Set(), browsers = new Set(), cleanups = [], selections = new Map(), dialogs = new Set()
  const thumbnails = createVideoThumbnails(document)
  const channel = typeof window.BroadcastChannel === 'function' ? new window.BroadcastChannel('cordis-studio-asset-library') : null
  const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); const off = () => target.removeEventListener(type, fn, options); cleanups.push(off); return off }
  const assetName = asset => data.items[asset.id]?.name || asset.name || '未命名素材'
  const locationName = location => ({ all: '全部素材', root: '未分类', recent: '最近添加', trash: '回收站' })[location] || (location.startsWith('folder:') ? data.folders.find(item => item.id === location.slice(7))?.name : data.collections.find(item => item.id === location.slice(11))?.name) || '目录已移除'
  function index() {
    const count = Object.keys(session.state.assets).length
    if (indexedAssets === session.state.assets && indexedRevision === data.revision && indexedCount === count) return false
    indexedCount = count
    indexedAssets = session.state.assets; indexedRevision = data.revision
    const values = Object.values(indexedAssets), content = JSON.stringify([data.revision, values])
    if (content === indexedContent) return false
    indexedContent = content
    assets = values.map(asset => ({ ...asset, name: assetName(asset), meta: data.items[asset.id] || {} }))
    return true
  }
  function accept(next) {
    if (stopped || next.revision < data.revision) return
    data = next; refresh()
  }
  async function load() {
    if (loading) return loading
    loading = api('').then(accept).finally(() => { loading = null })
    return loading
  }
  function mutate(operation) {
    const task = queue.then(async () => {
      if (stopped) throw Error('素材库已关闭')
      if (data.revision < 0) await load()
      try { accept(await api('', { ...operation, revision: data.revision })); channel?.postMessage('changed') }
      catch (error) { await load().catch(() => {}); throw error }
    })
    queue = task.catch(() => {}); return task
  }
  function persist() {
    clearTimeout(saving)
    saving = setTimeout(() => {
      const serialize = browser => ({ size: browser.size, compact: browser.compact, activeIndex: browser.tabs.findIndex(tab => tab.id === browser.active), tree: browser.treeVisible, tabs: browser.tabs.map(tab => ({ ...tab, selected: [], expanded: [...tab.expanded], history: tab.history.slice(-30), future: [] })) })
      sdk.storage.local.setItem(STORAGE, JSON.stringify({ side: serialize(side), windows: [...windows].map(browser => ({ ...serialize(browser), geometry: browser.geometry, modeSizes: browser.modeSizes })) }))
    }, 150)
  }
  // These dialogs belong to the library; their keyboard events must never edit the canvas.
  function ask(label, { value, choices, message, danger = false } = {}) {
    return new Promise(resolve => {
      const dialog = el('dialog', { class: 'asset-library-dialog', 'aria-label': label })
      const form = el('form'), input = choices ? el('select', { 'aria-label': label }) : value !== undefined ? el('input', { value, maxLength: 120, required: true, 'aria-label': label }) : null
      for (const choice of choices || []) input.append(el('option', { value: choice.id }, choice.label))
      form.append(el('h3', {}, label))
      if (message) form.append(el('p', {}, message))
      if (input) form.append(input)
      const actions = el('div', { class: 'asset-library-dialog-actions' })
      const cancel = button('取消', () => dialog.close()), ok = el('button', { type: 'submit', class: danger ? 'studio-danger' : 'studio-primary' }, '确定')
      actions.append(cancel, ok); form.append(actions); dialog.append(form); view.root.append(dialog)
      dialogs.add(dialog)
      const finish = result => { dialogs.delete(dialog); dialog.remove(); resolve(result) }
      dialog.onclose = () => finish(null)
      dialog.onkeydown = event => event.stopPropagation()
      form.onsubmit = event => { event.preventDefault(); finish(input ? input.value : true) }
      dialog.showModal(); input?.focus(); input?.select?.()
    })
  }
  const folderPath = id => {
    const parts = [], seen = new Set()
    while (id && !seen.has(id)) { seen.add(id); const item = data.folders.find(item => item.id === id); if (!item) break; parts.unshift(item.name); id = item.parentId }
    return parts.join(' / ')
  }
  const folderChoices = () => [{ id: '', label: '未分类（根目录）' }, ...data.folders.filter(item => !item.trashedAt).map(item => ({ id: item.id, label: folderPath(item.id) }))]
  function selectedParts(tab) { return { ids: [...tab.selected].filter(key => key.startsWith('a:')).map(key => key.slice(2)), folders: [...tab.selected].filter(key => key.startsWith('f:')).map(key => key.slice(2)) } }
  async function transfer(parts, location) {
    if (location.startsWith('collection:')) {
      if (parts.folders.length) throw Error('收藏集只收纳素材，请先打开文件夹选择素材')
      if (parts.ids.length) await mutate({ type: 'collect', collectionId: location.slice(11), ids: parts.ids })
    } else if (location === 'root' || location.startsWith('folder:')) {
      const folderId = location === 'root' ? null : location.slice(7), operations = parts.folders.map(id => ({ type: 'moveFolder', id, parentId: folderId }))
      if (parts.ids.length) operations.push({ type: 'move', ids: parts.ids, folderId })
      if (operations.length) await mutate({ type: 'batch', operations })
    } else throw Error('请放到文件夹或收藏集内')
  }
  async function uploadFiles(files, location) {
    const ids = []
    try {
      for (const file of files) ids.push((await storeAsset(file)).asset.id)
    } finally {
      // A failed later upload must not strand earlier successes in an unrelated folder.
      if (ids.length && (location === 'root' || /^(folder|collection):/.test(location))) await transfer({ ids, folders: [] }, location)
      index(); for (const browser of browsers) browser.update()
    }
  }
  function chooseFiles(location) {
    const input = el('input', { type: 'file', multiple: true, accept: 'image/png,image/jpeg,image/webp,video/mp4,video/webm', hidden: true })
    view.root.append(input)
    input.onchange = safe(async () => { try { await uploadFiles([...input.files], location) } finally { input.remove() } })
    input.oncancel = () => input.remove(); input.click()
  }
  async function command(browser, name) {
    const tab = browser.tab(), parts = selectedParts(tab), folderId = tab.location.startsWith('folder:') ? tab.location.slice(7) : null
    if (name === 'mkdir' || name === 'collection') {
      const value = await ask(name === 'mkdir' ? '新建文件夹' : '新建收藏集', { value: '' })
      if (value !== null) await mutate(name === 'mkdir' ? { type: 'mkdir', name: value, parentId: folderId } : { type: 'createCollection', name: value })
    } else if (name === 'rename') {
      if (parts.ids.length + parts.folders.length !== 1) throw Error('请选择一项重命名')
      const item = parts.folders.length ? data.folders.find(item => item.id === parts.folders[0]) : assets.find(item => item.id === parts.ids[0])
      const value = await ask('重命名', { value: item.name })
      if (value !== null) await mutate(parts.folders.length ? { type: 'renameFolder', id: item.id, name: value } : { type: 'rename', ids: [item.id], name: value })
    } else if (name === 'move') {
      if (!tab.selected.size) throw Error('请先选择素材或文件夹')
      const destination = await ask('移动到文件夹', { choices: folderChoices() })
      if (destination !== null) await transfer(parts, destination ? 'folder:' + destination : 'root')
    } else if (name === 'collect') {
      if (!parts.ids.length || parts.folders.length) throw Error('请选择素材加入收藏集')
      const id = await ask('加入收藏集', { choices: data.collections.map(item => ({ id: item.id, label: item.name })) })
      if (id !== null) await transfer(parts, 'collection:' + id)
    } else if (name === 'uncollect') {
      if (!tab.location.startsWith('collection:') || !parts.ids.length) throw Error('请在收藏集中选择素材')
      await mutate({ type: 'uncollect', ids: parts.ids, collectionId: tab.location.slice(11) })
    } else if (name === 'trash' || name === 'restore') {
      if (!tab.selected.size) throw Error('请先选择素材或文件夹')
      if (name === 'trash' && !await ask('移入回收站', { message: '所选文件夹及其内容会移入回收站，已有画布引用保持可用。', danger: true })) return
      // Selecting both parent and child is one operation on the parent subtree.
      const roots = parts.folders.filter(id => {
        let parent = data.folders.find(item => item.id === id)?.parentId
        while (parent) { if (parts.folders.includes(parent)) return false; parent = data.folders.find(item => item.id === parent)?.parentId }
        return true
      })
      const operations = roots.map(id => ({ type: name === 'trash' ? 'trashFolder' : 'restoreFolder', id }))
      if (parts.ids.length) operations.push({ type: name, ids: parts.ids })
      await mutate({ type: 'batch', operations }); tab.selected.clear(); browser.update()
    } else if (name === 'purge') {
      if (!parts.ids.length || parts.folders.length) throw Error('请选择回收站中的素材；文件夹可以恢复后重新整理')
      if (!await ask('永久删除所选素材', { message: '此操作会删除原文件，无法撤销。仍被画板或生成记录引用的素材会被阻止删除。', danger: true })) return
      const result = await api('/purge', { ids: parts.ids, revision: data.revision })
      for (const id of result.removed) delete session.state.assets[id]
      for (const warning of result.warnings) sdk.toast(warning)
      await load(); channel?.postMessage('changed')
    } else if (name === 'cut' || name === 'copy') {
      if (!tab.selected.size) throw Error('请先选择素材或文件夹')
      clipboard = { ...parts, copy: name === 'copy' }; sdk.toast(name === 'copy' ? '已复制素材引用，可粘贴到收藏集' : '已剪切，进入目标文件夹后粘贴')
    } else if (name === 'paste') {
      if (!clipboard) return
      if (clipboard.copy && !tab.location.startsWith('collection:')) throw Error('复制的引用请粘贴到收藏集；移动素材请使用剪切')
      await transfer(clipboard, tab.location); if (!clipboard.copy) clipboard = null
    } else if (name === 'download') {
      for (const id of parts.ids) { const asset = session.state.assets[id], link = el('a', { href: session.mediaKind(asset) === 'video' ? session.mediaUrl(asset) : view.imageUrl(id, false), download: assetName(asset) }); view.root.append(link); link.click(); link.remove() }
    } else if (name === 'upload') chooseFiles(tab.location)
    else if (name === 'undo' || name === 'redo') await mutate({ type: name })
  }

  function makeBrowser({ floating = false, saved = {}, location = 'all' } = {}) {
    const browser = { floating, size: clamp(Number(saved.size) || (floating ? 144 : 88), 72, 256), treeVisible: saved.tree !== false, tabs: [], active: '', geometry: saved.geometry || { x: 300 + windows.size * 28, y: 100 + windows.size * 28, width: 820, height: 600 } }
    browser.compact = floating && saved.compact === true
    browser.modeSizes = { ...saved.modeSizes }
    for (const raw of (saved.tabs || []).slice(0, 30)) {
      if (!raw || typeof raw.location !== 'string') continue
      browser.tabs.push({ ...blankTab(raw.location), query: String(raw.query || ''), global: !!raw.global, kind: ['all', 'image', 'video'].includes(raw.kind) ? raw.kind : 'all', sort: ['newest', 'oldest', 'name'].includes(raw.sort) ? raw.sort : 'newest', scroll: Math.max(0, Number(raw.scroll) || 0), expanded: new Set(Array.isArray(raw.expanded) ? raw.expanded : []) })
    }
    if (!browser.tabs.length) browser.tabs.push(blankTab(location))
    browser.active = browser.tabs[Math.max(0, Math.min(Number(saved.activeIndex) || 0, browser.tabs.length - 1))].id
    browser.tab = () => browser.tabs.find(tab => tab.id === browser.active) || browser.tabs[0]
    const root = el('section', { class: 'asset-browser' + (floating ? ' asset-window' : ' asset-sidebar'), tabIndex: -1, 'aria-label': floating ? '素材库浮窗' : '素材库浏览器' })
    browser.root = root
    root.classList.toggle('asset-compact', browser.compact)
    const head = el('header', { class: 'asset-window-head' }), tabsBar = el('div', { class: 'asset-tabs', role: 'tablist' }), path = el('div', { class: 'asset-path' }), controls = el('div', { class: 'asset-controls' }), actions = el('div', { class: 'asset-actions' }), body = el('div', { class: 'asset-body' }), tree = el('nav', { class: 'asset-tree', 'aria-label': '目录与收藏集' }), grid = el('div', { class: 'asset-grid', tabIndex: 0, role: 'grid', 'aria-label': '素材网格' }), canvas = el('div', { class: 'asset-grid-content' }), foot = el('footer', { class: 'asset-browser-foot' }), count = el('span'), zoom = el('input', { type: 'range', min: 72, max: 256, step: 8, value: String(browser.size), 'aria-label': '缩略图大小' })
    const search = el('input', { type: 'search', placeholder: '搜索当前目录', 'aria-label': '搜索素材' }), scope = el('input', { type: 'checkbox', 'aria-label': '搜索全部素材' }), scopeLabel = el('label', {}, '全库'), kind = el('select', { 'aria-label': '素材类型' }), sort = el('select', { 'aria-label': '素材排序' })
    for (const [id, label] of [['all', '全部类型'], ['image', '图片'], ['video', '视频']]) kind.append(el('option', { value: id }, label))
    for (const [id, label] of [['newest', '最近添加'], ['oldest', '最早添加'], ['name', '名称']]) sort.append(el('option', { value: id }, label))
    scopeLabel.prepend(scope); controls.append(search, scopeLabel, kind, sort)
    const addTab = (loc = browser.tab().location) => { const tab = blankTab(loc); browser.tabs.push(tab); browser.active = tab.id; browser.update(true); persist() }
    browser.addTab = addTab
    const navigate = (loc, history = true) => {
      const tab = browser.tab()
      if (history && tab.location !== loc) { tab.history.push(tab.location); tab.future = [] }
      tab.location = loc; tab.query = ''; tab.scroll = 0; tab.selected.clear(); tab.anchor = null
      browser.update(true); persist()
    }
    browser.navigate = navigate
    const history = forward => { const tab = browser.tab(), from = forward ? tab.future : tab.history, to = forward ? tab.history : tab.future; if (from.length) { to.push(tab.location); navigate(from.pop(), false) } }
    const close = () => { browser.destroy(); persist() }
    browser.destroy = () => {
      browser.cancelGesture?.(); browser.resizeObserver?.disconnect(); clearPreview(true); root.remove(); browsers.delete(browser); windows.delete(browser)
      if (browser.frame) window.cancelAnimationFrame(browser.frame)
    }
    if (floating) {
      head.append(el('strong', {}, '▦ 素材库'), button('简略模式', () => setCompact(true)), button('＋ 窗口', () => open(browser.tab().location)), button('最大化', () => { browser.maximized = !browser.maximized; positionWindow() }), button('关闭', close))
      root.append(head)
    }
    const toggleTree = button('☰', () => { browser.treeVisible = !browser.treeVisible; browser.update(); persist() }); toggleTree.title = '展开或收起目录树'
    const nav = el('div', { class: 'asset-navigation' }); nav.append(toggleTree, button('‹', () => history(false)), button('›', () => history(true)), path)
    const names = [['upload', '上传'], ['mkdir', '新建文件夹'], ['collection', '新建收藏集'], ['move', '移动到…'], ['collect', '加入收藏集'], ['undo', '撤销'], ['redo', '重做']]
    const actionButtons = new Map()
    for (const [id, label] of names) { const b = button(label, () => command(browser, id)); b.dataset.command = id; actionButtons.set(id, b); actions.append(b) }
    const more = button('更多 ⋯', event => showMenu(event.clientX || root.getBoundingClientRect().left + 20, event.clientY || root.getBoundingClientRect().top + 150)); actions.append(more)
    grid.append(canvas); body.append(tree, grid); foot.append(count, zoom, button('重置', () => setSize(floating ? 144 : 88)))
    grid.title = '单击选择 · Ctrl / Shift 多选 · 双击预览 · 拖到目录或画布 · Ctrl + 滚轮调整大小'
    const topLine = el('div', { class: 'asset-topline' }), compactControls = el('div', { class: 'asset-compact-controls' })
    const grip = el('span', { class: 'asset-window-grip', title: '拖动素材库窗口', 'aria-label': '拖动素材库窗口' }, '⠿')
    const tabSwitch = button('', () => showTabMenu(), 'asset-tab-switch')
    tabSwitch.setAttribute('aria-label', '切换素材库标签页'); tabSwitch.setAttribute('aria-haspopup', 'menu'); tabSwitch.setAttribute('aria-expanded', 'false')
    if (floating) {
      const options = button('⋯', event => {
        const rect = event.currentTarget.getBoundingClientRect()
        showSimpleMenu({ clientX: rect.right - 200, clientY: rect.bottom }, [
          ['恢复完整模式', () => setCompact(false)], ['新建素材库窗口', () => open(browser.tab().location, { compact: true })],
          [browser.maximized ? '还原窗口' : '最大化窗口', () => { browser.maximized = !browser.maximized; positionWindow() }],
        ])
      })
      compactControls.append(options, button('×', close))
      const labels = ['素材库窗口菜单', '关闭素材库窗口']
      for (const [i, b] of [...compactControls.children].entries()) { b.title = labels[i]; b.setAttribute('aria-label', labels[i]) }
    }
    topLine.append(grip, tabsBar, tabSwitch, compactControls); root.append(topLine, nav, controls, actions, body, foot)
    if (floating) view.root.append(root); else view.assetPanel.append(root)
    browsers.add(browser); if (floating) windows.add(browser)
    browser.focus = () => { if (floating) root.style.zIndex = String(++z) }
    root.onpointerdown = () => browser.focus()
    root.onfocusin = () => browser.focus()
    root.onkeydown = safe(async event => {
      event.stopPropagation()
      if (event.target.closest('input,select,textarea,[contenteditable=true]')) return
      const key = event.key.toLowerCase(), mod = event.ctrlKey || event.metaKey
      if (mod && ['a', 'x', 'c', 'v', 'z', 'y', 't', 'w'].includes(key)) {
        event.preventDefault()
        if (key === 'a') { browser.tab().selected = new Set(entries.map(item => item.key)); paintSelection(); return }
        if (key === 't') { addTab(); return }
        if (key === 'w') { closeTab(browser.tab().id); return }
        await command(browser, { x: 'cut', c: 'copy', v: 'paste', z: event.shiftKey ? 'redo' : 'undo', y: 'redo' }[key])
      } else if (key === 'delete') { event.preventDefault(); await command(browser, browser.tab().location.startsWith('collection:') ? 'uncollect' : 'trash') }
      else if (key === 'f2') { event.preventDefault(); await command(browser, 'rename') }
      else if (key === 'escape') { browser.tab().selected.clear(); paintSelection() }
      else if (key === 'enter' && browser.tab().selected.size === 1) activate([...browser.tab().selected][0])
    })
    root.onpaste = event => { if (!event.target.closest('input,textarea')) { event.stopPropagation(); if (event.clipboardData?.files?.length) { event.preventDefault(); void safe(() => uploadFiles([...event.clipboardData.files], browser.tab().location))() } } }
    function closeTab(id) {
      if (browser.tabs.length === 1) { if (floating) close(); else navigate('all'); return }
      const idx = browser.tabs.findIndex(tab => tab.id === id); browser.tabs.splice(idx, 1)
      if (browser.active === id) browser.active = browser.tabs[Math.min(idx, browser.tabs.length - 1)].id
      browser.update(true); persist()
    }
    function drawTabs() {
      tabSwitch.textContent = tabLabel(browser.tab()) + ' ▾'
      tabSwitch.title = tabPath(browser.tab())
      tabsBar.replaceChildren()
      for (const tab of browser.tabs) {
        const wrap = el('div', { class: 'asset-tab' + (tab.id === browser.active ? ' active' : '') })
        const b = button(locationName(tab.location), () => { browser.active = tab.id; browser.update(true); persist() }); b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(tab.id === browser.active))
        b.oncontextmenu = event => { event.preventDefault(); showSimpleMenu(event, [['在新 Tab 打开', () => addTab(tab.location)], ['在新窗口打开', () => open(tab.location)], ['关闭 Tab', () => closeTab(tab.id)]]) }
        const x = button('×', () => closeTab(tab.id)); x.setAttribute('aria-label', '关闭标签页')
        wrap.append(b, x); tabsBar.append(wrap)
      }
      const plus = button('＋', () => addTab()); plus.setAttribute('aria-label', '新建素材库标签页'); tabsBar.append(plus)
    }
    function tabLabel(tab) {
      const name = locationName(tab.location), same = browser.tabs.filter(item => locationName(item.location) === name)
      return name + (same.length > 1 ? ' · ' + (same.indexOf(tab) + 1) : '')
    }
    function tabPath(tab) { return tab.location.startsWith('folder:') ? '目录 / ' + folderPath(tab.location.slice(7)) : locationName(tab.location) }
    function showTabMenu() {
      if (tabSwitch.getAttribute('aria-expanded') === 'true') { dismissMenu(); return }
      const rect = tabSwitch.getBoundingClientRect()
      showSimpleMenu({ clientX: rect.left, clientY: rect.bottom }, [])
      menu.classList.add('asset-tab-menu'); menu.setAttribute('aria-label', '素材库标签页列表')
      tabSwitch.setAttribute('aria-expanded', 'true')
      for (const tab of browser.tabs) {
        const row = el('div', { class: 'asset-tab-menu-row' })
        const select = button(tabLabel(tab), () => { dismissMenu(); browser.active = tab.id; browser.update(); persist(); tabSwitch.focus() })
        select.setAttribute('role', 'menuitemradio'); select.setAttribute('aria-checked', String(tab.id === browser.active)); select.title = tabPath(tab)
        const remove = button('×', () => { dismissMenu(); closeTab(tab.id); if (root.isConnected) tabSwitch.focus() })
        remove.setAttribute('aria-label', '关闭标签页：' + tabLabel(tab)); remove.title = '关闭此标签页'
        row.append(select, remove); menu.append(row)
      }
      const add = button('＋ 新建 Tab', () => { dismissMenu(); addTab(); tabSwitch.focus() })
      add.setAttribute('aria-label', '新建素材库标签页'); menu.append(add)
      placeMenu(rect.left, rect.bottom)
      menu.querySelector('[aria-checked=true]')?.focus()
    }
    function drawTree() {
      tree.hidden = !browser.treeVisible; tree.replaceChildren()
      const tab = browser.tab()
      function row(loc, label, depth = 0, expandable = false) {
        const wrap = el('div', { class: 'asset-tree-row' + (tab.location === loc ? ' active' : '') }); wrap.style.paddingLeft = depth * 13 + 'px'
        if (expandable) wrap.append(button(tab.expanded.has(loc) ? '▾' : '▸', () => { if (tab.expanded.has(loc)) tab.expanded.delete(loc); else tab.expanded.add(loc); drawTree(); persist() }))
        const b = button(label, () => navigate(loc)); b.dataset.location = loc; b.title = label
        b.onauxclick = event => { if (event.button === 1) { event.preventDefault(); addTab(loc) } }
        b.oncontextmenu = event => { event.preventDefault(); treeMenu(event, loc) }
        if (loc.startsWith('folder:')) { b.draggable = true; b.ondragstart = event => beginDrag(event, { ids: [], folders: [loc.slice(7)] }) }
        dropTarget(b, () => loc); wrap.append(b); tree.append(wrap)
      }
      for (const [loc, label] of [['all', '▦ 全部素材'], ['root', '▱ 未分类'], ['recent', '◷ 最近添加'], ['trash', '♲ 回收站']]) row(loc, label)
      tree.append(el('small', { class: 'asset-tree-heading' }, '文件夹'))
      const visit = (parent, depth) => {
        for (const item of data.folders.filter(item => item.parentId === parent && !item.trashedAt)) {
          const loc = 'folder:' + item.id, children = data.folders.some(child => child.parentId === item.id && !child.trashedAt)
          row(loc, '▱ ' + item.name, depth, children)
          if (children && tab.expanded.has(loc)) visit(item.id, depth + 1)
        }
      }
      visit(null, 0); tree.append(el('small', { class: 'asset-tree-heading' }, '收藏集'))
      for (const item of data.collections) row('collection:' + item.id, '☆ ' + item.name)
    }
    function treeMenu(event, loc) {
      const list = [['在新 Tab 打开', () => addTab(loc)], ['在新窗口打开', () => open(loc)]]
      if (loc.startsWith('folder:')) list.push(['重命名', async () => { const id = loc.slice(7), value = await ask('重命名文件夹', { value: locationName(loc) }); if (value !== null) await mutate({ type: 'renameFolder', id, name: value }) }], ['移动到…', async () => { const dest = await ask('移动到文件夹', { choices: folderChoices() }); if (dest !== null) await transfer({ ids: [], folders: [loc.slice(7)] }, dest ? 'folder:' + dest : 'root') }], ['移入回收站', async () => { if (await ask('移入回收站', { message: '文件夹及其内容将移入回收站，可以恢复。', danger: true })) await mutate({ type: 'trashFolder', id: loc.slice(7) }) }])
      if (loc.startsWith('collection:')) list.push(['重命名', async () => { const value = await ask('重命名收藏集', { value: locationName(loc) }); if (value !== null) await mutate({ type: 'renameCollection', id: loc.slice(11), name: value }) }], ['删除收藏集', async () => { if (await ask('删除收藏集', { message: '仅移除收藏集，素材及主目录保持不变。', danger: true })) await mutate({ type: 'deleteCollection', id: loc.slice(11) }) }])
      showSimpleMenu(event, list)
    }
    function drawPath() {
      path.replaceChildren(); const tab = browser.tab()
      if (tab.location.startsWith('folder:')) {
        const parts = [], seen = new Set(); let id = tab.location.slice(7)
        while (id && !seen.has(id)) { seen.add(id); const item = data.folders.find(item => item.id === id); if (!item) break; parts.unshift(item); id = item.parentId }
        path.append(button('目录', () => navigate('root')))
        for (const item of parts) path.append(el('span', {}, '/'), button(item.name, () => navigate('folder:' + item.id)))
      } else path.append(el('strong', {}, locationName(tab.location)))
    }
    let entries = [], columns = 1, cellWidth = browser.size, rowHeight = browser.size + 57, gap = 10, padding = 8, renderedRange = '', menu = null, dialogCleanups = []
    const tileCache = new Map(), mounted = new Set()
    function matching() {
      index(); const tab = browser.tab(), collection = tab.location.startsWith('collection:') ? new Set(data.collections.find(item => item.id === tab.location.slice(11))?.assetIds || []) : null, query = tab.query.trim().toLocaleLowerCase(), trash = tab.location === 'trash'
      const currentFolder = tab.location.startsWith('folder:') ? tab.location.slice(7) : null
      const filtered = assets.filter(asset => {
        if (!!asset.meta.trashedAt !== trash) return false
        if (!(tab.global && query)) {
          if (collection && !collection.has(asset.id)) return false
          if (currentFolder && asset.meta.folderId !== currentFolder) return false
          if (tab.location === 'root' && asset.meta.folderId) return false
        }
        return (tab.kind === 'all' || session.mediaKind(asset) === tab.kind) && (!query || [asset.name, asset.width, asset.height, asset.extension, session.mediaKind(asset) === 'video' ? '视频' : '图片'].join(' ').toLocaleLowerCase().includes(query))
      }).sort((a, b) => tab.sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN', { numeric: true }) : ((a.createdAt || 0) - (b.createdAt || 0)) * (tab.sort === 'oldest' ? 1 : -1))
      let folders = data.folders.filter(item => trash ? !!item.trashedAt && !data.folders.some(parent => parent.id === item.parentId && parent.trashedAt) : !item.trashedAt && (currentFolder || tab.location === 'root') && item.parentId === currentFolder)
      if (query) folders = folders.filter(item => item.name.toLocaleLowerCase().includes(query))
      if (tab.kind !== 'all') folders = []
      return [...folders.map(item => ({ key: 'f:' + item.id, folder: item })), ...filtered.map(asset => ({ key: 'a:' + asset.id, asset }))]
    }
    function detach(record) { record.release?.(); record.release = null; record.tile.remove() }
    function clearPreview(dispose = false) {
      for (const key of mounted) detach(tileCache.get(key))
      mounted.clear()
      if (dispose) { for (const record of tileCache.values()) record.release?.(); tileCache.clear() }
    }
    function visible() { return !document.hidden && (floating || (!view.sideAssets.hidden && !view.root.classList.contains('sidebar-collapsed'))) }
    function paintSelection() {
      const tab = browser.tab()
      for (const tile of canvas.querySelectorAll('[data-key]')) { const yes = tab.selected.has(tile.dataset.key); tile.classList.toggle('selected', yes); tile.setAttribute('aria-selected', String(yes)) }
      count.textContent = entries.length + ' 项 · 已选 ' + tab.selected.size
    }
    function activate(key) { if (key.startsWith('f:')) navigate('folder:' + key.slice(2)); else view.openMedia(key.slice(2)) }
    function choose(key, event) {
      const tab = browser.tab(), idx = entries.findIndex(item => item.key === key), anchor = entries.findIndex(item => item.key === tab.anchor)
      if (event.shiftKey && anchor >= 0) { if (!event.ctrlKey && !event.metaKey) tab.selected.clear(); for (let i = Math.min(idx, anchor); i <= Math.max(idx, anchor); i++) tab.selected.add(entries[i].key) }
      else if (event.ctrlKey || event.metaKey) { if (tab.selected.has(key)) tab.selected.delete(key); else tab.selected.add(key); tab.anchor = key }
      else { tab.selected = new Set([key]); tab.anchor = key }
      paintSelection(); grid.focus({ preventScroll: true })
    }
    function makeTile(entry) {
      const item = entry.folder || entry.asset, tile = el('div', { class: 'asset-tile', draggable: true, role: 'gridcell', tabIndex: -1 })
      const picture = el('div', { class: 'asset-picture' }), name = el('strong'), detail = el('small')
      const record = { tile, picture, name, detail, entry, media: null, release: null }
      tile.dataset.key = entry.key
      if (entry.folder) picture.append(el('span', { class: 'asset-folder-icon' }, '▱'))
      else {
        const video = session.mediaKind(item) === 'video', media = el('img', { draggable: false, alt: item.name })
        record.media = media; record.video = video; tile.dataset.kind = video ? 'video' : 'image'
        if (video) {
          media.hidden = true
          record.placeholder = el('span', { class: 'asset-video-placeholder', 'aria-hidden': true }, '▷')
          record.badge = el('span', { class: 'asset-video-tag' })
          picture.append(record.placeholder, media, record.badge)
        } else { media.src = view.imageUrl(item.id, 'small'); picture.append(media) }
        record.star = button('☆', event => {
          event.stopPropagation()
          const favorite = data.collections.find(collection => collection.id === 'favorites')?.assetIds.includes(item.id)
          return mutate({ type: favorite ? 'uncollect' : 'collect', collectionId: 'favorites', ids: [item.id] })
        }, 'asset-star')
        picture.append(record.star)
      }
      tile.append(picture, name, detail)
      tile.onclick = event => { if (!event.target.closest('button')) choose(entry.key, event) }
      tile.ondblclick = event => { if (!event.target.closest('button') && browser.tab().location !== 'trash') activate(entry.key) }
      tile.oncontextmenu = event => { event.preventDefault(); if (!browser.tab().selected.has(entry.key)) choose(entry.key, {}); showMenu(event.clientX, event.clientY) }
      tile.ondragstart = event => { if (!browser.tab().selected.has(entry.key)) choose(entry.key, {}); beginDrag(event, selectedParts(browser.tab())) }
      tile.ondragend = () => selections.clear()
      if (entry.folder) dropTarget(tile, () => 'folder:' + item.id)
      return record
    }
    function measureGrid() {
      const width = grid.clientWidth || (floating ? 550 : 240)
      gap = browser.compact ? 4 : 10; padding = browser.compact ? 4 : 8
      columns = Math.max(1, Math.floor((width - padding * 2) / (browser.size + gap)))
      cellWidth = (width - padding * 2) / columns
      rowHeight = browser.compact ? cellWidth : browser.size + 57
      return width
    }
    function renderGrid(force = false) {
      if (!visible()) { clearPreview(); renderedRange = ''; return }
      const width = measureGrid(), height = grid.clientHeight || 500, totalRows = Math.ceil(entries.length / columns)
      canvas.style.height = Math.max(totalRows * rowHeight, 80) + 'px'
      const first = Math.max(0, Math.floor(grid.scrollTop / rowHeight) - 2), last = Math.min(totalRows, Math.ceil((grid.scrollTop + height) / rowHeight) + 2)
      const range = [first, last, columns, browser.size, width, browser.compact].join(':')
      if (!force && renderedRange === range) return
      renderedRange = range
      const shown = entries.slice(first * columns, last * columns), keys = new Set(shown.map(entry => entry.key))
      for (const key of mounted) if (!keys.has(key)) { detach(tileCache.get(key)); mounted.delete(key) }
      let empty = canvas.querySelector('.asset-empty')
      if (entries.length) empty?.remove()
      else if (!empty) { empty = el('p', { class: 'asset-empty' }, '这里还没有素材。可以上传、拖入，或调整筛选条件。'); canvas.append(empty) }
      const favorites = new Set(data.collections.find(item => item.id === 'favorites')?.assetIds || [])
      let cursor = canvas.firstElementChild
      for (let offset = 0; offset < shown.length; offset++) {
        const entry = shown[offset], item = entry.folder || entry.asset, i = first * columns + offset
        const record = tileCache.get(entry.key) || makeTile(entry), { tile, picture, name, detail, media, star } = record
        record.entry = entry; tileCache.delete(entry.key); tileCache.set(entry.key, record)
        const info = entry.folder ? '文件夹' : (item.width || '?') + ' × ' + (item.height || '?')
        if (name.textContent !== item.name) name.textContent = item.name
        if (detail.textContent !== info) detail.textContent = info
        tile.title = item.name + ' · ' + info + (record.video ? ' · ' + Number(item.duration || 0).toFixed(1) + 's' : '')
        tile.setAttribute('aria-label', tile.title)
        Object.assign(tile.style, { left: (i % columns) * cellWidth + padding + 'px', top: Math.floor(i / columns) * rowHeight + 'px', width: cellWidth - gap + 'px', height: rowHeight - gap + 'px' })
        picture.style.height = browser.compact ? '100%' : browser.size + 'px'
        if (media) media.alt = item.name
        if (star) { star.textContent = favorites.has(item.id) ? '★' : '☆'; star.title = favorites.has(item.id) ? '取消收藏' : '收藏' }
        if (record.video) {
          record.badge.textContent = '▷ ' + Number(item.duration || 0).toFixed(1) + 's'
          if (!media.getAttribute('src') && !record.release) record.release = thumbnails.request(session.mediaUrl(item), src => {
            if (!src) return
            media.src = src; media.hidden = false; record.placeholder.hidden = true
          })
        }
        // Only insert incoming tiles. Overlapping rows keep their actual image nodes.
        if (tile === cursor) cursor = cursor.nextElementSibling
        else canvas.insertBefore(tile, cursor)
        mounted.add(entry.key)
      }
      // Keep a small LRU of detached, already decoded thumbnails for back-scrolling.
      const limit = Math.max(160, mounted.size + 32)
      for (const [key, record] of tileCache) {
        if (tileCache.size <= limit) break
        if (!mounted.has(key)) { detach(record); tileCache.delete(key) }
      }
      paintSelection()
    }
    function scheduleGrid() { if (!browser.frame) browser.frame = window.requestAnimationFrame(() => { browser.frame = null; renderGrid() }) }
    browser.repaint = () => renderGrid()
    grid.onscroll = () => { browser.tab().scroll = grid.scrollTop; scheduleGrid(); persist() }
    grid.oncontextmenu = event => { event.preventDefault(); if (!event.target.closest('[data-key]')) showMenu(event.clientX, event.clientY) }
    grid.addEventListener('wheel', event => { if (!event.ctrlKey) return; event.preventDefault(); event.stopPropagation(); setSize(browser.size + (event.deltaY < 0 ? 12 : -12)) }, { passive: false })
    function setSize(size) {
      relayout(() => { browser.size = clamp(size, 72, 256); zoom.value = String(browser.size) })
    }
    function setCompact(compact) {
      if (compact === browser.compact) return
      dismissMenu()
      relayout(() => {
        browser.modeSizes[browser.compact ? 'compact' : 'full'] = { width: browser.geometry.width, height: browser.geometry.height }
        browser.compact = compact; root.classList.toggle('asset-compact', compact)
        const size = browser.modeSizes[compact ? 'compact' : 'full']
        if (size) Object.assign(browser.geometry, size)
        positionWindow(false)
      })
    }
    function relayout(change) {
      const topItem = Math.floor(grid.scrollTop / rowHeight) * columns, fraction = (grid.scrollTop % rowHeight) / rowHeight
      change(); measureGrid()
      canvas.style.height = Math.max(Math.ceil(entries.length / columns) * rowHeight, 80) + 'px'
      grid.scrollTop = (Math.floor(topItem / columns) + fraction) * rowHeight; browser.tab().scroll = grid.scrollTop
      renderGrid(true); persist()
    }
    zoom.oninput = () => setSize(Number(zoom.value))
    search.oninput = () => { browser.tab().query = search.value; browser.tab().scroll = 0; updateEntries(true); persist() }
    scope.onchange = () => { browser.tab().global = scope.checked; updateEntries(true); persist() }
    kind.onchange = () => { browser.tab().kind = kind.value; updateEntries(true); persist() }
    sort.onchange = () => { browser.tab().sort = sort.value; updateEntries(true); persist() }
    function updateEntries(reset = false) {
      entries = matching(); const tab = browser.tab(), keys = new Set(entries.map(item => item.key))
      for (const [key, record] of tileCache) {
        if (key.startsWith('a:') ? !session.state.assets[key.slice(2)] : !data.folders.some(item => item.id === key.slice(2))) {
          detach(record); mounted.delete(key); tileCache.delete(key)
        }
      }
      tab.selected = new Set([...tab.selected].filter(key => keys.has(key)))
      if (reset) tab.scroll = 0
      measureGrid()
      canvas.style.height = Math.max(Math.ceil(entries.length / columns) * rowHeight, 80) + 'px'
      grid.scrollTop = tab.scroll; renderGrid(true)
    }
    browser.update = () => {
      if (stopped) return
      const tab = browser.tab()
      if (data.revision >= 0 && ((tab.location.startsWith('folder:') && !data.folders.some(item => item.id === tab.location.slice(7) && !item.trashedAt)) || (tab.location.startsWith('collection:') && !data.collections.some(item => item.id === tab.location.slice(11))))) { tab.location = 'root'; tab.selected.clear(); tab.scroll = 0 }
      drawTabs(); drawTree(); drawPath()
      if (search.value !== tab.query) search.value = tab.query
      scope.checked = tab.global; kind.value = tab.kind; sort.value = tab.sort
      actionButtons.get('undo').disabled = !data.undoLabel; actionButtons.get('undo').title = data.undoLabel
      actionButtons.get('redo').disabled = !data.redoLabel; actionButtons.get('redo').title = data.redoLabel
      updateEntries()
    }
    function beginDrag(event, parts) {
      const token = crypto.randomUUID(); selections.clear(); selections.set(token, parts)
      event.dataTransfer.setData(DRAG, token); event.dataTransfer.effectAllowed = 'copyMove'
      if (parts.ids.length) { event.dataTransfer.setData(SINGLE, parts.ids[0]); event.dataTransfer.setData(MULTI, JSON.stringify(parts.ids)) }
    }
    function dropTarget(target, location) {
      target.ondragover = event => { if (event.dataTransfer.types.includes(DRAG) || event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.stopPropagation(); target.classList.add('drop-target') } }
      target.ondragleave = () => target.classList.remove('drop-target')
      target.ondrop = safe(async event => {
        event.preventDefault(); event.stopPropagation(); target.classList.remove('drop-target')
        const parts = selections.get(event.dataTransfer.getData(DRAG)), loc = location()
        if (parts) await transfer(parts, loc)
        else if (event.dataTransfer.files.length) await uploadFiles([...event.dataTransfer.files], loc)
      })
    }
    dropTarget(grid, () => browser.tab().location)
    function dismissMenu() {
      menu?.remove(); menu = null; tabSwitch.setAttribute('aria-expanded', 'false')
      for (const dispose of dialogCleanups) dispose(); dialogCleanups = []
    }
    function placeMenu(x, y) {
      const rect = menu.getBoundingClientRect()
      menu.style.left = clamp(x, 8, Math.max(8, (window.innerWidth || 1280) - (rect.width || 210) - 8)) + 'px'
      menu.style.top = clamp(y, 8, Math.max(8, (window.innerHeight || 800) - rect.height - 8)) + 'px'
    }
    function showSimpleMenu(event, items) {
      dismissMenu()
      menu = el('div', { class: 'asset-context-menu', role: 'menu' }); root.append(menu)
      for (const [label, run] of items) menu.append(button(label, async () => { dismissMenu(); await run() }))
      placeMenu(event.clientX, event.clientY)
      menu.onkeydown = event => {
        event.stopPropagation()
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismissMenu(); tabSwitch.focus() }
        else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); event.stopPropagation()
          const buttons = [...menu.querySelectorAll('button')], index = buttons.indexOf(document.activeElement)
          buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
        }
      }
      const dismiss = e => { if (menu && !menu.contains(e.target) && !tabSwitch.contains(e.target)) dismissMenu() }
      window.addEventListener('pointerdown', dismiss); dialogCleanups.push(() => window.removeEventListener('pointerdown', dismiss))
    }
    function showMenu(x, y) {
      const tab = browser.tab(), chosen = [...tab.selected], items = []
      if (chosen.length === 1 && chosen[0].startsWith('f:') && tab.location !== 'trash') items.push(['在新 Tab 打开', () => addTab('folder:' + chosen[0].slice(2))], ['在新窗口打开', () => open('folder:' + chosen[0].slice(2))])
      if (chosen.length === 1 && chosen[0].startsWith('a:')) items.push(['预览', () => view.openMedia(chosen[0].slice(2))])
      const commands = tab.location === 'trash' ? [['restore', '恢复所选'], ['purge', '永久删除素材']] : [['cut', '剪切'], ['copy', '复制引用'], ['paste', '粘贴'], ['rename', '重命名'], ['move', '移动到…'], ['collect', '加入收藏集'], ...(tab.location.startsWith('collection:') ? [['uncollect', '从此收藏集移除']] : []), ['download', '下载所选'], ['trash', '移入回收站']]
      for (const [id, label] of commands) items.push([label, () => command(browser, id)])
      if (data.undoLabel) items.push(['撤销：' + data.undoLabel, () => command(browser, 'undo')])
      if (data.redoLabel) items.push(['重做：' + data.redoLabel, () => command(browser, 'redo')])
      showSimpleMenu({ clientX: x, clientY: y }, items)
    }
    // Rectangle selection is calculated from row geometry, including virtualized rows.
    grid.onpointerdown = event => {
      if (event.button !== 0 || event.target.closest('[data-key]')) return
      const rect = grid.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top + grid.scrollTop, tab = browser.tab(), original = event.ctrlKey || event.metaKey ? new Set(tab.selected) : new Set()
      const box = el('div', { class: 'asset-selection-box' }); canvas.append(box); grid.focus()
      const move = e => {
        if (e.clientY > rect.bottom - 20) grid.scrollTop += 16; else if (e.clientY < rect.top + 20) grid.scrollTop -= 16
        const ex = e.clientX - rect.left, ey = e.clientY - rect.top + grid.scrollTop, left = Math.min(x, ex), top = Math.min(y, ey), right = Math.max(x, ex), bottom = Math.max(y, ey)
        if (!box.isConnected) canvas.append(box)
        Object.assign(box.style, { left: left + 'px', top: top + 'px', width: right - left + 'px', height: bottom - top + 'px' }); tab.selected = new Set(original)
        entries.forEach((item, idx) => { const l = (idx % columns) * cellWidth + padding, t = Math.floor(idx / columns) * rowHeight; if (l < right && l + cellWidth - gap > left && t < bottom && t + rowHeight - gap > top) tab.selected.add(item.key) }); paintSelection()
      }
      const finish = () => { box.remove(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish); browser.cancelGesture = null }
      browser.cancelGesture?.(); browser.cancelGesture = finish
      tab.selected = original; paintSelection(); window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish)
    }
    function positionWindow(repaint = true) {
      const width = window.innerWidth || 1280, height = window.innerHeight || 800
      if (browser.maximized) Object.assign(root.style, { left: '8px', top: '64px', width: width - 16 + 'px', height: height - 72 + 'px' })
      else {
        const g = browser.geometry; g.width = clamp(g.width, Math.min(browser.compact ? 220 : 380, width - 16), width - 16); g.height = clamp(g.height, Math.min(browser.compact ? 180 : 380, height - 72), height - 72); g.x = clamp(g.x, 0, width - g.width); g.y = clamp(g.y, 58, Math.max(58, height - g.height))
        Object.assign(root.style, { left: g.x + 'px', top: g.y + 'px', width: g.width + 'px', height: g.height + 'px' })
      }
      if (repaint) renderGrid()
    }
    if (floating) {
      for (const direction of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) { const handle = el('div', { class: 'asset-window-resize resize-' + direction }); handle.dataset.resize = direction; root.append(handle) }
      root.addEventListener('pointerdown', event => {
        const dir = event.target.dataset.resize, moving = (head.contains(event.target) || (browser.compact && topLine.contains(event.target))) && !event.target.closest('button,.asset-tab')
        if ((!dir && !moving) || event.button !== 0 || browser.maximized) return
        event.preventDefault(); dismissMenu(); const start = { ...browser.geometry, x0: event.clientX, y0: event.clientY }
        const move = e => {
          const dx = e.clientX - start.x0, dy = e.clientY - start.y0, g = browser.geometry
          if (moving) { g.x = start.x + dx; g.y = start.y + dy }
          else {
            g.width = Math.max(browser.compact ? 220 : 380, start.width + (dir.includes('w') ? -dx : dir.includes('e') ? dx : 0)); g.height = Math.max(browser.compact ? 180 : 380, start.height + (dir.includes('n') ? -dy : dir.includes('s') ? dy : 0))
            if (dir.includes('w')) g.x = start.x + start.width - g.width
            if (dir.includes('n')) g.y = start.y + start.height - g.height
          }
          positionWindow()
        }
        const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); browser.cancelGesture = null; persist() }
        browser.cancelGesture?.(); browser.cancelGesture = end; window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end)
      })
      positionWindow(); browser.focus()
    }
    browser.position = positionWindow
    if (typeof window.ResizeObserver === 'function') { browser.resizeObserver = new window.ResizeObserver(() => renderGrid()); browser.resizeObserver.observe(grid) }
    const destroy = browser.destroy; browser.destroy = () => { for (const off of dialogCleanups) off(); destroy() }
    browser.update(); return browser
  }
  let saved = {}
  try { saved = JSON.parse(sdk.storage.local.getItem(STORAGE) || '{}') || {} } catch {}
  const side = makeBrowser({ saved: saved.side || {} })
  function open(location = 'all', state = {}) { const browser = makeBrowser({ floating: true, location, saved: state }); persist(); void load().catch(error => sdk.toast(error.message)); return browser }
  for (const state of (Array.isArray(saved.windows) ? saved.windows : []).slice(0, 12)) open('all', state)
  const expand = button('↗', () => open(side.tab().location), 'studio-asset-expand'); expand.title = '打开独立素材窗口'
  const upload = button('＋', () => chooseFiles(side.tab().location)); upload.title = '上传素材到当前目录'
  view.assetHeader.append(expand, upload); view.assetsList.hidden = true; view.assetsTools.hidden = true
  function refresh() { const changed = index(); view.assetCount.textContent = String(assets.filter(item => !item.meta.trashedAt).length); for (const browser of browsers) changed ? browser.update() : browser.repaint() }
  const sync = () => { if (!stopped && !document.hidden) void load().catch(error => sdk.toast(error.message)) }
  listen(window, 'focus', sync); listen(document, 'visibilitychange', () => { refresh(); sync() }); listen(window, 'resize', () => { for (const browser of windows) browser.position() })
  if (channel) listen(channel, 'message', sync)
  const timer = setInterval(() => { if (!document.hidden && (windows.size || !view.sideAssets.hidden)) void api('/revision').then(result => { if (result.revision !== data.revision) return load() }).catch(() => {}) }, 2500)
  void load().catch(error => sdk.toast(error.message))
  view.extend(ctx, 'assets', { refresh, dispose() { stopped = true; clearTimeout(saving); clearInterval(timer); for (const dialog of dialogs) dialog.close(); for (const off of cleanups) off(); channel?.close(); thumbnails.dispose(); for (const browser of [...browsers]) browser.destroy(); expand.remove(); upload.remove(); view.assetsList.hidden = false; view.assetsTools.hidden = false } })
  return { open, refresh, load }
}
