import { databaseFormat } from './format.js'
import { databaseSchema } from './schema.js'
export default function(ctx, sdk) { sdk.provide('databaseSchema', databaseSchema); ctx.noteFormats.register(ctx, databaseFormat) }
