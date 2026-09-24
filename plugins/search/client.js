import { mountSearch } from './view.bundle.js'
export default function (ctx, sdk) {
  const root = sdk.el('div')
  sdk.mount('list-filters', root)
  const filter = ctx.notebook.registerFilter(ctx, 'search', () => true)
  mountSearch(ctx, root, filter)
}
