import { Service } from 'cordis'
import { documentService } from './document.js'
export const richText = {
  apply(ctx) {
    Object.assign(new Service(ctx, 'richText'), documentService)
  },
}
