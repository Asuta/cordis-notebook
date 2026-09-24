import { Service } from 'cordis'
import { createFormatRegistry } from './registry.js'
export const noteFormats = { apply(ctx) { Object.assign(new Service(ctx, 'noteFormats'), createFormatRegistry(ctx)) } }
