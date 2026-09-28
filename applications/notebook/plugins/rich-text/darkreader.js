import { DOMSerializer } from '@tiptap/pm/model'

function contentStyle(document, cssText) {
  const { style } = document.createElement('span')
  style.cssText = cssText || ''
  const declarations = []
  for (let i = 0; i < style.length; i++) {
    const name = style.item(i)
    if (!name.startsWith('--darkreader-'))
      declarations.push([name, style.getPropertyValue(name), style.getPropertyPriority(name)])
  }
  return JSON.stringify(declarations.sort(([a], [b]) => a.localeCompare(b)))
}

function colorMarkView(mark, view, inline) {
  const document = view.dom.ownerDocument
  const { dom, contentDOM } = DOMSerializer.renderSpec(document, mark.type.spec.toDOM(mark, inline))
  return {
    dom,
    contentDOM: contentDOM || dom,
    ignoreMutation(mutation) {
      if (mutation.type !== 'attributes' || mutation.target !== dom) return false
      if (mutation.attributeName?.startsWith('data-darkreader-')) return true
      // Dynamic recoloring must not trigger a DOM rebuild that makes Dark Reader
      // recolor the replacement again. Keep real formatting/content edits observable.
      return mutation.attributeName === 'style' &&
        contentStyle(document, mutation.oldValue) === contentStyle(document, dom.getAttribute('style'))
    },
  }
}

export const darkReaderMarkViews = { textStyle: colorMarkView, highlight: colorMarkView }
