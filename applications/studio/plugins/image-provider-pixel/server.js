import { createConfig, createPixel } from './pixel.js'
export default async function (ctx, settings, runtime) {
  const config = await createConfig(runtime.dataDir, { writeSnapshot: runtime.writeSnapshot, legacy: () => ctx.canvasDocuments.legacyPixelConfig() }), pixel = createPixel()
  const capabilities = { ratios: ['auto', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'], resolutions: ['1k', '2k', '4k'], referenceImages: true }
  ctx.effect(() => () => pixel.close())
  ctx.imageGeneration.register(ctx, {
    id: 'pixel', label: 'AI Pixel', public: () => ({ ...config.public(), ...capabilities }),
    prepare(input) {
      if (!input.prompt.trim()) throw Error('请填写提示词')
      if (input.assetIds.length > 8) throw Error('Pixel 每次最多使用 8 张参考图')
      if (input.references?.some(ref => ref.kind === 'video')) throw Error('Pixel 不支持视频参考素材，请移除或断开视频')
      if (!capabilities.ratios.includes(input.ratio) || !capabilities.resolutions.includes(input.resolution)) throw Error('Pixel 不支持此图片比例或分辨率')
      const snapshot = config.private()
      if (!snapshot.apiKey) throw Error('请先配置图片服务 API Key')
      return { model: snapshot.model, generate: (images, signal) => pixel.generate(input, snapshot, images, signal) }
    },
  })
  ctx.http.route(ctx, 'POST', /^\/api\/studio\/config$/, async ({ req }) => config.save(await ctx.http.body(req)))
}
