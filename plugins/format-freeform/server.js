import { createFreeformFormat } from './format.js'
export const formatFreeform = { inject: ['noteFormats','richText'], apply(ctx) { ctx.noteFormats.register(ctx, createFreeformFormat(ctx.richText)) } }
