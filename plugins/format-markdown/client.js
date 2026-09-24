import { createMarkdownFormat } from './format.js'
export default function(ctx) { ctx.noteFormats.register(ctx, createMarkdownFormat(ctx.markdown)) }
