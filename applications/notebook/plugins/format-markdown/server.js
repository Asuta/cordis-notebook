import { createMarkdownFormat } from './format.js'
export const formatMarkdown = { inject: ['noteFormats', 'markdown'], apply(ctx) { ctx.noteFormats.register(ctx, createMarkdownFormat(ctx.markdown)) } }
