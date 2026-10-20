import { referenceInputs, modelKey } from './references.js'
import { snapshotGenerator, textInputs } from './snapshot.js'
const invalid = message => { throw Object.assign(Error(message), { status: 400 }) }
const object = value => value && typeof value === 'object' && !Array.isArray(value)
export const definition = {
  id: 'generator', label: '媒体生成', fields: ['prompt', 'promptSuffixes', 'ratio', 'resolution', 'provider', 'model', 'modelParameters', 'references', 'referenceOrder', 'referenceBindings', 'textReferences', 'textReferenceOrder', 'collapsedParameters', 'cardHeight'], accepts: ['text', 'image', 'video'],
  defaults: () => ({ prompt: '', ratio: '1:1', resolution: '1k', provider: '' }),
  copy: snapshotGenerator,
  validate(node, assets) {
    if (node.cardHeight !== undefined && (!Number.isInteger(node.cardHeight) || node.cardHeight < 360 || node.cardHeight > 20000)) invalid('卡片高度需在 360–20000 之间')
    if (node.collapsedParameters !== undefined && (!object(node.collapsedParameters) || JSON.stringify(node.collapsedParameters).length > 30000 || Object.values(node.collapsedParameters).some(paths => !Array.isArray(paths) || paths.length > 300 || paths.some(path => typeof path !== 'string' || path.length > 300)))) invalid('折叠参数设置无效')
    if (node.textReferences !== undefined && (!Array.isArray(node.textReferences) || node.textReferences.length > 500 || new Set(node.textReferences.map(ref => ref?.id)).size !== node.textReferences.length || node.textReferences.some(ref => !ref || !/^[a-zA-Z0-9-]{1,100}$/.test(ref.id) || typeof ref.text !== 'string' || ref.text.length > 24000 || typeof ref.title !== 'string' || ref.title.length > 120) || node.textReferences.reduce((sum, ref) => sum + ref.text.length, 0) > 24000)) invalid('独立文字输入格式无效或过长')
    if (node.promptSuffixes !== undefined && (!Array.isArray(node.promptSuffixes) || node.promptSuffixes.length > 100 || new Set(node.promptSuffixes.map(ref => ref?.id)).size !== node.promptSuffixes.length || node.promptSuffixes.some(ref => !ref || typeof ref.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(ref.id) || typeof ref.title !== 'string' || !ref.title.trim() || ref.title.length > 120 || typeof ref.text !== 'string' || !ref.text.trim() || ref.text.length > 24000 || typeof ref.enabled !== 'boolean') || node.promptSuffixes.reduce((sum, ref) => sum + ref.text.length, 0) > 24000)) invalid('固定尾缀格式无效或过长')
    for (const prop of ['referenceOrder', 'textReferenceOrder']) if (node[prop] !== undefined && (!Array.isArray(node[prop]) || node[prop].length > 1500 || new Set(node[prop]).size !== node[prop].length || node[prop].some(key => typeof key !== 'string' || !/^(direct|edge):[a-zA-Z0-9-]{1,100}$/.test(key)))) invalid('参考输入顺序无效')
    if (typeof node.prompt !== 'string' || node.prompt.length > 24000) invalid('提示词格式无效')
    for (const field of ['ratio', 'resolution']) if (typeof node[field] !== 'string' || !node[field] || node[field].length > 40) invalid('图片比例或分辨率无效')
    if (node.provider !== undefined && (typeof node.provider !== 'string' || (node.provider !== '' && !/^[a-z][a-z0-9-]*$/.test(node.provider)))) invalid('图片服务无效')
    if (node.model !== undefined && (typeof node.model !== 'string' || node.model.length > 200)) invalid('模型 ID 无效')
    for (const prop of ['modelParameters', 'referenceBindings']) if (node[prop] !== undefined && (!object(node[prop]) || JSON.stringify(node[prop]).length > 200000 || Object.keys(node[prop]).length > 100)) invalid('模型参数格式无效或过大')
    if (node.references !== undefined) {
      if (!Array.isArray(node.references) || node.references.length > 1500 || new Set(node.references.map(r => r?.id)).size !== node.references.length) invalid('参考素材列表无效（最多 1500 项）')
      // assetId: null 表示尚未填写素材的空槽位，不参与生成。
      for (const ref of node.references) if (!ref || typeof ref.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(ref.id) || (ref.assetId !== null && ref.assetId !== undefined && !assets[ref.assetId])) invalid('参考素材不存在')
    }
    if (node.referenceOrder !== undefined && (!Array.isArray(node.referenceOrder) || node.referenceOrder.length > 1500 || new Set(node.referenceOrder).size !== node.referenceOrder.length || node.referenceOrder.some(key => typeof key !== 'string' || !/^(direct|edge):[a-zA-Z0-9-]{1,100}$/.test(key)))) invalid('参考素材顺序无效')
  },
}
export function generationInput(board, nodeId, types, assets = {}, { allowEmptyPrompt = false, providerId } = {}) {
  const node = board.nodes.find(n => n.id === nodeId && n.type === 'generator')
  if (!node) invalid('生成卡片不存在')
  const inputs = board.edges.filter(e => e.to === nodeId).map(e => board.nodes.find(n => n.id === e.from))
  for (const input of inputs) { const type = types.require(input.type); if (!definition.accepts.includes(type.output) || !type.resolve) invalid('输入卡片不可用') }
  const prompt = [...textInputs(board, node, types).map(ref => ref.text), node.prompt, ...(node.promptSuffixes || []).filter(ref => ref.enabled).map(ref => ref.text)].filter(s => s.trim()).join('\n\n')
  if ((!allowEmptyPrompt && !prompt.trim()) || prompt.length > 24000) invalid('请填写提示词，合并后最多 24000 字符')
  const references = referenceInputs(board, node, assets, types).filter(ref => ref.assetId), assetIds = references.map(ref => ref.assetId), key = modelKey(providerId ?? node.provider, node.model)
  return { prompt, assetIds, ratio: node.ratio, resolution: node.resolution, references, ...(node.model ? { model: node.model, parameters: structuredClone(node.modelParameters?.[key] || {}), bindings: structuredClone(node.referenceBindings?.[key] || {}) } : {}) }
}
