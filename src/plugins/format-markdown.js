import { markdownFormat } from '../../shared/formats/markdown.js'
export const formatMarkdown = { inject: ['noteFormats'], apply(ctx) { ctx.noteFormats.register(ctx, markdownFormat) } }
