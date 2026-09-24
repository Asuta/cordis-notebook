import { Service } from 'cordis'
import { createMarkdown } from './parser.bundle.js'
export const markdown = { apply(ctx) { Object.assign(new Service(ctx, 'markdown'), createMarkdown()) } }
