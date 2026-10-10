import { Service } from 'cordis'
import { definitions } from './definitions.js'
export default function (ctx) {
  for (const definition of definitions) ctx.canvasDocuments.types.register(ctx, definition)
  new Service(ctx, 'canvasBasicCards')
}
