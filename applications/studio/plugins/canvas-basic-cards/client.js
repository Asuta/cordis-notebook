import { renderPending } from './pending.js'

const ASSET_DRAG_TYPE = 'application/x-cordis-studio-asset'

export default function (ctx, sdk) {
  const s = ctx.canvasSession, view = ctx.canvasUI
  const { el, button, safe, edit, imageUrl, position, coordinates, stage, add } = view
  const api = (path, body) => sdk.request('/api/studio' + path, body === undefined ? 'GET' : 'POST', body)
  const { rememberAsset, mediaKind, mediaUrl, uploadMedia } = s, uuid = () => crypto.randomUUID()
  async function storeAsset(file) {
    const targetBoard = s.boardId, uploaded = await uploadMedia(file, sdk.signal)
    if (sdk.signal?.aborted) throw Error('图片卡片插件已停止')
    return { targetBoard, asset: rememberAsset(uploaded) }
  }
  async function upload(file, extra = {}) {
    const { targetBoard, asset } = await storeAsset(file)
    await edit([{ type: 'add', node: { id: uuid(), type: mediaKind(asset), title: file.name, assetId: asset.id, ...position(), ...extra } }], { targetBoard })
    return asset
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
  sdk.listen(window, 'paste', safe(async event => { if (event.target.closest('input,textarea')) return; const files = [...event.clipboardData.files]; if (files.length) { event.preventDefault(); for (const file of files) await upload(file) } }))

  view.root.append(fileInput, videoInput, assetInput)
  view.menu(ctx, { id: 'text', label: '＋ 文字', order: 10, run: () => add('text') })
  view.menu(ctx, { id: 'image', label: '↑ 图片', order: 20, run: () => fileInput.click() })
  view.menu(ctx, { id: 'video', label: '↑ 视频', order: 40, run: () => videoInput.click() })
  view.register(ctx, { id: 'text', label: '文字灵感', icon: 'T', output: true, height: 230,
    actions: [{ label: '编辑文字', run: node => view.cards.querySelector(`[data-node="${node.id}"] textarea`)?.focus() }],
    render(node, card) { card.append(view.field(node, 'text', true)) },
  })
  view.register(ctx, { id: 'image', label: '图片', icon: '▧', output: true, height: 360,
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
    render(node, card) {
      const unplayed = !!node.sourceNodeId && node.played !== true, head = card.querySelector('.studio-card-head');
      card.classList.toggle('is-unplayed', unplayed);
      head.querySelector('.studio-video-unplayed')?.remove();
      if (unplayed) head.insertBefore(el('span', { class: 'studio-video-unplayed' }, '未播放'), head.lastElementChild);
      if (renderPending(node, card, view, s)) return
      const asset = s.state.assets[node.assetId], player = el('video', { src: asset ? mediaUrl(asset) : '', preload: 'metadata', playsInline: true, draggable: false, 'aria-label': node.title + ' 视频播放' })
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
      function togglePlay() { if (player.paused || player.ended) void player.play().catch(() => {}); else player.pause() }
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

  let assetQuery = '', assetKind = 'all', assetSort = 'newest'
  const assetFilters = new Map()
  const assetManager = el('dialog', { class: 'studio-asset-manager', 'aria-label': '素材库' })
  const assetManagerGrid = el('div', { class: 'studio-asset-manager-grid' })
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

  function createAssetFilters(className) {
    const group = el('div', { class: 'studio-asset-filters ' + className, role: 'group', 'aria-label': '素材类型' }), entries = []
    for (const [value, label, icon] of [['all', '全部', '◫'], ['image', '图片', '▧'], ['video', '视频', '▷']]) {
      const filter = button(icon + ' ' + label, () => { assetKind = value; syncAssetControls(); drawAssets() }, 'studio-asset-filter')
      filter.dataset.kind = value; filter.setAttribute('aria-pressed', String(value === assetKind)); entries.push(filter); group.append(filter)
      if (!assetFilters.has(value)) assetFilters.set(value, [])
      assetFilters.get(value).push(filter)
    }
    return { group, entries }
  }
  const assetFiltersCompact = createAssetFilters('is-compact'), assetFiltersManager = createAssetFilters('is-manager')

  function syncAssetControls() {
    for (const search of [assetSearch, managerSearch]) { if (search.input.value !== assetQuery) search.input.value = assetQuery; search.clear.hidden = !assetQuery }
    for (const [kind, filters] of assetFilters) for (const filter of filters) {
      const active = kind === assetKind; filter.classList.toggle('is-active', active); filter.setAttribute('aria-pressed', String(active))
    }
    assetManagerSort.value = assetSort
  }

  const assetTypeLabel = asset => mediaKind(asset) === 'video' ? '视频' : '图片'
  function assetSummary(asset) {
    const type = mediaKind(asset)
    if (type === 'video') return `${Number(asset.duration || 0).toFixed(1)} 秒 · ${asset.width || '?'} × ${asset.height || '?'}`
    return asset.width && asset.height ? `${asset.width} × ${asset.height}` : '图片素材'
  }
  function matchingAssets() {
    const query = assetQuery.toLocaleLowerCase('zh-CN')
    return Object.values(s.state.assets).filter(asset => {
      if (assetKind !== 'all' && mediaKind(asset) !== assetKind) return false
      if (!query) return true
      return [asset.name, assetTypeLabel(asset), asset.width, asset.height, asset.extension, asset.mimeType].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN').includes(query)
    }).sort((left, right) => {
      if (assetSort === 'name') return String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN', { numeric: true, sensitivity: 'base' })
      const delta = (Number(left.createdAt) || 0) - (Number(right.createdAt) || 0)
      return assetSort === 'oldest' ? delta : -delta
    })
  }
  function createAssetCard(asset, detailed = false) {
    const type = mediaKind(asset), label = assetTypeLabel(asset), card = button('', () => view.openMedia(asset.id), 'studio-asset-card' + (detailed ? ' is-detailed' : ''))
    card.dataset.asset = asset.id; card.draggable = true; card.title = `单击放大预览，拖到画布添加：${asset.name}`
    card.setAttribute('aria-label', `预览${label}：${asset.name}`)
    card.ondragstart = event => {
      card.classList.add('is-dragging'); event.dataTransfer.effectAllowed = 'copy'
      event.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id); event.dataTransfer.setData('text/plain', asset.name)
    }
    card.ondragend = () => card.classList.remove('is-dragging')
    const media = el('span', { class: 'studio-asset-card-media' })
    media.append(el(type === 'video' ? 'video' : 'img', type === 'video'
      ? { src: mediaUrl(asset), preload: 'metadata', muted: true, playsInline: true, draggable: false }
      : { src: mediaUrl(asset), alt: asset.name, loading: 'lazy', draggable: false }))
    media.append(el('span', { class: 'studio-asset-type', 'data-kind': type }, type === 'video' ? '▷' : '▧'))
    if (type === 'video') media.append(el('span', { class: 'studio-asset-duration' }, `${Number(asset.duration || 0).toFixed(1)}s`))
    const caption = el('span', { class: 'studio-asset-caption' })
    caption.append(el('strong', {}, asset.name || (type === 'video' ? '未命名视频' : '未命名图片')), el('small', {}, assetSummary(asset)))
    card.append(media, caption)
    return card
  }
  function drawAssets() {
    const total = Object.keys(s.state.assets).length, matches = matchingAssets(), compact = matches.slice(0, 6)
    view.assetCount.textContent = String(total)
    assetManagerCount.textContent = assetQuery || assetKind !== 'all' ? `${matches.length} / ${total} 项` : `共 ${total} 项素材`
    view.assetsList.replaceChildren()
    if (compact.length) view.assetsList.append(...compact.map(asset => createAssetCard(asset)))
    else {
      const emptyState = el('div', { class: 'studio-assets-empty' })
      emptyState.append(el('span', {}, total ? '⌕' : '＋'), el('strong', {}, total ? '没有匹配素材' : '素材库还是空的'), el('small', {}, total ? '换个关键词或类型试试' : '导入图片或视频后，会显示在这里'))
      view.assetsList.append(emptyState)
    }
    assetManagerGrid.replaceChildren(...matches.map(asset => createAssetCard(asset, true)))
    const nothing = !matches.length
    assetManagerEmpty.hidden = !nothing
    assetManagerEmpty.textContent = total ? '没有找到符合条件的素材。' : '还没有素材，可以先导入图片或视频。'
    assetAllButton.disabled = !total
    assetAllButton.textContent = matches.length > compact.length ? `查看全部 ${matches.length} 项 →` : '打开素材库 →'
  }

  const assetExpand = button('↗', () => openAssetManager(), 'studio-asset-expand')
  assetExpand.title = '打开完整素材库'; assetExpand.setAttribute('aria-label', '打开完整素材库')
  const assetImport = button('＋', () => assetInput.click(), 'studio-asset-import')
  assetImport.title = '导入图片或视频'; assetImport.setAttribute('aria-label', '导入图片或视频到素材库')
  view.assetHeader.append(assetExpand, assetImport)
  const assetFoot = el('div', { class: 'studio-assets-foot' }), assetAllButton = button('打开素材库 →', () => openAssetManager(), 'studio-assets-all')
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

  view.assetsTools.append(assetSearch.wrap, assetFiltersCompact.group)
  view.assetPanel.append(assetFoot)
  view.root.append(assetManager)
  assetManagerSort.onchange = () => { assetSort = assetManagerSort.value; drawAssets() }
  assetManager.onclick = event => { if (event.target === assetManager) assetManager.close() }
  function openAssetManager() { syncAssetControls(); drawAssets(); if (!assetManager.open) assetManager.showModal(); managerSearch.input.focus() }
  syncAssetControls()
  view.extend(ctx, 'assets', {
    refresh: drawAssets,
    dispose() {
      view.assetsList.replaceChildren(); view.assetsTools.replaceChildren(); view.assetCount.textContent = '0'
      assetExpand.remove(); assetImport.remove(); assetFoot.remove(); assetManager.remove()
      fileInput.remove(); videoInput.remove(); assetInput.remove()
    },
  })
}
