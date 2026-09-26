import { createFormatRegistry } from './registry.js'
export default function(ctx, sdk) { sdk.provide('noteFormats', createFormatRegistry(ctx)) }
