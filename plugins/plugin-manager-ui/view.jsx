export function mountManager(ctx, sdk, root, dependencies) {
  const { h, React, Button, Input, Icon, Slot, Badge, Tabs, TabsList, TabsTrigger, TabsContent } = ctx.ui,
    api = ctx.pluginManagement
  const Fragment = React.Fragment
  const category = (p) => p.category?.id || 'features'
  function Manager() {
    ctx.ui.useObserve(ctx, api)
    const state = api.current(),
      plugins = state.plugins,
      categories = [...new Map(plugins.map(p => [category(p), p.category?.label || '功能'])).entries()],
      busy = state.working || !!state.pendingConfig || !!state.pendingSwitch
    const [tab, setTab] = React.useState('all'),
      [query, setQuery] = React.useState(''),
      [selected, setSelected] = React.useState(null)
    const [installOpen, setInstallOpen] = React.useState(false),
      [pkg, setPackage] = React.useState(null),
      [trust, setTrust] = React.useState(false),
      [error, setError] = React.useState('')
    const [confirmation, setConfirmation] = React.useState(''),
      [clearOpen, setClearOpen] = React.useState(false)
    const visible = plugins.filter(
      (p) =>
        (tab === 'all' || category(p) === tab) &&
        (p.name + ' ' + p.id + ' ' + p.description).toLowerCase().includes(query.toLowerCase())
    )
    const plugin = visible.find((p) => p.id === selected) || visible[0]
    const run = (action) => {
      setError('')
      return Promise.resolve()
        .then(action)
        .catch((e) => setError(e.message))
    }
    const select = (id) => {
      setSelected(id)
      setClearOpen(false)
      setConfirmation('')
    }
    const load = async (event) => {
      setPackage(null)
      setTrust(false)
      setError('')
      const file = event.target.files[0]
      if (!file) return
      try {
        if (file.size > 2 * 1024 * 1024) throw Error('插件包不能超过 2 MB')
        const value = JSON.parse(await file.text())
        if (!value || !value.files || typeof value.files !== 'object' ||
          !['id', 'name', 'version'].every(key => typeof value.manifest?.[key] === 'string')) {
          throw Error('请选择有效的 .cordis-plugin.json 文件')
        }
        setPackage(value)
      } catch (e) {
        setError(e.message)
      }
    }
    return (
      <>
        <div className="manager-hero">
          <div>
            <span className="section-eyebrow">打造你的工作空间</span>
            <h2>插件中心</h2>
            <p>
              {plugins.filter((p) => p.state === 'enabled').length} 个运行中 <span> / </span> {plugins.length}{' '}
              个已安装
            </p>
          </div>
          <div className="manager-hero-actions">
            <Button variant="outline" disabled={busy} onClick={() => setInstallOpen(!installOpen)}>
              <Icon name="Plus" />
              安装插件
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={busy}
              aria-label="关闭插件管理"
              onClick={() => api.close()}
            >
              <Icon name="X" />
            </Button>
          </div>
        </div>
        {installOpen && (
          <section className="install-panel">
            <h3>安装本地插件包</h3>
            <p>第三方插件以当前账户权限访问文件、网络并执行命令。只安装你信任的来源。</p>
            <input type="file" accept=".json" aria-label="选择插件安装包" disabled={busy} onChange={load} />
            {pkg && (
              <>
                <p>
                  <strong>{pkg.manifest.name}</strong> · {pkg.manifest.id} · v{pkg.manifest.version}
                </p>
                <label className="trust-check">
                  <input
                    type="checkbox"
                    checked={trust}
                    disabled={busy}
                    onChange={(e) => setTrust(e.target.checked)}
                  />
                  我信任此插件，并允许它运行前后端代码。
                </label>
                <Button
                  disabled={!trust || busy}
                  onClick={() =>
                    run(async () => {
                      await api.install(pkg)
                      setPackage(null)
                      setTrust(false)
                      setInstallOpen(false)
                      sdk.toast('安装完成，可在列表中启用。')
                    })
                  }
                >
                  确认安装
                </Button>
              </>
            )}
          </section>
        )}
        {error && (
          <div className="manager-error" role="alert">
            <Icon name="AlertCircle" />
            {error}
          </div>
        )}
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value)
            select(null)
          }}
        >
          <div className="manager-filters">
            <TabsList aria-label="插件分类">
              {categories.map(([id, label]) => <TabsTrigger key={id} value={id}>{label}</TabsTrigger>)}
              <TabsTrigger value="all">全部</TabsTrigger>
              <TabsTrigger value="dependencies">依赖关系</TabsTrigger>
            </TabsList>
            {tab !== 'dependencies' && (
              <div className="manager-search">
                <Icon name="Search" />
                <Input
                  aria-label="搜索插件"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索插件…"
                />
              </div>
            )}
          </div>
          {[...categories.map(([id]) => id), 'all'].map((value) => (
            <TabsContent value={value} key={value}>
              <div className="manager-browser">
                <div
                  className="manager-plugin-list"
                  aria-label="插件列表"
                >
                  {visible.map((p) => (
                    <button
                      key={p.id}
                      className={'manager-plugin-row' + (p.id === plugin?.id ? ' active' : '')}
                      aria-pressed={p.id === plugin?.id}
                      onClick={() => select(p.id)}
                    >
                      {p.swatch ? (
                        <span className="theme-preview" style={{ background: p.swatch }}>
                          <span />
                          <span />
                        </span>
                      ) : (
                        <span className="plugin-icon">
                          <Icon name={p.icon || 'Puzzle'} size={20} />
                        </span>
                      )}
                      <span className="plugin-row-content">
                        <strong>{p.name}</strong>
                        <small>{p.description}</small>
                      </span>
                      <span className={'status-dot ' + p.state} aria-label={api.labels[p.state]} />
                    </button>
                  ))}
                  {!visible.length && (
                    <div className="no-results">
                      <Icon name="Search" />
                      <strong>没有找到插件</strong>
                      <p>尝试其他关键词或分类。</p>
                    </div>
                  )}
                </div>
                <aside className="manager-plugin-detail" aria-label="插件详情">
                  {plugin && (
                    <>
                      <div className="detail-heading">
                        <span className="plugin-icon large">
                          <Icon name={plugin.icon || 'Puzzle'} size={25} />
                        </span>
                        <Badge variant={plugin.state === 'failed' ? 'destructive' : 'secondary'}>
                          {api.labels[plugin.state]}
                        </Badge>
                      </div>
                      <h3>{plugin.name}</h3>
                      <p>{plugin.description}</p>
                      <span className="detail-version">
                        v{plugin.version} · {plugin.builtin ? '内置插件' : '第三方插件'}
                      </span>
                      <div className="detail-actions">
                        <Button
                          disabled={busy || ['starting', 'stopping'].includes(plugin.state)}
                          variant={plugin.enabled ? 'outline' : 'default'}
                          onClick={() => run(() => api.toggle(plugin, !plugin.enabled))}
                        >
                          {plugin.exclusiveGroup
                            ? plugin.enabled
                              ? '停用插件'
                              : '使用此插件'
                            : plugin.enabled
                              ? '停用插件'
                              : '启用插件'}
                        </Button>
                        {plugin.settings && (
                          <Button variant="outline" disabled={busy} onClick={() => api.settings(plugin)}>
                            <Icon name="Settings2" />
                            设置
                          </Button>
                        )}
                        {plugin.enabled && ['failed', 'disabled'].includes(plugin.clientState) && (
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() => run(() => api.retry(plugin))}
                          >
                            重试前端
                          </Button>
                        )}
                      </div>
                      {(plugin.error || plugin.configError) && (
                        <p className="plugin-error" role="alert">
                          {plugin.error || plugin.configError}
                        </p>
                      )}
                      {plugin.waitingFor?.length > 0 && <p>正在等待：{plugin.waitingFor.join('、')}</p>}
                      <details className="technical-details">
                        <summary>技术详情与依赖</summary>
                        <dl>
                          <dt>插件 ID</dt>
                          <dd>{plugin.id}</dd>
                          <dt>后端</dt>
                          <dd>{api.labels[plugin.serverState]}</dd>
                          <dt>本页前端</dt>
                          <dd>{api.labels[plugin.clientState]}</dd>
                        </dl>
                        {['server', 'client'].map(
                          (scope) =>
                            plugin.provides?.[scope]?.length > 0 && (
                              <p key={scope}>
                                {scope === 'server' ? '后端' : '前端'}提供：
                                {plugin.provides[scope].join('、')}
                              </p>
                            )
                        )}
                        {api.relations(plugin).map((r, i) => (
                          <p key={i}>
                            {r.scope === 'server' ? '后端' : '前端'}需要 {r.name} →{' '}
                            {r.host ? '宿主' : plugins.find((p) => p.id === r.provider)?.name || '缺少服务'}
                            {!r.host && !r.bound ? '（等待绑定）' : ''}
                          </p>
                        ))}
                        {plugin.dependencies.length > 0 && (
                          <p>插件包依赖：{plugin.dependencies.join('、')}</p>
                        )}
                      </details>
                      {plugin.logs?.length > 0 && (
                        <details className="technical-details">
                          <summary>运行日志</summary>
                          <pre>{plugin.logs.join('')}</pre>
                        </details>
                      )}
                      {!plugin.builtin && (
                        <div className="plugin-danger-zone">
                          <Button
                            variant="outline"
                            disabled={busy || plugin.state !== 'disabled'}
                            onClick={() => run(() => api.uninstall(plugin))}
                          >
                            卸载并保留数据
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={busy || plugin.state !== 'disabled'}
                            onClick={() => setClearOpen(!clearOpen)}
                          >
                            清理数据…
                          </Button>
                          {clearOpen && (
                            <>
                              <label>
                                输入插件 ID「{plugin.id}」确认永久删除其数据
                                <Input
                                  aria-label="确认清理的插件 ID"
                                  value={confirmation}
                                  onChange={(e) => setConfirmation(e.target.value)}
                                />
                              </label>
                              <Button
                                variant="destructive"
                                disabled={busy || plugin.state !== 'disabled' || confirmation !== plugin.id}
                                onClick={() =>
                                  run(async () => {
                                    await api.clearData(plugin, confirmation)
                                    setClearOpen(false)
                                    setConfirmation('')
                                  })
                                }
                              >
                                永久清理
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </aside>
              </div>
            </TabsContent>
          ))}
          <TabsContent value="dependencies">
            <Slot node={dependencies} />
          </TabsContent>
        </Tabs>
        <footer className="manager-bottom">
          <span>停用插件前会检查未完成的操作</span>
          <span>管理入口始终可用</span>
        </footer>
      </>
    )
  }
  ctx.ui.mount(ctx, root, <Manager />)
}
