import { Service } from 'cordis'
import { createFormatRegistry } from '../../shared/format-registry.js'
export const noteFormats = { apply(ctx) { Object.assign(new Service(ctx, 'noteFormats'), createFormatRegistry(ctx)) } }
