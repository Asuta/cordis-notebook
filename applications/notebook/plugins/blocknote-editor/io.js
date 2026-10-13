import { BlockNoteEditor } from '@blocknote/core'

export function createIO(ctx, schema) {
  let converter
  const service = ctx.blockNoteDocument
  const getConverter = () => converter ??= BlockNoteEditor.create({ schema })
  const asJSON = value => JSON.parse(JSON.stringify(value))
  const check = value => { if (typeof value !== 'string' || value.length > 200000) throw Error('导入内容必须是 200000 字符以内的文本') }
  const escape = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  let disposed = false
  ctx.effect(() => () => { disposed = true; converter?.unmount(); converter = null })
  return {
    parse(format, source) {
      if (disposed) throw Error('BlockNote 转换服务已停用')
      if (format === 'json') {
        if (typeof source !== 'string' || source.length > 1750000) throw Error('BlockNote JSON 过大')
        return service.normalize(JSON.parse(source))
      }
      check(source)
      if (!['markdown', 'html'].includes(format)) throw Error('仅支持 Markdown 或 HTML 导入')
      if (format === 'html') {
        const document = new DOMParser().parseFromString(source, 'text/html')
        document.querySelectorAll('script,style,iframe,object,embed,form,svg,math,link,meta,base').forEach(node => node.remove())
        for (const element of document.querySelectorAll('*')) for (const attr of [...element.attributes]) {
          if (attr.name.startsWith('on') || ['srcdoc', 'formaction'].includes(attr.name)) element.removeAttribute(attr.name)
        }
        source = document.body.innerHTML
      }
      const converter = getConverter()
      const blocks = format === 'markdown' ? converter.tryParseMarkdownToBlocks(source) : converter.tryParseHTMLToBlocks(source)
      return service.normalize({ version: 1, blocks: asJSON(blocks.length ? blocks : [service.create()]) })
    },
    export(note, format) {
      if (disposed) throw Error('BlockNote 转换服务已停用')
      if (note?.type !== 'blocknote') throw Error('请先打开 BlockNote 页面')
      const document = service.normalize(note.document)
      if (format === 'json') return JSON.stringify({ format: 'cordis-note', version: 1, note: { ...note, document } }, null, 2)
      const converter = getConverter()
      if (format === 'markdown') return converter.blocksToMarkdownLossy(asJSON(document.blocks))
      if (format === 'html') return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>' + escape(note.title || '笔记') + '</title><body><h1>' + escape(note.title || '无标题笔记') + '</h1>' + converter.blocksToHTMLLossy(asJSON(document.blocks)) + '</body></html>'
      throw Error('导出格式无效')
    },
  }
}
