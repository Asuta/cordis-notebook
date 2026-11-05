import { createConfig, models } from './config.js'
import { createSudeng } from './transport.js'

export default async function (ctx, settings, runtime) {
  const config = await createConfig(runtime.dataDir, { writeSnapshot: runtime.writeSnapshot })
  const transport = createSudeng()
  const capabilities = { ratios: ['auto', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'], resolutions: ['1k', '2k', '4k'], referenceImages: true }
  ctx.effect(() => () => transport.close())
  ctx.imageGeneration.register(ctx, {
    id: 'sudeng', label: '速登 · GPT Image', public: () => ({ ...config.public(), ...capabilities }),
    prepare(input) {
      if (!input.prompt.trim()) throw Error('请填写提示词')
      if (input.assetIds.length > 10) throw Error('速登每次最多使用 10 张参考图')
      if (input.references?.some(ref => ref.kind !== 'image')) throw Error('速登仅支持图片参考，请移除或断开视频')
      if (!capabilities.ratios.includes(input.ratio) || !capabilities.resolutions.includes(input.resolution)) throw Error('速登不支持此图片比例或分辨率')
      const snapshot = config.private()
      if (!snapshot.apiKey) throw Error('请先配置速登 API Key')
      const model = input.model || snapshot.model
      if (!models.some(item => item.id === model)) throw Error('请选择支持的速登 GPT Image 模型')
      const selected = { ...snapshot, model }
      return { model, generate: (images, signal) => transport.generate(input, selected, images, signal) }
    },
  })
  ctx.http.route(ctx, 'POST', /^\/api\/studio\/sudeng\/config$/, async ({ req }) => config.save(await ctx.http.body(req)))
}
