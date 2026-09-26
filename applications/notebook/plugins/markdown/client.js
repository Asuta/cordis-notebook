import { createMarkdown } from './parser.js'
export default function(ctx, sdk) { sdk.provide('markdown', createMarkdown()) }
