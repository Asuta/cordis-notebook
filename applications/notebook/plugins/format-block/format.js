export const createBlockFormat = blocks => ({
  type: 'block', label: '块页面', icon: 'Blocks', editor: 'block', editorLayout: 'wide',
  fields: ['document'], defaults: () => ({ document: { version: 1, blocks: [blocks.create()] } }),
  normalize: data => ({ document: blocks.normalize(data.document) }),
  toText: data => blocks.text(data.document),
})
