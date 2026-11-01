const invalid = message => Object.assign(Error(message), { status: 400 })
const assetIdPattern = /^[a-f0-9-]{36}$/

export function createAssetFavorites(documents) {
  const records = documents.records('asset-favorites')
  function read() {
    const assets = documents.read().assets, seen = new Set(), assetIds = []
    for (const record of records.read()) {
      const assetId = record?.assetId
      if (!assetIdPattern.test(assetId || '') || !assets[assetId] || seen.has(assetId)) continue
      seen.add(assetId); assetIds.push(assetId)
    }
    return { assetIds }
  }
  async function save(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('收藏请求无效')
    if (typeof input.assetId !== 'string' || !assetIdPattern.test(input.assetId)) throw invalid('素材无效')
    if (typeof input.favorite !== 'boolean') throw invalid('收藏状态无效')
    if (!documents.read().assets[input.assetId]) throw invalid('素材不存在')
    await records.change(tx => {
      const index = tx.records.findIndex(record => record?.assetId === input.assetId)
      if (input.favorite) {
        if (index < 0) tx.records.unshift({ assetId: input.assetId, createdAt: Date.now() })
      } else if (index >= 0) tx.records.splice(index, 1)
    })
    return read()
  }
  return { read, save }
}
