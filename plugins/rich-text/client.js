import { documentService } from './document.js'
import { mountEditor } from './engine.js'
export default function (ctx, sdk) {
  sdk.provide('richText', { ...documentService, mount: mountEditor })
}
