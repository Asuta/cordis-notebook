import { Service } from 'cordis'
import { createBlockDocument } from './document.js'
import { createBlockFormat } from './format.js'
export default { inject: ['noteFormats', 'richText'], apply(ctx) {
  const service = Object.assign(new Service(ctx, 'blockDocument'), createBlockDocument(ctx.richText))
  ctx.noteFormats.register(ctx, createBlockFormat(service))
} }
