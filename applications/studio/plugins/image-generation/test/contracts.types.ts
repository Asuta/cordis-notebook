import type { ClientContext, ServerContext } from '@cordis-notebook/host'
import type {} from '@cordis-studio/canvas/client'
import type {} from '@cordis-studio/canvas/server'
import type {} from '@cordis-studio/canvas-ui/client'
import type {} from '../types/server'
declare const server: ServerContext
declare const client: ClientContext
server.canvasDocuments.types.register(server, { id: 'custom', label: '自定义文字', fields: ['text'], defaults: () => ({ text: '' }), validate() {}, output: 'text', resolve: node => ({ text: String(node.text) }) })
server.imageGeneration.register(server, { id: 'mock', label: '测试', public: () => ({ model: 'test' }), prepare: () => ({ model: 'test', generate: async () => Buffer.from([]) }) })
client.canvasUI.register(client, { id: 'custom', label: '自定义文字', icon: 'T', output: true, render(node, card, view) { card.append(view.field(node, 'text', true)) } })
client.canvasSession.execute('generate', { nodeId: 'one', revision: 1 }, 'agent')
// @ts-expect-error Revision must be a number.
server.imageGeneration.start({ requestId: 'one', boardId: 'one', nodeId: 'one', revision: '1' })
// @ts-expect-error Providers must implement the request snapshot contract.
server.imageGeneration.register(server, { id: 'invalid', label: '缺少请求方法', public: () => ({}) })
// @ts-expect-error Server-side services must not appear in client context.
client.canvasDocuments.read()
