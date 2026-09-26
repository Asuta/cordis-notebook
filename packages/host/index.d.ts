import type { Context, Inject, Plugin } from 'cordis'
export interface ClientServices {}
export interface ServerServices {}
type ScopedPlugin<C> = Plugin.Base & (
  | ((ctx: C, config: any) => any)
  | (new (ctx: C, config: any) => any)
  | { apply(ctx: C, config: any): any }
)
type PluginParameters<C, P> = P extends (ctx: C, ...args: infer A) => any ? A
  : P extends new (ctx: C, ...args: infer A) => any ? A
  : P extends { apply(ctx: C, ...args: infer A): any } ? A : never
type PluginConfig<C, P> = P extends Plugin.Transform<infer Input, any> ? Input : PluginParameters<C, P>[0]
type PluginArgs<C, P> = undefined extends PluginConfig<C, P>
  ? [config?: PluginConfig<C, P>] : [config: PluginConfig<C, P>]
/** Keep Cordis ownership and config inference while carrying the side's service map. */
interface ScopedContext extends Context {
  inject(deps: Inject, callback: (ctx: this, config: void) => any): ReturnType<Context['inject']>
  inject(deps: Inject, callback: Plugin.Function<void>): ReturnType<Context['inject']>
  plugin<P extends ScopedPlugin<this>>(plugin: P, ...args: PluginArgs<this, P>): ReturnType<Context['plugin']>
  plugin<P extends Plugin>(plugin: P, ...args: PluginArgs<Context, P>): ReturnType<Context['plugin']>
}
/** Service maps are augmented by capability owners, independently for each side. */
export interface ClientContext extends ScopedContext, ClientServices {}
export interface ServerContext extends ScopedContext, ServerServices {}
export type Validation = void | string | false | null
export interface StopChange {
  readonly reason: 'disable' | 'reload' | 'switch' | 'configure' | 'application'
  /** Direct operation targets. All preparation listeners may protect their state. */
  readonly targets: readonly string[]
}
export interface StopRequest extends StopChange {
  /** Register before awaiting work. Runs after success, rejection or failure. */
  hold(release: () => void | Promise<void>): void
}
export interface ClientSDK {
  readonly id: string
  readonly application: { id: string; name: string; legacyBrowserStorage?: boolean }
  readonly storage: { local: Storage; session: Storage }
  /** Aborted on startup timeout or activation disposal. */
  readonly signal: AbortSignal
  readonly config: Readonly<Record<string, string | number | boolean>>
  onConfig(callback: (config: Readonly<Record<string, string | number | boolean>>, signal: AbortSignal) => void | Promise<void>): () => unknown
  provide<T extends object>(name: string, value: T): T
  request<T = unknown>(path: string, method?: string, data?: unknown): Promise<T>
  service<K extends keyof ClientServices>(name: K): ClientServices[K]
  effect(callback: () => void | (() => void | Promise<void>)): () => unknown
  listen(target: EventTarget, event: string, handler: EventListener): void
  guard(callback: () => void | Promise<void>): () => unknown
  slot(name: string, target: HTMLElement | ((owner: Context, node: HTMLElement) => HTMLElement)): void
  mount(name: string, node: HTMLElement): HTMLElement
  watch(service: { observe(owner: Context, handler: () => void): unknown } | EventTarget, handler: () => void): unknown
  button(slot: string, label: string, handler: () => unknown): HTMLElement
  toast(message: string): void
  el<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Record<string, unknown>, text?: string): HTMLElementTagNameMap[K]
}
export interface ConfigField {
  type: 'string' | 'number' | 'boolean'
  label: string
  description?: string
  default: string | number | boolean
  min?: number
  max?: number
  step?: number
  integer?: boolean
  maxLength?: number
  options?: readonly { label: string; value: string | number | boolean }[]
}
export interface ConfigSchema { mode: 'live' | 'restart'; fields: Record<string, ConfigField> }

declare module 'cordis' {
  interface Events {
    /** @mode serial */
    'plugins/before-stop'(request: StopRequest): Validation | Promise<Validation>
    /** @mode parallel */
    'plugins/remote-stop'(change: { readonly targets: readonly string[] }): void | Promise<void>
  }
}
