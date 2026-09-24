/** Each activation gets a fresh, lifecycle-owned settings binding. */
export function configBinding(ctx, initial = {}) {
  let value = Object.freeze({ ...initial }), disposed = false
  let controller = new AbortController()
  const listeners = new Set()
  ctx.effect(() => () => { disposed = true; controller.abort(); listeners.clear() })
  return {
    get value() { return value },
    onChange(callback) { return ctx.effect(() => { listeners.add(callback); return () => listeners.delete(callback) }) },
    cancel() { controller.abort() },
    async update(next) {
      if (disposed) throw new Error('插件配置上下文已释放')
      if (!listeners.size) throw new Error('插件声明即时应用，但没有注册配置处理器')
      controller.abort(); controller = new AbortController()
      value = Object.freeze({ ...next })
      const signal = controller.signal
      const results = await Promise.allSettled([...listeners].map(async callback => callback(value, signal)))
      const failures = results.filter(result => result.status === 'rejected')
      if (failures.length) throw new Error(failures.map(result => result.reason.message || String(result.reason)).join('；'))
    },
  }
}
