const fail = message => { throw Object.assign(Error(message), { status: 400 }) }
const placeholder = node => node.assetId === undefined && typeof node.jobId === 'string' && /^[a-f0-9-]{36}$/.test(node.jobId) && typeof node.sourceNodeId === 'string' && !!node.sourceNodeId
const copyMedia = node => { if (!node.assetId) fail('结果尚未生成，完成后才能复制结果图片或视频'); return node }
export const definitions = [
  { id: 'text', label: '文字灵感', fields: ['text'], defaults: () => ({ text: '' }), output: 'text',
    validate(node) { if (typeof node.text !== 'string' || node.text.length > 12000) fail('文字格式无效') },
    resolve: node => ({ text: node.text }) },
  { id: 'image', label: '参考图片', fields: ['assetId'], defaults: () => ({}), output: 'image',
    copy: copyMedia,
    validate(node, assets) { if (!placeholder(node) && (!assets[node.assetId] || assets[node.assetId].kind === 'video')) fail('图片素材不存在') },
    resolve(node) { if (!node.assetId) fail('参考图片尚未生成，请等待该任务完成'); return { assetId: node.assetId } } },
  { id: 'video', label: '视频', fields: ['assetId', 'loop', 'played'], defaults: () => ({ loop: false }), output: 'video',
    copy: copyMedia,
    validate(node, assets) { if (!placeholder(node) && assets[node.assetId]?.kind !== 'video') fail('视频素材不存在'); if (node.loop !== undefined && typeof node.loop !== 'boolean') fail('循环播放设置无效'); if (node.played !== undefined && typeof node.played !== 'boolean') fail('播放状态设置无效') },
    resolve(node) { if (!node.assetId) fail('参考视频尚未生成，请等待该任务完成'); return { assetId: node.assetId, kind: 'video' } } },
]
