import { mountManager } from './view.jsx'
export default function (ctx, sdk) {
  const root = sdk.el('div')
  ctx.pluginManagement.attach(ctx, root)
  const dependencies = ctx.pluginManagement.dependencyTree(ctx)
  mountManager(ctx, sdk, root, dependencies)
}
