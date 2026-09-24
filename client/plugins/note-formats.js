import { createFormatRegistry } from '../../shared/format-registry.js'
export default function(ctx, sdk) { sdk.provide('noteFormats', createFormatRegistry(ctx)) }
