import type { Context } from 'cordis'
import type {} from '@cordis-notebook/host'
export interface GenerationInput { prompt: string; assetIds: string[]; ratio: string; resolution: string }
export interface ImageProvider {
  id: string; label: string
  public(): { model?: string; hasKey?: boolean; ratios?: string[]; resolutions?: string[]; referenceImages?: boolean; baseUrl?: string }
  /** Freeze private config in this closure; never return credentials as public/task metadata. */
  prepare(input: GenerationInput): { model: string; generate(images: Buffer[], signal: AbortSignal): Promise<Buffer> }
}
export interface GenerationJob { id: string; boardId: string; nodeId: string; provider: string; model: string; input: GenerationInput; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted'; createdAt: number; endedAt?: number; assetId?: string; error?: string }
export interface ImageGeneration {
  register(owner: Context, provider: ImageProvider): () => unknown
  read(): GenerationJob[]
  listProviders(): ({ id: string; label: string } & ReturnType<ImageProvider['public']>)[]
  start(input: { requestId: string; boardId: string; nodeId: string; revision: number }): Promise<GenerationJob>
  cancel(id: string, message?: string): Promise<void>
  close(): Promise<void>
}
declare module '@cordis-notebook/host' { interface ServerServices { imageGeneration: ImageGeneration } }
