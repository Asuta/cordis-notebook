import { blockNoteDocument } from './document.js'
import { createBlockNoteFormat } from './format.js'
export default function(ctx, sdk) {
  sdk.provide('blockNoteDocument', blockNoteDocument)
  ctx.noteFormats.register(ctx, createBlockNoteFormat(blockNoteDocument))
}
