export async function mountStyles(ctx, plugin, developmentStyles) {
  await Promise.all((plugin.styles || []).map(name => new Promise((resolve, reject) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = developmentStyles?.[name] || `/builtin/${plugin.id}/${name}${plugin.resourceQuery ? "?" + plugin.resourceQuery : ""}`
    let done = false
    const finish = error => {
      if (done) return
      done = true; clearTimeout(timer); link.onload = link.onerror = null
      error ? reject(error) : resolve()
    }
    const timer = setTimeout(() => finish(new Error(`样式加载超时：${name}`)), 10000)
    link.onload = () => finish()
    link.onerror = () => finish(new Error(`样式加载失败：${name}`))
    ctx.effect(() => { document.head.append(link); return () => { finish(new Error('样式所属插件已停用')); link.remove() } })
  })))
}
