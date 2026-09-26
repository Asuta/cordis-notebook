/** Named mount points are owned by their providers, independently of plugin IDs. */
export function createMounts() {
  const slots = new Map()
  return {
    register(owner, name, target) {
      if (slots.has(name)) throw new Error(`插槽已被占用：${name}`)
      const mount = typeof target === 'function' ? target : (consumer, node) => {
        consumer.effect(() => { target.append(node); return () => node.remove() })
        return node
      }
      owner.effect(() => { slots.set(name, mount); return () => { if (slots.get(name) === mount) slots.delete(name) } })
    },
    mount(owner, name, node) {
      const mount = slots.get(name)
      if (!mount) throw new Error('缺少界面扩展服务：' + name)
      return mount(owner, node)
    },
  }
}
