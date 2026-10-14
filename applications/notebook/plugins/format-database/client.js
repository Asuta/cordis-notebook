import { databaseFormat } from './format.js'
export default function(ctx) { ctx.noteFormats.register(ctx, databaseFormat) }
