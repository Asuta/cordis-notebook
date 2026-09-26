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
    const [error, setError] = React.useState('')
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
    const select = (id) => setSelected(id)
    return (
      <>
        <div className="manager-hero">
          <div>
            <span className="section-eyebrow">打造你的工作空间</span>
            <h2>插件中心</h2>
            <p>
              {plugins.filter((p) => p.state === 'enabled').length} 个运行中 <span> / </span> {plugins.length}{' '}
              个已发现
            </p>
          </div>
          <div className="manager-hero-actions">
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
                        v{plugin.version} · workspace 插件
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
                        {Object.keys(plugin.packageDependencies || {}).length > 0 && (
                          <p>代码包依赖：{Object.keys(plugin.packageDependencies).join('、')}</p>
                        )}
                      </details>
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
