export interface Note {
  readonly type?: string
  readonly [field: string]: unknown
  readonly id: string
  readonly title: string
  readonly content: string
  readonly pinned: boolean
  readonly createdAt: string
  readonly updatedAt: string
}
export type NotePatch = Partial<Pick<Note, 'title' | 'content' | 'pinned'>> & Record<string, unknown>
