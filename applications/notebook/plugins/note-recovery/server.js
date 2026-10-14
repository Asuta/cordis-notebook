export default { inject: ['notes', 'http'], apply(ctx) {
  const route = (method, pattern, fn) => ctx.http.route(ctx, method, pattern, fn)
  route('GET', /^\/api\/note-history\/([\w-]+)$/, ({ match }) => ctx.notes.history(match[1]))
  route('POST', /^\/api\/note-history\/([\w-]+)\/restore$/, async ({ req, match }) => {
    const input = await ctx.http.body(req)
    return ctx.notes.restoreVersion(match[1], input?.versionId, input?.revision ?? null)
  })
  route('GET', /^\/api\/note-trash$/, () => ctx.notes.trash())
  route('POST', /^\/api\/note-trash\/([\w-]+)\/restore$/, ({ match }) => ctx.notes.restoreTrash(match[1]))
  route('DELETE', /^\/api\/note-trash\/([\w-]+)$/, ({ match }) => ctx.notes.purgeTrash(match[1]))
} }
