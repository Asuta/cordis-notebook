export interface Note {
  readonly type?: string
  readonly [field: string]: unknown
  /** Server revision; legacy imported notes start at zero. */
  readonly revision?: number
  readonly id: string
  readonly title: string
  /** plain 的正文；其他格式由 toText 派生的纯文本，不保证保留空行或块结构。Markdown 源码在 markdown 字段。 */
  readonly content: string
  readonly pinned: boolean
  readonly createdAt: string
  readonly updatedAt: string
  /** 手动排序序号，越小越靠前；未排序的笔记按更新时间排列。 */
  readonly order?: number
}
export type NotePatch = Partial<Pick<Note, 'title' | 'content' | 'pinned'>> & Record<string, unknown>
