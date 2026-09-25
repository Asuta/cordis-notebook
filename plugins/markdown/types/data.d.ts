export interface MarkdownService {
  render(source: string): string
  toText(source: string): string
}
