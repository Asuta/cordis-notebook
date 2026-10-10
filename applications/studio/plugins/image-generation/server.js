import { Service } from 'cordis'
import { definition } from './definition.js'
import { createJobs } from './jobs.js'

export default async function (ctx) {
  const documents = ctx.canvasDocuments
  documents.types.register(ctx, definition)
  const jobs = await createJobs(documents)
  ctx.effect(() => () => jobs.close())
  Object.assign(new Service(ctx, 'imageGeneration'), jobs)
  documents.observe(ctx, board => jobs.boardChanged(board))
  documents.snapshots.register(ctx, { id: 'image-generation', read: () => {
    const providers = jobs.listProviders()
    return { jobs: jobs.read(), providers, config: providers[0] || { hasKey: false, model: '', baseUrl: '' } }
  } })
  ctx.http.route(ctx, 'POST', /^\/api\/studio\/generate$/, async ({ req }) => jobs.start(await ctx.http.body(req)))
  ctx.http.route(ctx, 'POST', /^\/api\/studio\/cancel$/, async ({ req }) => { await jobs.cancel((await ctx.http.body(req)).id); return { ok: true } })
}
