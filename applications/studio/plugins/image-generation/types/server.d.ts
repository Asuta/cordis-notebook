import type { Context } from 'cordis'
import type {} from '@cordis-notebook/host'
export interface GenerationReference { key: string; assetId: string; kind: 'image' | 'video'; source: 'direct' | 'edge'; edgeId?: string; title?: string }
export interface GenerationInput { prompt: string; assetIds: string[]; ratio: string; resolution: string; references?: GenerationReference[]; model?: string; parameters?: Record<string, unknown>; bindings?: Record<string, string> }
export interface RemoteCheckpoint { phase: 'preparing' | 'submitting' | 'submitted'; taskId?: string; account?: string }
export interface GenerationOutput { bytes: Buffer; kind: 'image' | 'video'; name?: string }
export interface PreparedGeneration { model: string; outputKind?: 'image' | 'video'; parameters?: Record<string, unknown>; bindings?: Record<string, string>; generate(media: Buffer[], signal: AbortSignal, context: { checkpoint(value: RemoteCheckpoint): Promise<void>; remote?: RemoteCheckpoint }): Promise<Buffer | GenerationOutput[]> }
export interface ModelSummary { id: string; label: string; type: string; description: string; basePrice: number | null; outputKind: 'image' | 'video'; supported: boolean; unsupportedReason?: string }
export interface ModelDefinition extends ModelSummary { schema?: Record<string, unknown>; fields?: { path: string; name: string; type: string; required: boolean; schema: Record<string, unknown> }[]; mediaFields?: { path: string; name: string; label: string; kind: 'image' | 'video'; array: boolean; required: boolean; min: number; max: number; description: string }[]; defaults?: Record<string, unknown> }
export interface ImageProvider {
  id: string; label: string
  public(): { model?: string; hasKey?: boolean; ratios?: string[]; resolutions?: string[]; referenceImages?: boolean; referenceVideos?: boolean; baseUrl?: string; modelCatalog?: boolean; catalogVersion?: string; resumable?: boolean }
  /** Freeze private config in this closure; never return credentials as public/task metadata. */
  prepare(input: GenerationInput): PreparedGeneration
  resume?(job: GenerationJob): PreparedGeneration
  listModels?(options?: { query?: string; kind?: string; type?: string; offset?: number; limit?: number; refresh?: boolean; ids?: string[] }): Promise<{ items: ModelSummary[]; total: number; catalogTotal: number; types: string[]; updatedAt: number; offset: number; limit: number }>
  getModel?(id: string): Promise<ModelDefinition>
}
export interface GenerationJob { resultNodeId?: string; id: string; boardId: string; nodeId: string; provider: string; model: string; input: GenerationInput; outputKind?: 'image' | 'video'; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted' | 'paused' | 'uncertain' | 'detached'; createdAt: number; promptText?: string; endedAt?: number; assetId?: string; assetIds?: string[]; resultAssetIds?: string[]; error?: string; remote?: RemoteCheckpoint; autoResume?: boolean }
export interface ImageGeneration {
  register(owner: Context, provider: ImageProvider): () => unknown
  read(): GenerationJob[]
  listProviders(): ({ id: string; label: string } & ReturnType<ImageProvider['public']>)[]
  start(input: { requestId: string; boardId: string; nodeId: string; revision: number }): Promise<GenerationJob>
  cancel(id: string, message?: string): Promise<void>
  resume(id: string): Promise<GenerationJob>
  detach(id: string): Promise<void>
  recover(providerId: string): Promise<void>
  provider(id: string): ImageProvider
  close(): Promise<void>
}
declare module '@cordis-notebook/host' { interface ServerServices { imageGeneration: ImageGeneration } }
