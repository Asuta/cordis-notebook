import { createFreeformFormat } from './format.js'
export default function(ctx) { ctx.noteFormats.register(ctx, createFreeformFormat(ctx.richText)) }
