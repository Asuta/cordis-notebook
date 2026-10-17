import { createConfig, accountId } from './config.js'
import { createCatalog } from './catalog.js'
import { createWaveSpeed } from './wavespeed.js'
import { compileInput, prepareInput } from './schema.js'

export default async function (ctx, settings, runtime) {
  const config = await createConfig(runtime.dataDir, { writeSnapshot: runtime.writeSnapshot }), transport = createWaveSpeed()
  const catalog = await createCatalog(runtime.dataDir, config, transport, runtime.writeSnapshot), validators = new Map()
  ctx.effect(() => () => transport.close())
  const provider = {
    id: 'wavespeed', label: 'WaveSpeed', public: config.public,
    listModels: options => catalog.list(options), getModel: id => catalog.detail(id),
    prepare(input) {
      const snapshot = config.private()
      if (!snapshot.apiKey) throw Error('请先配置 WaveSpeed API Key')
      if (!input.model) throw Error('请先选择 WaveSpeed 图片或视频模型')
      const model = catalog.get(input.model)
      if (!model.supported) throw Error(model.unsupportedReason)
      const key = JSON.stringify(model.schema), validate = validators.get(key) || compileInput(model)
      validators.set(key, validate); if (validators.size > 100) validators.delete(validators.keys().next().value)
      const prepared = prepareInput(model, input, validate)
      return { model: model.id, outputKind: model.outputKind, parameters: prepared.parameters, bindings: prepared.bindings, generate: (buffers, signal, { checkpoint }) => transport.generate(snapshot, model, input, prepared, buffers, signal, checkpoint, accountId(snapshot)) }
    },
    resume(job) {
      const snapshot = config.private()
      if (!snapshot.apiKey || accountId(snapshot) !== job.remote.account) throw Error('请使用提交任务时的 WaveSpeed 接口地址和 API Key 恢复查询')
      if (!['image', 'video'].includes(job.outputKind)) throw Error('任务缺少输出类型，无法恢复')
      return { model: job.model, generate: (_, signal) => transport.poll(snapshot, job.remote.taskId, job.outputKind, signal) }
    },
  }
  ctx.imageGeneration.register(ctx, provider)
  ctx.http.route(ctx, 'POST', /^\/api\/studio\/wavespeed\/config$/, async ({ req }) => {
    const result = await config.save(await ctx.http.body(req))
    await ctx.imageGeneration.recover('wavespeed'); return result
  })
}
