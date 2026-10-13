export const blockNoteFormat = {
  type: 'blocknote', label: 'BlockNote 页面', icon: 'Blocks', editor: 'blocknote', editorLayout: 'wide',
  fields: ['document'], defaults: () => ({ document: { version: 1, blocks: [{ id: crypto.randomUUID(), type: 'paragraph', props: {}, content: [], children: [] }] } }),
}
export const createBlockNoteFormat = service => ({ ...blockNoteFormat,
  normalize: data => ({ document: service.normalize(data.document) }),
  toText: data => service.text(data.document),
  references: data => service.references(data.document),
  remapReferences: (data, ids) => ({ document: service.remapReferences(data.document, ids) }),
})
