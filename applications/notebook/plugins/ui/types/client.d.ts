import type { Context } from 'cordis'
import type * as React from 'react'
export interface UIService {
  readonly React: typeof React
  readonly h: typeof React.createElement
  createPortal(children: React.ReactNode, container: Element | DocumentFragment): React.ReactPortal
  mount(owner: Context, container: HTMLElement, content: React.ReactNode): { render(content: React.ReactNode): void }
  useObserve<T extends { observe(owner: Context, handler: () => void): () => unknown }>(owner: Context, service: T): T
  readonly Button: React.ComponentType<any>
  readonly Input: React.ComponentType<any>
  readonly Icon: React.ComponentType<{ name: string; size?: number }>
  readonly Slot: React.ComponentType<{ node: HTMLElement; className?: string }>
  readonly [component: string]: unknown
}


import type {} from '@cordis-notebook/host'
declare module '@cordis-notebook/host' { interface ClientServices { ui: UIService } }
