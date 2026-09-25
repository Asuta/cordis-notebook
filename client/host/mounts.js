/** Named mount points are owned by their providers, independently of plugin IDs. */
export function createMounts() {
  const slots = new Map()
  const providers = new Map()
  return {
    register(owner, name, target, { provider = false } = {}) {
      const registry = provider ? providers : slots
      if (registry.has(name)) throw new Error(`插槽已被占用：${name}`)
      const mount = typeof target === 'function' ? target : (consumer, node) => {
        consumer.effect(() => { target.append(node); return () => node.remove() })
        return node
      }
      owner.effect(() => { registry.set(name, mount); return () => { if (registry.get(name) === mount) registry.delete(name) } })
    },
    mount(owner, name, node, { provider = false } = {}) {
      const mount = provider ? providers.get(name) || slots.get(name) : slots.get(name) || providers.get(name)
      if (!mount) throw new Error('缺少界面扩展服务：' + name)
      return mount(owner, node)
    },
  }
}
