import { renderPending, pendingLabel } from './pending.js'
import { clipboardImages } from './clipboard.js'

const ASSET_DRAG_TYPE = 'application/x-cordis-studio-asset'

export default function (ctx, sdk) {
  const s = ctx.canvasSession, view = ctx.canvasUI
  const { el, button, safe, edit, imageUrl, position, coordinates, stage, add, board } = view
  const api = (path, body) => sdk.request('/api/studio' + path, body === undefined ? 'GET' : 'POST', body)
  const { rememberAsset, mediaKind, mediaUrl, uploadMedia } = s, uuid = () => crypto.randomUUID()
  let lightweightOverview = sdk.storage.local.getItem('studio-light-overview') !== '0'
  view.setOverviewEnabled(lightweightOverview)
  const overviewTitle = () => lightweightOverview ? '缩小到 32% 以下时自动简化卡片；放大到 38% 后恢复完整卡片' : '开启低倍率简化卡片'
  function syncLightweightButton() {
    const control = view.root.querySelector('.studio-light-overview-toggle')
    if (!control) return
    control.textContent = lightweightOverview ? '轻量总览：开' : '轻量总览：关'
    control.setAttribute('aria-pressed', String(lightweightOverview))
    control.title = overviewTitle()
  }
  const mediaObserver = typeof window.IntersectionObserver === 'function' ? new window.IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting && !document.hidden) loadVideo(entry.target)
  }, { rootMargin: '240px' }) : null
  function loadVideo(player) {
    if (!player?.dataset.src) return
    player.preload = 'metadata'; player.src = player.dataset.src; delete player.dataset.src
    mediaObserver?.unobserve(player)
  }
  function watchVideo(player, src, manual = false) {
    if (!player || !src) return
    player.dataset.src = src
    if (manual) return
    if (mediaObserver) mediaObserver.observe(player)
    else loadVideo(player)
  }
  function releaseVideo(player) {
    mediaObserver?.unobserve(player)
    player.pause()
    if (player.hasAttribute('src')) { player.removeAttribute('src'); player.load() }
  }
  function clearMedia(container) {
    for (const player of container.querySelectorAll('video')) {
      assetSideObserver?.unobserve(player); assetManagerObserver?.unobserve(player)
      releaseVideo(player)
    }
    for (const preview of container.querySelectorAll('img')) {
      assetSideObserver?.unobserve(preview); assetManagerObserver?.unobserve(preview)
      preview.removeAttribute('src')
    }
    container.replaceChildren()
  }
  const mediaRenderKey = node => [s.state.assets[node.assetId], !node.assetId ? [(s.state.jobs || []).find(job => job.id === node.jobId), s.state.providers, s.actions.list().map(action => action.id)] : null, view.isOverview()]
  const overviewMediaKey = node => [s.state.assets[node.assetId], (s.state.jobs || []).find(job => job.id === node.jobId)?.status, Boolean(s.actions.get('generate'))]
  async function storeAsset(file, targetBoard = s.boardId) {
    const uploaded = await uploadMedia(file, sdk.signal)
    if (sdk.signal?.aborted) throw Error('图片卡片插件已停止')
    return { targetBoard, asset: rememberAsset(uploaded) }
  }
  async function upload(file, extra = {}) {
    const { targetBoard, asset } = await storeAsset(file)
    await edit([{ type: 'add', node: { id: uuid(), type: mediaKind(asset), title: file.name, assetId: asset.id, ...position(), ...extra } }], { targetBoard })
    return asset
  }
  // 多图粘贴一次性提交，避免上传期间逐张出现、删除后又被后一张占回原位。
  async function pasteFiles(files, anchor, targetBoard) {
    if (files.length > 100) throw Error('一次最多粘贴 100 张图片')
    const uploaded = []
    for (const file of files) uploaded.push({ asset: (await storeAsset(file, targetBoard)).asset, name: file.name || '粘贴的图片.png' })
    const target = s.state.boards.find(board => board.id === targetBoard)
    if (!target) throw Error('粘贴目标画板已不存在')
    const occupied = target.nodes.map(node => ({ x: node.x, y: node.y })), base = anchor
    const operations = uploaded.map(({ asset, name }) => {
      const point = { x: Math.round(base.x), y: Math.round(base.y) }
      while (occupied.some(node => Math.abs(node.x - point.x) < 300 && Math.abs(node.y - point.y) < 280)) point.x += 340
      point.x = Math.max(-100000, Math.min(100000, point.x))
      point.y = Math.max(-100000, Math.min(100000, point.y))
      occupied.push({ ...point })
      return { type: 'add', node: { id: uuid(), type: mediaKind(asset), title: name, assetId: asset.id, ...point } }
    })
    await edit(operations, { targetBoard })
  }
  let pasteQueue = Promise.resolve()
  const queuePaste = work => {
    const task = pasteQueue.then(work, work)
    pasteQueue = task.catch(() => {})
    return task
  }
  const fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, hidden: true })
  fileInput.onchange = safe(async () => { for (const file of fileInput.files) await upload(file); fileInput.value = '' })
  const videoInput = el('input', { type: 'file', accept: 'video/mp4,video/webm', multiple: true, hidden: true })
  videoInput.onchange = safe(async () => { for (const file of videoInput.files) await upload(file); videoInput.value = '' })
  const assetInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,video/mp4,video/webm', multiple: true, hidden: true })
  assetInput.onchange = safe(async () => { for (const file of assetInput.files) await storeAsset(file); assetInput.value = '' })
  sdk.listen(stage, 'dragover', event => event.preventDefault())
  sdk.listen(stage, 'drop', safe(async event => {
    event.preventDefault()
    const asset = s.state.assets[event.dataTransfer.getData(ASSET_DRAG_TYPE)]
    if (asset) {
      const point = coordinates(event)
      await add(mediaKind(asset), { assetId: asset.id, title: asset.name, ...point }, { fit: false })
      return
    }
    let offset = 0
    for (const file of event.dataTransfer.files) { await upload(file, { ...coordinates(event), y: coordinates(event).y + offset }); offset += 50 }
  }))
  sdk.listen(window, 'paste', event => {
    if (event.defaultPrevented || event.target?.closest?.('input,textarea,[contenteditable="true"]')) return
    const files = clipboardImages(event.clipboardData)
    if (!files.length) return
    event.preventDefault()
    const point = { ...(view.pointer() || position()) }, targetBoard = s.boardId
    // 连续 Ctrl+V 也按批次排队，位置在上一批写入后再计算，避免叠在一起。
    void safe(() => queuePaste(() => pasteFiles(files, point, targetBoard)))(event)
  })

  view.root.append(fileInput, videoInput, assetInput)
  sdk.listen(document, 'visibilitychange', () => {
    for (const player of view.cards.querySelectorAll('video')) {
      if (document.hidden) {
        if (player.hasAttribute('src')) player.dataset.src = player.getAttribute('src')
        releaseVideo(player)
      } else if (player.dataset.src) {
        if (mediaObserver) mediaObserver.observe(player)
        else loadVideo(player)
      }
    }
  })
  view.menu(ctx, { id: 'text', label: '＋ 文字', order: 10, run: () => add('text') })
  view.menu(ctx, { id: 'image', label: '↑ 图片', order: 20, run: () => fileInput.click() })
  view.menu(ctx, { id: 'video', label: '↑ 视频', order: 40, run: () => videoInput.click() })
  view.menu(ctx, { id: 'lightweight-overview', label: () => lightweightOverview ? '轻量总览：开' : '轻量总览：关', title: overviewTitle, pressed: () => lightweightOverview, order: 50, className: 'studio-light-overview-toggle', run: () => {
    lightweightOverview = !lightweightOverview
    sdk.storage.local.setItem('studio-light-overview', lightweightOverview ? '1' : '0')
    syncLightweightButton(); view.setOverviewEnabled(lightweightOverview)
  } })
  syncLightweightButton()
  view.register(ctx, { id: 'text', label: '文字灵感', icon: 'T', output: true, height: 230,
    renderKey: () => null,
    renderOverview(node, card) { card.append(el('div', { class: 'studio-overview-summary' }, node.text || '文字灵感')) },
    actions: [{ label: '编辑文字', run: node => view.cards.querySelector(`[data-node="${node.id}"] textarea`)?.focus() }],
    render(node, card) { card.append(view.field(node, 'text', true)) },
  })
  view.register(ctx, { id: 'image', label: '图片', icon: '▧', output: true, height: 360,
    renderKey: mediaRenderKey,
    overviewKey: overviewMediaKey,
    renderOverview(node, card) {
      if (!s.state.assets[node.assetId]) { card.append(el('div', { class: 'studio-overview-placeholder' }, node.jobId ? pendingLabel(node, s) : '图片不可用')); return }
      const image = el('img', { class: 'studio-overview-image', src: imageUrl(node.assetId, 'small'), alt: node.title, draggable: false, loading: 'lazy' })
      image.ondblclick = event => { event.stopPropagation(); view.openMedia(node.assetId) }
      card.append(image)
    },
    actions: [{ label: '预览图片', run: node => view.openMedia(node.assetId) }],
    render(node, card) {
      if (renderPending(node, card, view, s)) return
      const asset = s.state.assets[node.assetId], image = el('img', { src: imageUrl(node.assetId), alt: node.title, draggable: false, loading: 'lazy' })
      image.title = '双击放大预览'
      image.ondblclick = event => { event.stopPropagation(); view.openMedia(node.assetId) }
      const foot = el('div', { class: 'studio-image-foot' })
      foot.append(el('small', {}, asset ? `${asset.width} × ${asset.height}` : '素材不可用'), button('预览', () => view.openMedia(node.assetId)), el('a', { href: imageUrl(node.assetId, false), download: (asset?.name || '图片') + '.png' }, '下载'))
      card.append(image, foot)
    },
  })
  view.register(ctx, { id: 'video', label: '视频', icon: '▷', output: true, height: 300, preserveDOM: node => Boolean(node.assetId),
    renderKey: mediaRenderKey,
    overviewKey: overviewMediaKey,
    renderOverview(node, card) {
      const asset = s.state.assets[node.assetId], preview = el('div', { class: 'studio-overview-placeholder studio-overview-video' })
      preview.append(el('span', {}, '▶'), el('small', {}, asset ? Number(asset.duration || 0).toFixed(1) + 's · 双击预览' : node.jobId ? pendingLabel(node, s) : '视频不可用'))
      if (asset) preview.ondblclick = event => { event.stopPropagation(); view.openMedia(node.assetId) }
      card.append(preview)
    },
    attachCard(node, card) { watchVideo(card.querySelector('video'), s.state.assets[node.assetId] ? mediaUrl(s.state.assets[node.assetId]) : '', view.isOverview()) },
    detachCard(node, card) { const player = card.querySelector('video'); if (player) releaseVideo(player) },
    render(node, card) {
      const unplayed = !!node.sourceNodeId && node.played !== true, head = card.querySelector('.studio-card-head');
      card.classList.toggle('is-unplayed', unplayed);
      head.querySelector('.studio-video-unplayed')?.remove();
      if (unplayed) head.insertBefore(el('span', { class: 'studio-video-unplayed' }, '未播放'), head.lastElementChild);
      if (renderPending(node, card, view, s)) return
      const asset = s.state.assets[node.assetId], player = el('video', { preload: 'none', playsInline: true, draggable: false, 'aria-label': node.title + ' 视频播放' })
      const surface = el('div', { class: 'studio-video-surface', title: '单击播放或暂停，按住拖动卡片' }), overlay = el('span', { class: 'studio-video-overlay', 'aria-hidden': 'true' }, '▶'), controls = el('div', { class: 'studio-video-controls' })
      const play = button('▶', () => togglePlay(), 'studio-video-play')
      const progress = el('input', { type: 'range', min: '0', max: '1000', step: '1', value: '0', 'aria-label': '视频进度' })
      const time = el('span', { class: 'studio-video-time' }, '0:00 / 0:00')
      const mute = button('🔊', () => { player.muted = !player.muted; syncPlayer() }, 'studio-video-mute')
      const volume = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: '1', 'aria-label': '音量' })
      const loop = button('循环', async () => {
        const next = !player.loop
        player.loop = next; syncPlayer()
        try {
          await edit([{ type: 'update', id: node.id, patch: { loop: next } }], { repaint: false })
          view.syncRenderedNode(node.id, { loop: next })
        } catch (error) { player.loop = !next; syncPlayer(); throw error }
      }, 'studio-video-loop')
      let seeking = false
      let playedPending = false
      const format = value => {
        const seconds = Math.max(0, Math.floor(Number(value) || 0)), minutes = Math.floor(seconds / 60)
        return minutes + ':' + String(seconds % 60).padStart(2, '0')
      }
      function syncPlayer() {
        const playing = !player.paused && !player.ended
        play.textContent = playing ? 'Ⅱ' : '▶'; play.setAttribute('aria-label', playing ? '暂停视频' : '播放视频')
        surface.classList.toggle('is-playing', playing)
        mute.textContent = player.muted || player.volume === 0 ? '🔇' : '🔊'; mute.setAttribute('aria-label', player.muted ? '取消静音' : '静音')
        volume.value = String(player.muted ? 0 : player.volume)
        loop.classList.toggle('is-active', player.loop); loop.setAttribute('aria-pressed', String(player.loop))
        loop.title = player.loop ? '关闭自动循环' : '开启自动循环'
        const duration = Number(player.duration) || 0
        if (!seeking) progress.value = duration ? String(player.currentTime / duration * 1000) : '0'
        time.textContent = format(player.currentTime) + ' / ' + format(duration)
      }
      function togglePlay() { loadVideo(player); if (player.paused || player.ended) void player.play().catch(() => {}); else player.pause() }
      async function markPlayed() {
        if (playedPending || !node.sourceNodeId || node.played === true) return
        playedPending = true
        try {
          await edit([{ type: 'update', id: node.id, patch: { played: true } }], { repaint: false })
          node.played = true
          card.classList.remove('is-unplayed')
          card.querySelector('.studio-video-unplayed')?.remove()
          view.syncRenderedNode(node.id, { played: true })
        } finally { playedPending = false }
      }
      player.loop = node.loop === true
      player.onplay = () => { syncPlayer(); void safe(markPlayed)() }; player.onpause = syncPlayer; player.onended = syncPlayer
      player.onloadedmetadata = syncPlayer
      player.ontimeupdate = syncPlayer
      player.onvolumechange = syncPlayer
      progress.oninput = () => { seeking = true; if (Number.isFinite(player.duration)) player.currentTime = Number(progress.value) / 1000 * player.duration; syncPlayer() }
      progress.onchange = () => { seeking = false; syncPlayer() }
      volume.oninput = () => { player.muted = Number(volume.value) === 0; player.volume = Number(volume.value); syncPlayer() }
      controls.append(play, progress, time, mute, volume, loop)
      surface.append(player, overlay, controls)
      surface.onclick = event => { if (!event.target.closest('button,input')) togglePlay() }
      const foot = el('div', { class: 'studio-image-foot' })
      foot.append(el('small', {}, asset ? `${asset.width} × ${asset.height} · ${Number(asset.duration || 0).toFixed(1)} 秒` : '素材不可用'), el('a', { href: asset ? mediaUrl(asset) : '', download: (asset?.name || '视频') + '.' + (asset?.extension || 'mp4') }, '下载视频'))
      card.append(surface, foot); syncPlayer()
    },
  })

  let assetQuery = '', assetKind = 'all', assetSort = 'newest', assetFavoriteOnly = false, managerFilter = 'favorites', disposed = false
  let favoriteIds = new Set(), favoriteLoad, favoriteOrder = [], favoriteVersion = 0
  const favoriteChannel = typeof window.BroadcastChannel === 'function' ? new window.BroadcastChannel('cordis-studio-asset-favorites') : null
  let sideSignature = '', managerSignature = '', sideMatches = [], managerMatches = [], sideLimit = 0, managerLimit = 0, sideWasVisible = false
  const assetBatchSize = 48
  const favoritePending = new Set()
  function promoteFavorite(id) {
    if (!favoriteIds.has(id)) return
    favoriteOrder = [id, ...favoriteOrder.filter(item => item !== id)]
    drawAssets()
  }
  async function loadFavorites(force = false) {
    if (!force && favoriteLoad) return favoriteLoad
    const version = ++favoriteVersion
    const request = api('/asset-favorites').then(result => {
      if (!disposed && version === favoriteVersion) {
        favoriteIds = new Set(result.assetIds || [])
        favoriteOrder = favoriteOrder.filter(id => favoriteIds.has(id))
        syncAssetControls(); drawAssets()
      }
      return favoriteIds
    }).catch(error => { if (favoriteLoad === request) favoriteLoad = undefined; throw error })
    favoriteLoad = request
    return favoriteLoad
  }
  async function toggleFavorite(asset) {
    if (favoritePending.has(asset.id)) return
    favoritePending.add(asset.id)
    try {
      const result = await api('/asset-favorites', { assetId: asset.id, favorite: !favoriteIds.has(asset.id) })
      if (disposed) return
      favoriteVersion++
      favoriteIds = new Set(result.assetIds || [])
      favoriteLoad = Promise.resolve(favoriteIds)
      favoriteOrder = favoriteOrder.filter(id => favoriteIds.has(id))
      syncAssetControls(); drawAssets()
      favoriteChannel?.postMessage('changed')
    } finally { favoritePending.delete(asset.id) }
  }
  const assetManager = el('dialog', { class: 'studio-asset-manager', 'aria-label': '素材库' })
  const assetManagerGrid = el('div', { class: 'studio-asset-manager-grid' })
  const observeAsset = root => typeof window.IntersectionObserver === 'function' ? new window.IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting && !document.hidden) {
      const preview = entry.target, src = preview.dataset.src
      if (src) {
        if (preview.tagName === 'VIDEO') loadVideo(preview)
        else { preview.src = src; delete preview.dataset.src }
      }
      (root === view.assetsList ? assetSideObserver : assetManagerObserver)?.unobserve(preview)
    }
  }, { root, rootMargin: '160px' }) : null
  const assetSideObserver = observeAsset(view.assetsList), assetManagerObserver = observeAsset(assetManagerGrid)
  function watchAssetPreview(preview, src, manager) {
    preview.dataset.src = src
    const observer = manager ? assetManagerObserver : assetSideObserver
    if (observer) observer.observe(preview)
    else if (preview.tagName === 'VIDEO') loadVideo(preview)
    else { preview.src = src; delete preview.dataset.src }
  }
  const assetManagerCount = el('small', { class: 'studio-asset-manager-count' })
  const assetManagerEmpty = el('p', { class: 'studio-asset-manager-empty' })
  const assetManagerSort = el('select', { 'aria-label': '素材排序' })
  for (const [value, label] of [['newest', '最近添加'], ['oldest', '最早添加'], ['name', '按名称排序']]) assetManagerSort.append(el('option', { value }, label))
  assetManagerSort.value = assetSort

  function createAssetSearch(label, className) {
    const wrap = el('div', { class: 'studio-asset-search ' + className }), input = el('input', { type: 'search', placeholder: '搜索素材', 'aria-label': label, autocomplete: 'off' })
    const icon = el('span', { class: 'studio-asset-search-icon', 'aria-hidden': 'true' }, '⌕'), clear = button('×', () => {
      assetQuery = ''; syncAssetControls(); drawAssets(); input.focus()
    }, 'studio-asset-search-clear')
    clear.title = '清除搜索'; clear.setAttribute('aria-label', '清除素材搜索'); clear.hidden = true
    input.oninput = () => { assetQuery = input.value.trim(); syncAssetControls(); drawAssets() }
    wrap.append(icon, input, clear)
    return { wrap, input, clear }
  }
  const assetSearch = createAssetSearch('搜索素材', 'is-compact'), managerSearch = createAssetSearch('在完整素材库中搜索', 'is-manager')

  function createAssetFilters(className, values, isManager = false) {
    const group = el('div', { class: 'studio-asset-filters ' + className, role: 'group', 'aria-label': '素材类型' }), entries = []
    for (const [value, label, icon] of values) {
      const filter = button(icon + ' ' + label, () => {
        if (isManager) managerFilter = value
        else assetKind = value
        syncAssetControls(); drawAssets()
      }, 'studio-asset-filter')
      filter.dataset.kind = value; entries.push(filter); group.append(filter)
    }
    return { group, entries }
  }
  const assetFiltersCompact = createAssetFilters('is-compact', [['all', '全部', '◫'], ['image', '图片', '▧'], ['video', '视频', '▷']])
  const assetFiltersManager = createAssetFilters('is-manager', [['favorites', '收藏', '★'], ['all', '全部', '◫'], ['image', '图片', '▧'], ['video', '视频', '▷']], true)
  const favoriteOnlyToggle = button('☆ 只看收藏', () => {
    assetFavoriteOnly = !assetFavoriteOnly
    syncAssetControls(); drawAssets()
  }, 'studio-asset-favorite-only')

  function syncAssetControls() {
    for (const search of [assetSearch, managerSearch]) { if (search.input.value !== assetQuery) search.input.value = assetQuery; search.clear.hidden = !assetQuery }
    favoriteOnlyToggle.classList.toggle('is-active', assetFavoriteOnly)
    favoriteOnlyToggle.setAttribute('aria-pressed', String(assetFavoriteOnly))
    favoriteOnlyToggle.textContent = (assetFavoriteOnly ? '★' : '☆') + ' 只看收藏' + (favoriteIds.size ? ' ' + favoriteIds.size : '')
    for (const filter of assetFiltersCompact.entries) {
      const active = filter.dataset.kind === assetKind; filter.classList.toggle('is-active', active); filter.setAttribute('aria-pressed', String(active))
    }
    for (const filter of assetFiltersManager.entries) {
      const active = filter.dataset.kind === managerFilter; filter.classList.toggle('is-active', active); filter.setAttribute('aria-pressed', String(active))
    }
    assetManagerSort.value = assetSort
  }

  const assetTypeLabel = asset => mediaKind(asset) === 'video' ? '视频' : '图片'
  function assetSummary(asset) {
    const type = mediaKind(asset)
    if (type === 'video') return `${Number(asset.duration || 0).toFixed(1)} 秒 · ${asset.width || '?'} × ${asset.height || '?'}`
    return asset.width && asset.height ? `${asset.width} × ${asset.height}` : '图片素材'
  }
  function matchingAssets({ favoritesOnly = false, kind = assetKind } = {}) {
    const query = assetQuery.toLocaleLowerCase('zh-CN')
    const sorted = Object.values(s.state.assets).filter(asset => {
      if (favoritesOnly && !favoriteIds.has(asset.id)) return false
      if (kind !== 'all' && mediaKind(asset) !== kind) return false
      if (!query) return true
      return [asset.name, assetTypeLabel(asset), asset.width, asset.height, asset.extension, asset.mimeType].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN').includes(query)
    }).sort((left, right) => {
      if (assetSort === 'name') return String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN', { numeric: true, sensitivity: 'base' })
      const delta = (Number(left.createdAt) || 0) - (Number(right.createdAt) || 0)
      return assetSort === 'oldest' ? delta : -delta
    })
    if (!favoritesOnly || !favoriteOrder.length) return sorted
    const byId = new Map(sorted.map(asset => [asset.id, asset])), ordered = []
    for (const id of favoriteOrder) {
      const asset = byId.get(id)
      if (!asset) continue
      ordered.push(asset); byId.delete(id)
    }
    for (const asset of sorted) if (byId.has(asset.id)) ordered.push(asset)
    return ordered
  }
  function createAssetCard(asset, detailed = false, favoritesView = false, manager = false) {
    const type = mediaKind(asset), label = assetTypeLabel(asset), card = button('', () => view.openMedia(asset.id), 'studio-asset-card')
    card.dataset.asset = asset.id; card.draggable = true; card.title = `单击放大预览，拖到画布添加：${asset.name}`
    card.setAttribute('aria-label', `预览${label}：${asset.name}`)
    card.ondragstart = event => {
      card.classList.add('is-dragging'); event.dataTransfer.effectAllowed = 'copy'
      event.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id); event.dataTransfer.setData('text/plain', asset.name)
    }
    card.ondragend = () => card.classList.remove('is-dragging')
    const media = el('span', { class: 'studio-asset-card-media' })
    const preview = el(type === 'video' ? 'video' : 'img', type === 'video'
      ? { preload: 'none', muted: true, playsInline: true, draggable: false }
      : { alt: asset.name, loading: 'lazy', draggable: false })
    media.append(preview)
    watchAssetPreview(preview, type === 'video' ? mediaUrl(asset) : imageUrl(asset.id, 'small'), manager)
    media.append(el('span', { class: 'studio-asset-type', 'data-kind': type }, type === 'video' ? '▷' : '▧'))
    if (type === 'video') media.append(el('span', { class: 'studio-asset-duration' }, `${Number(asset.duration || 0).toFixed(1)}s`))
    const caption = el('span', { class: 'studio-asset-caption' })
    caption.append(el('strong', {}, asset.name || (type === 'video' ? '未命名视频' : '未命名图片')), el('small', {}, assetSummary(asset)))
    card.append(media, caption)
    if (!detailed) return card
    const shell = el('div', { class: 'studio-asset-card-shell' }), favorite = favoriteIds.has(asset.id)
    const star = button(favorite ? '★' : '☆', () => toggleFavorite(asset), 'studio-asset-favorite' + (favorite ? ' is-active' : ''))
    star.dataset.favoriteAsset = asset.id
    star.setAttribute('aria-label', favorite ? `取消收藏：${asset.name}` : `收藏素材：${asset.name}`)
    star.setAttribute('aria-pressed', String(favorite))
    star.title = favorite ? '取消收藏' : '收藏到收藏页'
    star.ondragstart = event => event.stopPropagation()
    shell.append(card, star)
    if (favoritesView && favorite) {
      const top = favoriteOrder[0] === asset.id
      const promote = button('↑', () => promoteFavorite(asset.id), 'studio-asset-promote' + (top ? ' is-active' : ''))
      promote.dataset.promoteAsset = asset.id
      promote.setAttribute('aria-label', top ? `${asset.name} 已临时置顶` : `把 ${asset.name} 移到收藏列表第一位`)
      promote.setAttribute('aria-pressed', String(top))
      promote.title = top ? '已临时置顶' : '临时移到收藏第一位'
      promote.ondragstart = event => event.stopPropagation()
      shell.append(promote)
    }
    return shell
  }
  function appendAssetBatch(manager = false) {
    const list = manager ? assetManagerGrid : view.assetsList
    const matches = manager ? managerMatches : sideMatches
    const limit = manager ? managerLimit : sideLimit
    if (limit >= matches.length) return
    list.append(...matches.slice(limit, limit + assetBatchSize).map(asset => createAssetCard(asset, true, manager ? managerFilter === 'favorites' : assetFavoriteOnly, manager)))
    if (manager) managerLimit = Math.min(matches.length, limit + assetBatchSize)
    else sideLimit = Math.min(matches.length, limit + assetBatchSize)
  }
  function maybeAppendAssets(manager = false) {
    const list = manager ? assetManagerGrid : view.assetsList
    if ((manager ? assetManager.open : !view.sideAssets.hidden) && !document.hidden && list.scrollTop + list.clientHeight >= list.scrollHeight - 240) appendAssetBatch(manager)
  }
  function drawAssets({ force = false } = {}) {
    const assets = Object.values(s.state.assets), total = assets.length
    view.assetCount.textContent = String(total)
    assetAllButton.disabled = !total
    assetAllButton.textContent = '完整素材库 →'
    const sideVisible = !view.sideAssets.hidden && !document.hidden
    const managerVisible = assetManager.open && !document.hidden
    const sideOpened = sideVisible && !sideWasVisible
    sideWasVisible = sideVisible
    if (sideOpened) void loadFavorites(true).catch(error => { if (!disposed) sdk.toast(error.message) })
    if (!sideVisible && sideSignature) {
      clearMedia(view.assetsList); sideSignature = ''; sideMatches = []; sideLimit = 0
    }
    if (!managerVisible && managerSignature) {
      clearMedia(assetManagerGrid); managerSignature = ''; managerMatches = []; managerLimit = 0
    }
    if (!sideVisible && !managerVisible) return
    const shared = JSON.stringify([assets, assetQuery, assetSort, [...favoriteIds].sort(), favoriteOrder])
    const nextSide = JSON.stringify([shared, assetKind, assetFavoriteOnly])
    if (sideVisible && (force || nextSide !== sideSignature)) {
      const sideScroll = view.assetsList.scrollTop
      sideSignature = nextSide
      sideMatches = matchingAssets({ favoritesOnly: assetFavoriteOnly })
      clearMedia(view.assetsList); sideLimit = 0
      if (sideMatches.length) appendAssetBatch()
      else {
        const emptyState = el('div', { class: 'studio-assets-empty' })
        const emptyTitle = !total ? '素材库还是空的' : assetFavoriteOnly ? (assetQuery ? '没有匹配的收藏素材' : '还没有收藏素材') : (assetQuery ? '没有匹配素材' : '没有这个类型的素材')
        const emptyHint = !total ? '导入图片或视频后，会显示在这里' : assetFavoriteOnly ? '点击素材右上角的 ☆ 收藏，或关闭「只看收藏」' : '换个关键词或类型试试'
        emptyState.append(el('span', {}, total ? '⌕' : '＋'), el('strong', {}, emptyTitle), el('small', {}, emptyHint))
        view.assetsList.append(emptyState)
      }
      view.assetsList.scrollTop = sideScroll
    }
    if (!managerVisible) return
    const nextManager = JSON.stringify([shared, managerFilter])
    if (!force && nextManager === managerSignature) return
    const managerScroll = assetManagerGrid.scrollTop
    managerSignature = nextManager
    const managerKind = managerFilter === 'image' || managerFilter === 'video' ? managerFilter : 'all'
    const matches = managerMatches = matchingAssets({ favoritesOnly: managerFilter === 'favorites', kind: managerKind })
    assetManagerCount.textContent = managerFilter !== 'all' || assetQuery ? `${matches.length} / ${total} 项` : `共 ${total} 项素材`
    clearMedia(assetManagerGrid)
    managerLimit = 0; appendAssetBatch(true)
    const nothing = !matches.length
    assetManagerEmpty.hidden = !nothing
    assetManagerEmpty.textContent = !total
      ? '还没有素材，可以先导入图片或视频。'
      : managerFilter === 'favorites'
        ? (assetQuery ? '没有符合条件的收藏素材。' : '还没有收藏素材。切换到「全部」，点击素材右上角的 ☆ 收藏。')
        : '没有找到符合条件的素材。'
    assetManagerGrid.scrollTop = managerScroll
  }

  const assetExpand = button('↗', () => openAssetManager(), 'studio-asset-expand')
  assetExpand.title = '打开完整素材库'; assetExpand.setAttribute('aria-label', '打开完整素材库')
  const assetImport = button('＋', () => assetInput.click(), 'studio-asset-import')
  assetImport.title = '导入图片或视频'; assetImport.setAttribute('aria-label', '导入图片或视频到素材库')
  view.assetHeader.append(assetExpand, assetImport)
  const assetFoot = el('div', { class: 'studio-assets-foot' }), assetAllButton = button('完整素材库 →', () => openAssetManager(), 'studio-assets-all')
  assetAllButton.setAttribute('aria-label', '查看全部素材')
  assetFoot.append(el('span', {}, '单击预览 · 拖入画布'), assetAllButton)

  const managerHead = el('header', { class: 'studio-asset-manager-head' })
  const managerTitle = el('div', { class: 'studio-asset-manager-title' })
  managerTitle.append(el('h2', {}, '素材库'), assetManagerCount)
  managerHead.append(managerTitle, button('关闭', () => assetManager.close(), 'studio-asset-manager-close'))
  const managerControls = el('div', { class: 'studio-asset-manager-controls' })
  const managerFilterRow = el('div', { class: 'studio-asset-manager-filter-row' })
  const sortLabel = el('label', { class: 'studio-asset-sort' }); sortLabel.append(el('span', {}, '排序'), assetManagerSort)
  managerFilterRow.append(assetFiltersManager.group, sortLabel)
  managerControls.append(managerSearch.wrap, managerFilterRow)
  const managerFoot = el('footer', { class: 'studio-asset-manager-foot' })
  managerFoot.append(el('span', {}, '点击预览，或直接拖进画布'), button('＋ 导入素材', () => assetInput.click(), 'studio-primary'))
  assetManager.append(managerHead, managerControls, assetManagerGrid, assetManagerEmpty, managerFoot)

  view.assetsTools.append(assetSearch.wrap, assetFiltersCompact.group, favoriteOnlyToggle)
  view.assetPanel.append(assetFoot)
  view.root.append(assetManager)
  sdk.listen(view.assetsList, 'scroll', () => maybeAppendAssets())
  sdk.listen(assetManagerGrid, 'scroll', () => maybeAppendAssets(true))
  assetManagerSort.onchange = () => { assetSort = assetManagerSort.value; drawAssets() }
  assetManager.onclick = event => { if (event.target === assetManager) assetManager.close() }
  sdk.listen(assetManager, 'close', () => { clearMedia(assetManagerGrid); managerSignature = ''; managerMatches = []; managerLimit = 0; drawAssets() })
  async function openAssetManager() {
    managerFilter = 'favorites'
    try { await loadFavorites(true) } catch (error) { if (!disposed) sdk.toast(error.message) }
    if (disposed) return
    syncAssetControls(); if (!assetManager.open) assetManager.showModal(); managerSignature = ''; drawAssets(); managerSearch.input.focus()
  }
  const refreshVisibleFavorites = () => {
    if (disposed || document.hidden || (view.sideAssets.hidden && !assetManager.open)) return
    void loadFavorites(true).catch(error => { if (!disposed) sdk.toast(error.message) })
  }
  sdk.listen(window, 'focus', refreshVisibleFavorites)
  sdk.listen(document, 'visibilitychange', refreshVisibleFavorites)
  if (favoriteChannel) {
    sdk.listen(favoriteChannel, 'message', refreshVisibleFavorites)
    ctx.effect(() => () => favoriteChannel.close())
  }
  syncAssetControls()
  void loadFavorites().catch(() => {})
  view.extend(ctx, 'assets', {
    refresh: drawAssets,
    dispose() {
      disposed = true; favoriteIds = new Set()
      clearMedia(view.assetsList); clearMedia(assetManagerGrid)
      mediaObserver?.disconnect(); assetSideObserver?.disconnect(); assetManagerObserver?.disconnect()
      view.assetsTools.replaceChildren(); view.assetCount.textContent = '0'
      assetExpand.remove(); assetImport.remove(); assetFoot.remove(); assetManager.remove()
      fileInput.remove(); videoInput.remove(); assetInput.remove()
    },
  })
}
