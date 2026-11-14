import { Service } from 'cordis'
import { definitions } from './definitions.js'
import { createAssetFavorites } from './favorites.js'
import { createAssetLibrary } from './library.js'
export default function (ctx) {
  for (const definition of definitions) ctx.canvasDocuments.types.register(ctx, definition)
  const favorites = createAssetFavorites(ctx.canvasDocuments)
  const library = createAssetLibrary(ctx.canvasDocuments, () => favorites.read().assetIds)
  ctx.http.route(ctx, 'GET', /^\/api\/studio\/asset-library\/revision$/, () => ({ revision: library.read().revision }))
  ctx.http.route(ctx, 'GET', /^\/api\/studio\/asset-library$/, () => library.read())
  ctx.http.route(ctx, 'POST', /^\/api\/studio\/asset-library$/, async ({ req }) => library.mutate(await ctx.http.body(req)))
  ctx.http.route(ctx, 'POST', /^\/api\/studio\/asset-library\/purge$/, async ({ req }) => {
    const input = await ctx.http.body(req)
    return ctx.canvasDocuments.purgeAssets(input.ids, input.revision)
  })
  ctx.http.route(ctx, 'GET', /^\/api\/studio\/asset-favorites$/, () => library.favorites())
  ctx.http.route(ctx, 'POST', /^\/api\/studio\/asset-favorites$/, async ({ req }) => library.favorite(await ctx.http.body(req)))
  new Service(ctx, 'canvasBasicCards')
}
