import { freeformFormat } from './format.js'
export const formatFreeform = { inject: ['noteFormats'], apply(ctx) { ctx.noteFormats.register(ctx, freeformFormat) } }
