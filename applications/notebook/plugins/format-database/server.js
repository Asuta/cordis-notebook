import { databaseFormat } from './format.js'
export default { inject: ['noteFormats'], apply(ctx) { ctx.noteFormats.register(ctx, databaseFormat) } }
