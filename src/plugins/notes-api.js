import { body } from '../host/http.js'

export const api = { inject: ['notes', 'http'], apply(ctx) {
  const route = (method, pattern, fn) => ctx.http.route(ctx, method, pattern, fn)
  route('GET', /^\/api\/notes$/, () => ctx.notes.list())
  route('POST', /^\/api\/notes$/, async ({ req }) => ctx.notes.create(await body(req)))
  route('PATCH', /^\/api\/notes\/([\w-]+)$/, async ({ req, match }) => ctx.notes.update(match[1], await body(req)))
  route('DELETE', /^\/api\/notes\/([\w-]+)$/, ({ match }) => ctx.notes.remove(match[1]))
} }
