import { plainFormat } from '../../shared/formats/plain.js'
export const formatPlain = { inject: ['noteFormats'], apply(ctx) { ctx.noteFormats.register(ctx, plainFormat) } }
