import { Service } from 'cordis'
import { definitions } from './definitions.js'
import { createAssetFavorites } from './favorites.js'
export default function (ctx) {
  for (const definition of definitions) ctx.canvasDocuments.types.register(ctx, definition)
  const favorites = createAssetFavorites(ctx.canvasDocuments)
  ctx.http.route(ctx, 'GET', /^\/api\/studio\/asset-favorites$/, () => favorites.read())
  ctx.http.route(ctx, 'POST', /^\/api\/studio\/asset-favorites$/, async ({ req }) => favorites.save(await ctx.http.body(req)))
  new Service(ctx, 'canvasBasicCards')
}
