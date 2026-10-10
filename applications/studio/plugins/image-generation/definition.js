const invalid = message => { throw Object.assign(Error(message), { status: 400 }) }
export const definition = {
  id: 'generator', label: '图片生成', fields: ['prompt', 'ratio', 'resolution', 'provider'], accepts: ['text', 'image'],
  defaults: () => ({ prompt: '', ratio: '1:1', resolution: '1k' }),
  validate(node) {
    if (typeof node.prompt !== 'string' || node.prompt.length > 12000) invalid('提示词格式无效')
    for (const field of ['ratio', 'resolution']) if (typeof node[field] !== 'string' || !node[field] || node[field].length > 40) invalid('图片比例或分辨率无效')
    if (node.provider !== undefined && (typeof node.provider !== 'string' || (node.provider !== '' && !/^[a-z][a-z0-9-]*$/.test(node.provider)))) invalid('图片服务无效')
  },
}
export function generationInput(board, nodeId, types) {
  const node = board.nodes.find(n => n.id === nodeId && n.type === 'generator')
  if (!node) invalid('生成卡片不存在')
  const inputs = board.edges.filter(e => e.to === nodeId).map(e => board.nodes.find(n => n.id === e.from))
  const values = inputs.map(n => { const type = types.require(n.type); if (!definition.accepts.includes(type.output) || !type.resolve) invalid('输入卡片不可用'); return type.resolve(structuredClone(n)) })
  const prompt = [...values.map(v => v.text || ''), node.prompt].filter(s => s.trim()).join('\n\n')
  if (!prompt.trim() || prompt.length > 24000) invalid('请填写提示词，合并后最多 24000 字符')
  const assetIds = values.map(v => v.assetId).filter(Boolean)
  if (assetIds.length > 8) invalid('每次最多使用 8 张参考图')
  return { prompt, assetIds, ratio: node.ratio, resolution: node.resolution }
}
