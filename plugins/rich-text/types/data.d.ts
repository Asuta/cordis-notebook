export interface TextRun {
  readonly text: string
  readonly format?: Readonly<Partial<Record<'bold' | 'italic' | 'underline' | 'strike' | 'superscript' | 'subscript' | 'code', boolean>> & { font?: string; size?: number; color?: string; highlight?: string; link?: string }>
}
export interface OutlineElement {
  readonly id: string
  readonly kind: 'paragraph' | 'heading' | 'code' | 'quote' | 'list' | 'item' | 'table' | 'row' | 'cell' | 'image' | 'rule'
  readonly runs?: readonly TextRun[]
  readonly children?: readonly OutlineElement[]
  readonly indent?: number
  readonly align?: 'left' | 'center' | 'right' | 'justify'
  readonly tag?: 'todo' | 'important' | 'question' | 'definition' | 'idea' | null
  readonly checked?: boolean
  readonly collapsed?: boolean
  readonly level?: number
  readonly ordered?: boolean
  readonly start?: number
  readonly header?: boolean
  readonly colspan?: number
  readonly rowspan?: number
  readonly widths?: readonly number[]
  readonly src?: string
  readonly alt?: string
  readonly width?: number
  readonly height?: number
}
export interface OutlineDocument { readonly version: 1; readonly elements: readonly OutlineElement[] }
export interface RichDocumentService {
  normalize(input: unknown): OutlineDocument
  plain(text?: string, prefix?: string): OutlineDocument
  text(doc: OutlineDocument): string
  toEditor(doc: OutlineDocument): unknown
  fromEditor(json: unknown): OutlineDocument
}
