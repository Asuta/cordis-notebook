import { markdownFormat } from '../../shared/formats/markdown.js'
export default function(ctx) { ctx.noteFormats.register(ctx, markdownFormat) }
