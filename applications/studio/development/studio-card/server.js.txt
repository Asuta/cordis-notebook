import { definition } from './card.js'
export default function (ctx) {
  ctx.canvasDocuments.types.register(ctx, definition)
}
