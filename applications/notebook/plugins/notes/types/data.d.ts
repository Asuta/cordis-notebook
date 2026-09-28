export interface Note {
  readonly type?: string
  readonly [field: string]: unknown
  readonly id: string
  readonly title: string
  readonly content: string
  readonly pinned: boolean
  readonly createdAt: string
  readonly updatedAt: string
  /** 手动排序序号，越小越靠前；未排序的笔记按更新时间排列。 */
  readonly order?: number
}
export type NotePatch = Partial<Pick<Note, 'title' | 'content' | 'pinned'>> & Record<string, unknown>
