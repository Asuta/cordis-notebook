import { Service } from 'cordis'
import { createMarkdown } from './parser.js'
export const markdown = { apply(ctx) { Object.assign(new Service(ctx, 'markdown'), createMarkdown()) } }
