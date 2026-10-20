export const modelKey = (provider, model) => `${provider}:${model || ''}`
// The same ordering is used by the form and the immutable generation snapshot.
export function referenceInputs(board, node, assets = {}, types) {
  const entries = (node.references || []).map(ref => ({ id: ref.id, key: 'direct:' + ref.id, assetId: ref.assetId || null, kind: assets[ref.assetId]?.kind === 'video' ? 'video' : 'image', source: 'direct', empty: !ref.assetId }))
  for (const edge of board.edges.filter(edge => edge.to === node.id)) {
    const from = board.nodes.find(item => item.id === edge.from), type = types?.get(from?.type)
    const declaredKind = type?.output || from?.type
    if (!['image', 'video'].includes(declaredKind)) continue
    const value = Object.hasOwn(from, 'resolvedOutput') ? from.resolvedOutput : type?.resolve ? type.resolve(structuredClone(from)) : from
    const kind = value?.kind === 'image' || value?.kind === 'video' ? value.kind : declaredKind
    if (value?.assetId) entries.push({ key: 'edge:' + edge.id, assetId: value.assetId, kind, source: 'edge', edgeId: edge.id, title: from.title })
  }
  const order = new Map((node.referenceOrder || []).map((key, index) => [key, index]))
  return entries.map((entry, index) => ({ ...entry, position: order.get(entry.key) ?? order.size + index })).sort((a, b) => a.position - b.position).map(({ position, ...entry }) => entry)
}
