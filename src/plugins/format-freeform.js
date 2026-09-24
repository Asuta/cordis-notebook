import { freeformFormat } from '../../shared/formats/freeform.js'
export const formatFreeform = { inject: ['noteFormats'], apply(ctx) { ctx.noteFormats.register(ctx, freeformFormat) } }
