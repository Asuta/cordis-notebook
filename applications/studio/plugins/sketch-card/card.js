export const actionLabel = '✎ 手绘'
export const cardLabel = '手绘参考图'
export const SKETCH_WIDTH = 360
export const SKETCH_HEIGHT = 240
export const MAX_STROKES = 400
export const MAX_POINTS = 40000
const MAX_STROKE_POINTS = 8000

const fail = message => { throw Object.assign(Error(message), { status: 400 }) }
const finite = value => typeof value === 'number' && Number.isFinite(value)

/** 与画板无关的稳定摘要，只用于判断参考图是否落后于当前笔画。 */
export function digest(strokes) {
  const text = JSON.stringify(strokes)
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function validStroke(stroke) {
  if (!stroke || typeof stroke !== 'object' || Array.isArray(stroke)) return false
  if (typeof stroke.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(stroke.color)) return false
  if (!finite(stroke.width) || stroke.width < 0.5 || stroke.width > 40) return false
  const points = stroke.points
  if (!Array.isArray(points) || !points.length || points.length % 2 || points.length > MAX_STROKE_POINTS) return false
  return points.every(value => finite(value) && value >= -40 && value <= 400)
}

export const definition = {
  id: 'sketch-card', label: cardLabel, fields: ['strokes', 'assetId', 'referenceDigest'], output: 'image',
  defaults: () => ({ strokes: [] }),
  validate(node, assets) {
    if (!Array.isArray(node.strokes)) fail('手绘数据格式无效')
    if (node.strokes.length > MAX_STROKES) fail('手绘笔画过多，请清空后重新绘制')
    let points = 0
    for (const stroke of node.strokes) {
      if (!validStroke(stroke)) fail('手绘笔画数据无效')
      points += stroke.points.length / 2
    }
    if (points > MAX_POINTS) fail('手绘内容过多，请清空后重新绘制')
    if (node.assetId !== undefined) {
      const asset = assets?.[node.assetId]
      if (!asset || asset.kind === 'video') fail('手绘参考图素材不存在')
    }
    if (node.referenceDigest !== undefined && (typeof node.referenceDigest !== 'string' || !node.referenceDigest.length || node.referenceDigest.length > 40)) fail('手绘参考图版本无效')
  },
  resolve(node) {
    if (!node.assetId) fail('手绘参考图尚未生成，请先在卡片内绘制并点击“生成参考图”')
    return { assetId: node.assetId }
  },
}
