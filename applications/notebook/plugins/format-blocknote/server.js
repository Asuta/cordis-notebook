import { Service } from 'cordis'
import { blockNoteDocument } from './document.js'
import { createBlockNoteFormat } from './format.js'
export default { inject: ['noteFormats'], apply(ctx) {
  Object.assign(new Service(ctx, 'blockNoteDocument'), blockNoteDocument)
  ctx.noteFormats.register(ctx, createBlockNoteFormat(blockNoteDocument))
} }
