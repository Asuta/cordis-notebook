import { createMarkdown } from './parser.bundle.js'
export default function(ctx, sdk) { sdk.provide('markdown', createMarkdown()) }
