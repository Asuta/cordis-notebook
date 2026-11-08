const fail = message => { throw Object.assign(Error(message), { status: 400 }) }
const placeholder = node => node.assetId === undefined && typeof node.jobId === 'string' && /^[a-f0-9-]{36}$/.test(node.jobId) && typeof node.sourceNodeId === 'string' && !!node.sourceNodeId
const copyMedia = node => { if (!node.assetId) fail('结果尚未生成，完成后才能复制结果图片或视频'); return node }
const mediaLayout = node => {
  const keys = ['frameWidth', 'frameHeight', 'mediaWidth'], present = keys.filter(key => node[key] !== undefined)
  if (!present.length) return
  if (present.length !== keys.length) fail('素材显示范围设置不完整')
  if (!Number.isFinite(node.frameWidth) || node.frameWidth < 80 || node.frameWidth > 3000) fail('显示框宽度需在 80–3000 之间')
  if (!Number.isFinite(node.frameHeight) || node.frameHeight < 60 || node.frameHeight > 6000) fail('显示框高度需在 60–6000 之间')
  if (!Number.isFinite(node.mediaWidth) || node.mediaWidth < 40 || node.mediaWidth > 8000) fail('素材显示宽度需在 40–8000 之间')
}
export const definitions = [
  { id: 'text', label: '文字灵感', fields: ['text'], defaults: () => ({ text: '' }), output: 'text',
    validate(node) { if (typeof node.text !== 'string' || node.text.length > 12000) fail('文字格式无效') },
    resolve: node => ({ text: node.text }) },
  { id: 'image', label: '参考图片', fields: ['assetId', 'opacity', 'frameWidth', 'frameHeight', 'mediaWidth'], defaults: () => ({}), output: 'image',
    copy: copyMedia,
    validate(node, assets) { if (!placeholder(node) && (!assets[node.assetId] || assets[node.assetId].kind === 'video')) fail('图片素材不存在'); if (node.opacity !== undefined && (!Number.isFinite(node.opacity) || node.opacity < 0 || node.opacity > 1)) fail('图片透明度无效'); mediaLayout(node) },
    resolve(node) { if (!node.assetId) fail('参考图片尚未生成，请等待该任务完成'); return { assetId: node.assetId } } },
  { id: 'video', label: '视频', fields: ['assetId', 'opacity', 'loop', 'loopA', 'loopB', 'played', 'frameWidth', 'frameHeight', 'mediaWidth'], defaults: () => ({ loop: false }), output: 'video',
    copy: copyMedia,
    validate(node, assets) {
      if (!placeholder(node) && assets[node.assetId]?.kind !== 'video') fail('视频素材不存在')
      if (node.opacity !== undefined && (!Number.isFinite(node.opacity) || node.opacity < 0 || node.opacity > 1)) fail('视频透明度无效')
      if (node.loop !== undefined && typeof node.loop !== 'boolean') fail('循环播放设置无效')
      if (node.played !== undefined && typeof node.played !== 'boolean') fail('播放状态设置无效')
      for (const key of ['loopA', 'loopB']) if (node[key] !== undefined && (!Number.isFinite(node[key]) || node[key] < 0 || node[key] > 86400)) fail('循环点时间无效')
      if (node.loopB !== undefined && !Number.isFinite(node.loopA)) fail('设置 B 点前需要先设置 A 点')
      if (node.loopB !== undefined && node.loopB <= node.loopA) fail('B 点需要晚于 A 点')
      const duration = Number(assets[node.assetId]?.duration)
      if (duration > 0 && Number.isFinite(node.loopA) && node.loopA >= duration) fail('A 点需要早于视频结束')
      if (duration > 0 && Number.isFinite(node.loopB) && node.loopB > duration + 0.05) fail('B 点超出视频时长')
      mediaLayout(node)
    },
    resolve(node) { if (!node.assetId) fail('参考视频尚未生成，请等待该任务完成'); return { assetId: node.assetId, kind: 'video' } } },
]
