import { createBlockDocument } from './document.js'
import { createBlockFormat } from './format.js'
export default function(ctx, sdk) {
  const service = createBlockDocument(ctx.richText)
  sdk.provide('blockDocument', service)
  ctx.noteFormats.register(ctx, createBlockFormat(service))
}
