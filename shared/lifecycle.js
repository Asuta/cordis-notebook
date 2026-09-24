// Cordis 4.0.0-rc.10 FiberState; configuration intent is kept separately.
const states = ['waiting', 'starting', 'enabled', 'failed', 'disabled', 'stopping']
export const runtimeState = fiber => fiber ? states[fiber.state] || 'failed' : 'disabled'
export const actualFiber = fiber => fiber?.ctx.fiber
export function bindingsFor(fiber, entries) {
  return Object.fromEntries(Object.entries(fiber?.store || {}).map(([name, impl]) => [name,
    [...entries].find(([, entry]) => actualFiber(entry.fiber) === impl.fiber)?.[0] || '@host']))
}
