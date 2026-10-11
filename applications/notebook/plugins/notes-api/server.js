
export const api = { inject: ['notes', 'http'], apply(ctx) {
  const route = (method, pattern, fn) => ctx.http.route(ctx, method, pattern, fn)
  route('GET', /^\/api\/notes$/, () => ctx.notes.list())
  route('POST', /^\/api\/notes$/, async ({ req }) => ctx.notes.create(await ctx.http.body(req)))
  route('PATCH', /^\/api\/notes\/([\w-]+)$/, async ({ req, match }) => {
    const input = await ctx.http.body(req)
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(Error('笔记格式错误'), { status: 400 })
    const { revision = null, ...patch } = input
    return ctx.notes.update(match[1], patch, revision)
  })
  route('DELETE', /^\/api\/notes\/([\w-]+)$/, async ({ req, match }) => ctx.notes.remove(match[1], (await ctx.http.body(req))?.revision ?? null))
  route('PUT', /^\/api\/notes\/order$/, async ({ req }) => ctx.notes.reorder((await ctx.http.body(req))?.ids))
} }
