export function provideMounts(sdk, serviceName, targets, onChange = () => {}) {
  return sdk.provide(serviceName, {
    mount(owner, name, node) {
      const target = targets[name]
      if (!target) throw new Error(`${serviceName} 未提供扩展位：${name}`)
      owner.effect(() => { target.append(node); onChange(name, node, true); return () => { node.remove(); onChange(name, node, false) } })
      return node
    },
  })
}
