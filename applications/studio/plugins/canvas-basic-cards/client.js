import { renderPending } from './pending.js'

const ASSET_DRAG_TYPE = 'application/x-cordis-studio-asset'

export default function (ctx, sdk) {
  const s = ctx.canvasSession, view = ctx.canvasUI
  const { el, button, safe, edit, imageUrl, position, coordinates, stage, add } = view
  const api = (path, body) => sdk.request('/api/studio' + path, body === undefined ? 'GET' : 'POST', body)
  const { rememberAsset, mediaKind, mediaUrl, uploadMedia } = s, uuid = () => crypto.randomUUID()
  async function upload(file, extra = {}) {
    const targetBoard = s.boardId, uploaded = await uploadMedia(file, sdk.signal)
    if (sdk.signal?.aborted) throw Error('图片卡片插件已停止')
    const asset = rememberAsset(uploaded)
    await edit([{ type: 'add', node: { id: uuid(), type: mediaKind(asset), title: file.name, assetId: asset.id, ...position(), ...extra } }], { targetBoard })
    return asset
  }
  const fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, hidden: true })
  fileInput.onchange = safe(async () => { for (const file of fileInput.files) await upload(file); fileInput.value = '' })
  const videoInput = el('input', { type: 'file', accept: 'video/mp4,video/webm', multiple: true, hidden: true })
  videoInput.onchange = safe(async () => { for (const file of videoInput.files) await upload(file); videoInput.value = '' })
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

  view.root.append(fileInput, videoInput)
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
  view.register(ctx, { id: 'video', label: '视频', icon: '▷', output: true, height: 300,
    render(node, card) {
      if (renderPending(node, card, view, s)) return
      const asset = s.state.assets[node.assetId], player = el('video', { src: asset ? mediaUrl(asset) : '', controls: true, preload: 'metadata', playsInline: true, 'aria-label': node.title + ' 视频播放' })
      const foot = el('div', { class: 'studio-image-foot' })
      foot.append(el('small', {}, asset ? `${asset.width} × ${asset.height} · ${Number(asset.duration || 0).toFixed(1)} 秒` : '素材不可用'), el('a', { href: asset ? mediaUrl(asset) : '', download: (asset?.name || '视频') + '.' + (asset?.extension || 'mp4') }, '下载视频'))
      card.append(player, foot)
    },
  })
  view.extend(ctx, 'assets', {
    refresh() { view.assetsList.replaceChildren(...Object.values(s.state.assets).reverse().map(asset => {
      const b = button('', () => view.openMedia(asset.id))
      b.title = '单击放大预览，拖到画布添加：' + asset.name
      b.draggable = true
      b.ondragstart = event => {
        event.dataTransfer.effectAllowed = 'copy'
        event.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id)
        event.dataTransfer.setData('text/plain', asset.name)
      }
      b.append(el(mediaKind(asset) === 'video' ? 'video' : 'img', { src: mediaUrl(asset), ...(mediaKind(asset) === 'video' ? { preload: 'metadata', muted: true } : { alt: asset.name, loading: 'lazy' }) }))
      if (mediaKind(asset) === 'video') b.append(el('span', { class: 'studio-video-badge' }, '▷ 视频'))
      return b
    })) },
    dispose() { view.assetsList.replaceChildren(); fileInput.remove(); videoInput.remove() },
  })
}
