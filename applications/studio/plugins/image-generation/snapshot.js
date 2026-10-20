import { referenceInputs } from './references.js'

export function textInputs(board, node, types, { tolerant = false } = {}) {
  const entries = (node.textReferences || []).map(ref => ({ ...ref, key: 'direct:' + ref.id }))
  for (const edge of board.edges.filter(edge => edge.to === node.id)) {
    const from = board.nodes.find(item => item.id === edge.from), type = types.get(from?.type)
    if (type?.output !== 'text') continue
    const entry = { key: 'edge:' + edge.id, edgeId: edge.id, title: from.title }
    try {
      const value = Object.hasOwn(from, 'resolvedOutput') ? from.resolvedOutput : type.resolve?.(structuredClone(from))
      if (typeof value?.text !== 'string') throw Error('文字输入卡片不可用')
      entries.push({ ...entry, text: value.text })
    } catch (error) {
      if (!tolerant) throw error
      entries.push({ ...entry, text: '', unavailable: true })
    }
  }
  const order = new Map((node.textReferenceOrder || []).map((key, i) => [key, i]))
  return entries.map((entry, i) => ({ ...entry, position: order.get(entry.key) ?? order.size + i })).sort((a, b) => a.position - b.position).map(({ position, ...entry }) => entry)
}

export function snapshotGenerator(node, { board, edgeIds = new Map(), types, assets }, uuid = () => crypto.randomUUID()) {
  const copy = structuredClone(node), keys = new Map()
  // Explicitly retain legacy default-service selection when new cards default to WaveSpeed.
  copy.provider = node.provider ?? ''
  copy.references = []
  copy.referenceOrder = referenceInputs(board, node, assets, types).map(ref => {
    let key
    if (ref.edgeId && edgeIds.has(ref.edgeId)) key = 'edge:' + edgeIds.get(ref.edgeId)
    else { const id = uuid(); copy.references.push({ id, assetId: ref.assetId ?? null }); key = 'direct:' + id }
    keys.set(ref.key, key); return key
  })
  copy.referenceBindings = Object.fromEntries(Object.entries(node.referenceBindings || {}).map(([model, bindings]) => [model, Object.fromEntries(Object.entries(bindings).filter(([key]) => keys.has(key)).map(([key, path]) => [keys.get(key), path]))]))
  copy.textReferences = []
  copy.textReferenceOrder = textInputs(board, node, types).map(ref => {
    if (ref.edgeId && edgeIds.has(ref.edgeId)) return 'edge:' + edgeIds.get(ref.edgeId)
    const id = uuid(); copy.textReferences.push({ id, text: ref.text, title: ref.title || '复制的文字输入' }); return 'direct:' + id
  })
  return copy
}
