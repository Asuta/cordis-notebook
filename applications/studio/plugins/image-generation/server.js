import { Service } from 'cordis'
import { definition } from './definition.js'
import { createJobs } from './jobs.js'
import { createLibrary } from './library.js'
import { createPromptOptimizerServer } from './prompt-optimizer-server.js'

export default async function (ctx, settings, runtime) {
  const documents = ctx.canvasDocuments
  documents.types.register(ctx, definition)
  const jobs = await createJobs(documents)
  const library = createLibrary(documents, jobs)
  const promptOptimizer = await createPromptOptimizerServer(documents, { directory: runtime.dataDir, writeSnapshot: runtime.writeSnapshot })
  ctx.http.route(ctx, 'GET', /^\/api\/studio\/generation-library$/, () => library.read())
  ctx.http.route(ctx, 'POST', /^\/api\/studio\/generation-library$/, async ({ req }) => library.save(await ctx.http.body(req)))
  ctx.http.route(ctx, 'POST', /^\/api\/studio\/result-parameters$/, async ({ req }) => library.resultParameters(await ctx.http.body(req)))
  ctx.http.route(ctx, 'GET', /^\/api\/studio\/llm\/config$/, () => promptOptimizer.publicConfig())
  ctx.http.route(ctx, 'POST', /^\/api\/studio\/llm\/config$/, async ({ req }) => promptOptimizer.saveModel(await ctx.http.body(req)))
  ctx.http.route(ctx, 'POST', /^\/api\/studio\/llm\/test$/, async ({ req }) => promptOptimizer.testModel(await ctx.http.body(req)))
  ctx.http.route(ctx, 'GET', /^\/api\/studio\/prompt-optimizations$/, () => ({ templates: promptOptimizer.listTemplates() }))
  ctx.http.route(ctx, 'POST', /^\/api\/studio\/prompt-optimizations$/, async ({ req }) => promptOptimizer.saveTemplate(await ctx.http.body(req)))
  ctx.http.route(ctx, 'POST', /^\/api\/studio\/prompt-optimize$/, async ({ req }) => promptOptimizer.optimize(await ctx.http.body(req)))
  ctx.effect(() => () => jobs.close())
  Object.assign(new Service(ctx, 'imageGeneration'), jobs)
  documents.observe(ctx, board => jobs.boardChanged(board))
  documents.snapshots.register(ctx, { id: 'image-generation', read: () => {
    const providers = jobs.listProviders()
    return { jobs: jobs.read(), providers, config: providers.find(p => p.id === 'pixel') || providers[0] || { hasKey: false, model: '', baseUrl: '' } }
  } })
  ctx.http.route(ctx, 'POST', /^\/api\/studio\/generate$/, async ({ req }) => jobs.start(await ctx.http.body(req)))
  ctx.http.route(ctx, 'POST', /^\/api\/studio\/cancel$/, async ({ req }) => { await jobs.cancel((await ctx.http.body(req)).id); return { ok: true } })
  ctx.http.route(ctx, 'POST', /^\/api\/studio\/resume$/, async ({ req }) => jobs.resume((await ctx.http.body(req)).id))
  ctx.http.route(ctx, 'POST', /^\/api\/studio\/detach$/, async ({ req }) => { await jobs.detach((await ctx.http.body(req)).id); return { ok: true } })
  ctx.http.route(ctx, 'GET', /^\/api\/studio\/providers\/([a-z][a-z0-9-]*)\/(models|model)$/, async ({ req, match }) => {
    const provider = jobs.provider(match[1]), query = new URL(req.url, 'http://localhost').searchParams
    if (!provider.listModels || !provider.getModel) throw Object.assign(Error('此服务没有模型目录'), { status: 400 })
    return match[2] === 'model' ? provider.getModel(query.get('id')) : provider.listModels({ query: query.get('q') || '', kind: query.get('kind') || '', type: query.get('type') || '', offset: Number(query.get('offset')), limit: Number(query.get('limit')), refresh: query.get('refresh') === '1', ...(query.get('favorites') === '1' ? { ids: library.read().models.filter(item => item.provider === match[1]).map(item => item.model) } : {}) })
  })
}
