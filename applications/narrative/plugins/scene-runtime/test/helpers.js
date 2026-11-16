import { setup, owner } from '../../project/test/helpers.js'
import runtimeClient from '../client.js'
import { builtinTypes } from '../../scene-ui/types.js'

export async function setupScene(t, options = {}) {
  const f = await setup(t, { template: 'salon', ...options }), ctx = owner(), typeOwner = owner()
  ctx.narrative = f.engine
  let scene
  runtimeClient(ctx, { provide: (_, value) => { scene = value }, agent: { register: (d, fn) => f.tools.set(d.name, fn) } })
  for (const d of builtinTypes()) scene.register(typeOwner, d)
  f.engine.update(p => { for (const s of p.composition.scenes) for (const o of s.objects) if (o.type === 'conversation') o.props.source = 'script' })
  f.ctx.effect(() => async () => { await ctx.dispose(); await typeOwner.dispose() })
  return { ...f, scene, sceneOwner: ctx, typeOwner }
}
