/// <reference types="node" />
import type { Context } from 'cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {} from './index'
export type { ServerContext } from './index'
export interface ServerRuntime {
  readonly id: string
  readonly dataDir: string
  readonly appDataDir: string
  /** Compatibility only; existing storage plugins may honor the old file override. */
  readonly legacyFile?: string
  readonly config: Readonly<Record<string, string | number | boolean>>
  onConfig(callback: (config: Readonly<Record<string, string | number | boolean>>, signal: AbortSignal) => void | Promise<void>): () => unknown
}
export interface HttpService {
  body(req: IncomingMessage): Promise<unknown>
  /** The route is removed automatically when its owner is disposed. */
  route(owner: Context, method: string, pattern: RegExp, handler: (request: { req: IncomingMessage; res: ServerResponse; pathname: string; match: RegExpMatchArray }) => unknown): void
}
declare module '@cordis-notebook/host' { interface ServerServices { http: HttpService } }
