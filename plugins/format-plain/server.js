import { plainFormat } from './format.js'
export const formatPlain = { inject: ['noteFormats'], apply(ctx) { ctx.noteFormats.register(ctx, plainFormat) } }
