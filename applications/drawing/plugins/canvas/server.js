export default function (ctx, config, runtime) {
  // Brush settings belong to the client; accepting them does not change HTTP behavior.
  runtime.onConfig(() => {})
  ctx.http.route(ctx, 'GET', /^\/api\/drawing$/, () => ctx.drawingStorage.read())
  ctx.http.route(ctx, 'POST', /^\/api\/drawing$/, async ({ req }) => ctx.drawingStorage.save(await ctx.http.body(req)))
}
