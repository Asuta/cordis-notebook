const fail = message => { throw Object.assign(Error(message), { status: 400 }) }
export const definitions = [
  { id: 'text', label: '文字灵感', fields: ['text'], defaults: () => ({ text: '' }), output: 'text',
    validate(node) { if (typeof node.text !== 'string' || node.text.length > 12000) fail('文字格式无效') },
    resolve: node => ({ text: node.text }) },
  { id: 'image', label: '参考图片', fields: ['assetId'], defaults: () => ({}), output: 'image',
    validate(node, assets) { if (!assets[node.assetId]) fail('图片素材不存在') },
    resolve: node => ({ assetId: node.assetId }) },
]
