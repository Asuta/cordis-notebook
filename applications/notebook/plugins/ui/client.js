import { createUI } from './runtime.jsx'
export default function(ctx, sdk) {
  sdk.provide('ui', createUI())
}
