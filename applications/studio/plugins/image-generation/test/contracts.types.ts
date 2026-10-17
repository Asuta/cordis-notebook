import type { ClientContext, ServerContext } from '@cordis-notebook/host'
import type {} from '@cordis-studio/canvas/client'
import type {} from '@cordis-studio/canvas/server'
import type {} from '@cordis-studio/canvas-ui/client'
import type {} from '../types/server'
import type { GenerationJob, ModelDefinition, GenerationOutput } from '../types/server'
declare const server: ServerContext
declare const client: ClientContext
server.canvasDocuments.types.register(server, { id: 'custom', label: '自定义文字', fields: ['text'], defaults: () => ({ text: '' }), validate() {}, output: 'text', resolve: node => ({ text: String(node.text) }) })
server.imageGeneration.register(server, { id: 'mock', label: '测试', public: () => ({ model: 'test' }), prepare: () => ({ model: 'test', generate: async () => Buffer.from([]) }) })
declare const model: ModelDefinition
declare const job: GenerationJob
const output: GenerationOutput = { bytes: Buffer.from([]), kind: 'video', name: '视频结果' }
server.imageGeneration.register(server, {
  id: 'catalog', label: '目录服务', public: () => ({ modelCatalog: true, referenceImages: true, referenceVideos: true, resumable: true }),
  listModels: async ({ query, offset } = {}) => ({ items: query ? [model] : [], total: 1, catalogTotal: 1, types: ['image-to-video'], updatedAt: Date.now(), offset: offset || 0, limit: 30 }),
  getModel: async id => ({ ...model, id }),
  prepare: input => ({ model: input.model || model.id, outputKind: 'video', parameters: input.parameters, bindings: input.bindings, async generate(media, signal, { checkpoint }) {
    if (!signal.aborted && media.length) await checkpoint({ phase: 'submitted', taskId: 'remote', account: 'a'.repeat(64) })
    return [output]
  } }),
  resume: task => ({ model: task.model, generate: async () => [output] }),
})
server.imageGeneration.resume(job.id)
server.imageGeneration.detach(job.id)
server.canvasDocuments.addVideo(output.bytes, output.name)
server.canvasDocuments.media('asset')
client.canvasSession.uploadMedia(new File([], 'video.mp4'), new AbortController().signal, percent => console.log(percent))
const kind: 'image' | 'video' = client.canvasSession.mediaKind({ id: 'one', name: '旧图片', width: 64, height: 64, createdAt: 1 })
client.canvasSession.draft({ id: 'one', type: 'generator', title: '生成', x: 0, y: 0 }, 'modelParameters', { 'catalog:model': { duration: 3 } })
client.canvasUI.register(client, { id: 'custom', label: '自定义文字', icon: 'T', output: true, render(node, card, view) { card.append(view.field(node, 'text', true)) } })
client.canvasSession.execute('generate', { nodeId: 'one', revision: 1 }, 'agent')
// @ts-expect-error Revision must be a number.
server.imageGeneration.start({ requestId: 'one', boardId: 'one', nodeId: 'one', revision: '1' })
// @ts-expect-error Providers must implement the request snapshot contract.
server.imageGeneration.register(server, { id: 'invalid', label: '缺少请求方法', public: () => ({}) })
// @ts-expect-error Server-side services must not appear in client context.
client.canvasDocuments.read()
// @ts-expect-error Generated media must declare an image or video kind.
const unsupported: GenerationOutput = { bytes: Buffer.from([]), kind: 'audio' }
// @ts-expect-error Checkpoints only expose recovery metadata.
server.imageGeneration.register(server, { id: 'private', label: '错误', public: () => ({}), prepare: () => ({ model: 'test', generate: async (media, signal, { checkpoint }) => { await checkpoint({ phase: 'submitted', apiKey: 'secret' }); return [] } }) })
