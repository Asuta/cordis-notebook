import { Context, Service } from 'cordis'
import { ClientPlugins } from './plugin-host.js'
import { serviceRelations } from '../../shared/plugin-relations.js'
import { createDependencyView } from './dependency-view.js'
import { StopCoordinator } from './stop-coordinator.js'
import { createSettingsView } from './settings-view.js'
import { applyConfiguration } from './config-transaction.js'
import { createMounts } from './mounts.js'
import { mountStyles } from './styles.js'
import { applicationStorage } from './application-storage.js'
import { applicationView } from './application-view.js'
import { createAgentBridge } from './agent-bridge.js'
import { installDevelopmentSave } from './development-save.js'
let application = await (await fetch('/api/applications')).json()
const pageSession = application.session
let development = import.meta.hot ? await (await fetch('/__cordis/dev')).json() : null
let leaving = false
const $ = s => document.querySelector(s), root = new Context(), failures = new Map(), mounts = createMounts()
mounts.register(root, 'app', $('#app'))
const updatePlaceholder = () => { $('#app-placeholder').hidden = $('#app').childElementCount > 0 }
new MutationObserver(updatePlaceholder).observe($('#app'), { childList: true })
updatePlaceholder()
const stopping = new StopCoordinator(root, error => toast(error.message))
const agentBridge = createAgentBridge({ application: application.current, session: pageSession, stopping, window, document })
let snapshot = { plugins: [] }, syncQueue = Promise.resolve(), working = false
async function request(path, method = 'GET', data, signal) {
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json', 'X-Application-Session': pageSession }, signal, ...(data === undefined ? {} : { body: JSON.stringify(data) }) })
  const result = await response.json(); if (!response.ok) throw new Error(result.error || '请求失败'); return result
}
function toast(message) { const node = $('#toast'); const dialog = [...document.querySelectorAll('dialog[open]')].at(-1); (dialog || document.body).append(node); node.textContent = message; node.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => node.hidden = true, 6000) }
function el(tag, props = {}, text) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) { if (key === 'class') node.className = value; else if (key.startsWith('aria-')) node.setAttribute(key, value); else node[key] = value }
  if (text !== undefined) node.textContent = text; return node
}
function sdkFor(ctx, plugin) {
  const controller = new AbortController(); ctx.effect(() => () => controller.abort())
  const sdk = {
    id: plugin.id, el, toast,
    agent: agentBridge.forOwner(ctx),
    application: application.current,
    storage: { local: applicationStorage(localStorage, application.current.id, plugin.id), session: applicationStorage(sessionStorage, application.current.id, plugin.id) },
    request: (path, method, data) => request(path, method, data, controller.signal),
    provide(name, value) { return new class extends Service { constructor() { super(ctx, name); Object.defineProperties(this, Object.getOwnPropertyDescriptors(value)) } }() },
    service: name => ctx[name], effect: callback => ctx.effect(callback),
    listen(target, event, handler) { target.addEventListener(event, handler); ctx.effect(() => () => target.removeEventListener(event, handler)) },
    guard(callback) { return ctx.on('plugins/before-stop', async () => { await callback() }) },
    slot(name, target) { mounts.register(ctx, name, target) },
    mount(name, node) { return mounts.mount(ctx, name, node) },
    watch(service, handler) { if (service.observe) return service.observe(ctx, handler); service.addEventListener('change', handler); ctx.effect(() => () => service.removeEventListener('change', handler)); handler() },
    button(slot, label, handler) { const button = el('button', {}, label); sdk.listen(button, 'click', () => Promise.resolve().then(handler).catch(error => toast(error.message))); return sdk.mount(slot, button) },
  }; return sdk
}
const host = new ClientPlugins(root, {
  stylesFor: (ctx, plugin) => mountStyles(ctx, { ...plugin, resourceQuery: 'appSession=' + pageSession }, development?.plugins?.[application.current?.id]?.[plugin.id]?.styles),
  sdkFor, load: plugin => import(/* @vite-ignore */ development?.plugins?.[application.current?.id]?.[plugin.id]?.client
    ? development.plugins[application.current.id][plugin.id].client + '?t=' + development.version
    : '/builtin/' + plugin.id + '/' + plugin.client + '?generation=' + plugin.generation + '&attempt=' + plugin.attempt + '&appSession=' + pageSession),
  onChange: () => queueMicrotask(renderManager),
})
const settingsView = createSettingsView({ el, getSnapshot: () => snapshot, save: (plugin, config) => operate(() => saveConfig(plugin, config), true) })
const applicationsView = applicationView({ el, change: id => operate(() => switchApplication(id)) })
const labels = { waiting: '等待服务', 'not-applicable': '无需运行', enabled: '运行中', disabled: '已停用', starting: '启动中', stopping: '停止中', failed: '运行失败' }
const managerListeners = new Set()
const management = new Service(root, 'pluginManagement')
Object.assign(management, {
  labels,
  current: () => ({ ...snapshot, plugins: snapshot.plugins.map(p => host.describe(p)), working: working || application.phase !== 'idle' }),
  observe(owner, handler) { return owner.effect(() => { managerListeners.add(handler); handler(); return () => managerListeners.delete(handler) }) },
  attach(owner, node) { return owner.effect(() => {
    const dialog = $('#plugin-manager')
    const recover = () => { node.hidden = true; dialog.classList.remove('enhanced'); toast('插件中心界面加载失败，已切换到宿主管理界面。') }
    node.classList.add('manager-react'); node.addEventListener('cordis-ui-error', recover); dialog.append(node); dialog.classList.add('enhanced')
    return () => { node.removeEventListener('cordis-ui-error', recover); node.remove(); dialog.classList.remove('enhanced') }
  }) },
  close() { if (!working) $('#plugin-manager').close() },
  toggle(plugin, enabled) { return operate(() => changePlugin(plugin, enabled), true) },
  retry(plugin) { return operate(() => retryPlugin(plugin), true) },
  settings(plugin) { settingsView.open(plugin) },
  relations(plugin) { return serviceRelations(plugin, snapshot.plugins.map(p => host.describe(p))) },
  dependencyTree(owner) {
    const view = createDependencyView({ el, card: pluginCard, labels, failures }); view.host.id = 'react-dependency-view'; view.host.hidden = false
    owner.effect(() => () => view.destroy())
    management.observe(owner, () => view.render(snapshot.plugins.map(p => host.describe(p))))
    return view.host
  },
})
let managerView = 'cards'
try { if (localStorage.getItem('cordis-manager-view-' + (application.current?.id || 'host')) === 'tree') managerView = 'tree' } catch {}
const viewBar = el('div', { class: 'manager-viewbar', 'aria-label': '插件显示方式' }), viewButtons = el('div', { class: 'manager-view-switch' })
const cardsButton = el('button', { 'aria-pressed': 'true' }, '▦ 卡片视图'), treeButton = el('button', { 'aria-pressed': 'false' }, '⇄ 依赖网图')
viewButtons.append(cardsButton, treeButton); viewBar.append(el('span', {}, '浏览插件'), viewButtons)
const dependencyView = createDependencyView({ el, card: pluginCard, labels, failures })
root.effect(() => () => dependencyView.destroy())
$('#plugin-list').before(viewBar, dependencyView.host)
function setManagerView(view) { managerView = view; try { localStorage.setItem('cordis-manager-view-' + (application.current?.id || 'host'), view) } catch {}; renderManager() }
cardsButton.onclick = () => setManagerView('cards'); treeButton.onclick = () => setManagerView('tree')
function renderManager() {
  applicationsView.render(application, working)
  settingsView.update(snapshot, working)
  $('#close-manager').disabled = working
  const visiblePlugins = snapshot.plugins.map(p => host.describe(p))
  failures.clear()
  for (const p of visiblePlugins) if (p.clientState === 'failed') failures.set(p.id, { message: p.error })
  $('#plugin-list').replaceChildren()
  $('#plugin-summary').textContent = `${visiblePlugins.filter(p => p.state === 'enabled').length} 个运行中 / ${snapshot.plugins.length} 个已发现 · Cordis 双端插件运行时`
  const tree = managerView === 'tree'
  $('#plugin-list').hidden = tree; dependencyView.host.hidden = !tree
  cardsButton.setAttribute('aria-pressed', String(!tree)); treeButton.setAttribute('aria-pressed', String(tree))
  if (tree) dependencyView.render(visiblePlugins)
  else for (const plugin of visiblePlugins) $('#plugin-list').append(pluginCard(plugin))
  for (const handler of managerListeners) handler()
}
function pluginCard(plugin, id = 'plugin-' + plugin.id) {
    const exclusive = plugin.exclusiveGroup
    const busy = working || application.phase !== 'idle' || !!snapshot.pendingSwitch || !!snapshot.pendingConfig
    const card = el('article', { class: 'plugin-card', id }), top = el('div', { class: 'plugin-heading' })
    top.append(el('strong', {}, plugin.name), el('span', { class: 'plugin-status ' + (failures.has(plugin.id) ? 'failed' : plugin.state) }, failures.has(plugin.id) ? '前端失败' : labels[plugin.state]))
    card.append(top, el('p', {}, plugin.description), el('small', {}, `${plugin.id} · v${plugin.version} · workspace 插件`))
    if (Object.keys(plugin.packageDependencies || {}).length) card.append(el('small', {}, '代码包依赖：' + Object.keys(plugin.packageDependencies).join('、')))
    if (exclusive) {
      const group = el('div', { class: 'theme-group' }), swatch = el('i', { class: 'theme-swatch', 'aria-hidden': 'true' })
      swatch.style.background = plugin.swatch
      const current = snapshot.plugins.find(p => p.exclusiveGroup === exclusive && p.state === 'enabled')
      group.append(swatch, document.createTextNode(`${plugin.groupLabel || plugin.exclusiveGroup} · 单选组${current?.id === plugin.id ? ' · 当前选择' : current ? ' · 使用后替换' + current.name : ' · 当前未选择'}`)); card.append(group)
      if (snapshot.pendingSwitch?.group === exclusive) card.append(el('small', { role: 'status' }, '正在确认插件切换…'))
    }
    for (const scope of ['server', 'client']) {
      if (plugin.provides?.[scope]?.length) card.append(el('small', {}, (scope === 'server' ? '后端提供：' : '前端提供：') + plugin.provides[scope].join('、')))
    }
    for (const relation of serviceRelations(plugin, snapshot.plugins.map(p => host.describe(p)))) {
      const provider = snapshot.plugins.find(p => p.id === relation.provider)
      card.append(el('small', {}, (relation.scope === 'server' ? '后端需要：' : '前端需要：') + relation.name + ' → ' + (relation.host ? '宿主' : provider ? provider.name + (relation.bound ? '' : '（候选，未绑定）') : '暂无绑定')))
    }
    card.append(el('small', {}, '启用选择：' + (plugin.enabled ? '已开启' : '已关闭')))
    card.append(el('small', {}, '后端：' + labels[plugin.serverState] + ' · 本页前端：' + labels[plugin.clientState]))
    if (plugin.waitingFor?.length) card.append(el('small', { class: 'plugin-waiting' }, '等待：' + plugin.waitingFor.join('、')))
    const error = failures.get(plugin.id)?.message || plugin.error
    if (error) card.append(el('pre', { class: 'plugin-error' }, error))
    if (plugin.configError) card.append(el('p', { class: 'plugin-error' }, plugin.configError))
    const actions = el('div', { class: 'plugin-actions' }), on = plugin.enabled && plugin.state !== 'failed'
    const toggle = el('button', { disabled: busy || ['starting', 'stopping'].includes(plugin.state), 'aria-label': `${on ? '停用' : exclusive ? '使用' : '启用'}${plugin.name}` }, exclusive ? on ? '停用此插件' : '使用此插件' : on ? '停用' : plugin.state === 'failed' ? '重新启动' : '启用')
    toggle.onclick = () => operate(() => failures.has(plugin.id) && plugin.enabled ? retryPlugin(plugin) : changePlugin(plugin, !on)); actions.append(toggle)
    if (plugin.settings) {
      const settings = el('button', { disabled: busy, 'aria-label': `设置${plugin.name}` }, '设置…')
      settings.onclick = () => settingsView.open(plugin); actions.append(settings)
    }
    if (plugin.state === 'failed' && !exclusive) { const stop = el('button', { disabled: busy }, '停用'); stop.onclick = () => operate(() => changePlugin(plugin, false)); actions.append(stop) }
    if (plugin.enabled && ['failed', 'disabled'].includes(plugin.clientState)) { const retry = el('button', { disabled: busy }, '重载前端'); retry.onclick = () => operate(() => retryPlugin(plugin)); actions.append(retry) }
    card.append(actions); return card
}
async function changePlugin(plugin, enabled) {
  const targets = !enabled || plugin.state === 'failed' ? [plugin.id] : []
  if (plugin.exclusiveGroup) targets.push(...snapshot.plugins.filter(p => p.enabled && p.exclusiveGroup === plugin.exclusiveGroup).map(p => p.id))
  const action = async () => { try { await applyPluginChange(plugin, enabled) } finally { await scheduleSync() } }
  if (!targets.length) return action()
  return stopping.run({ reason: plugin.exclusiveGroup ? 'switch' : 'disable', targets: [...new Set(targets)] }, action)
}
async function retryPlugin(plugin) {
  return stopping.run({ reason: 'reload', targets: [plugin.id] }, () => {
    const task = syncQueue.then(() => host.retry(plugin.id))
    syncQueue = task.catch(() => {}); return task
  })
}
async function applyPluginChange(plugin, enabled) {
  const result = await request(`/api/plugins/${plugin.id}/toggle`, 'POST', { enabled })
  failures.delete(plugin.id)
  const pending = result.pendingSwitch
  if (!pending) return
  let loadError
  try {
    await scheduleSync()
    if (snapshot.pendingSwitch?.token !== pending.token) throw new Error('切换已取消，请重新选择插件')
    if (pending.target) {
      const target = snapshot.plugins.find(p => p.id === pending.target)
      if (target.state !== 'enabled' || target.client && (host.state(pending.target) !== 'enabled' || host.entries.get(pending.target)?.generation !== target.generation)) throw new Error(failures.get(pending.target)?.message || '插件未成功启动')
    } else if (snapshot.plugins.some(p => p.client && p.exclusiveGroup === pending.group && host.state(p.id) === 'enabled')) throw new Error('原插件尚未完成卸载')
  } catch (error) { loadError = error }
  const confirmed = await request('/api/plugins/exclusive/confirm', 'POST', { token: pending.token, success: !loadError, error: loadError?.message })
  await scheduleSync()
  if (loadError) {
    const restoreFailed = pending.previous.some(id => host.state(id) !== 'enabled')
    throw new Error(restoreFailed ? `${confirmed.message}；原插件页面恢复失败，请重载前端。` : confirmed.message)
  }
  toast(pending.target ? `已切换为${plugin.name}` : '已停用此插件')
}
async function saveConfig(plugin, config) {
  plugin = { ...snapshot.plugins.find(p => p.id === plugin.id), configRevision: plugin.configRevision }
  const action = () => {
    const task = syncQueue.then(() => applyConfiguration({ plugin, config, host, request, synchronize, getSnapshot: () => snapshot }))
    syncQueue = task.catch(() => {}); return task
  }
  if (plugin.enabled && plugin.settings.mode === 'restart') await stopping.run({ reason: 'configure', targets: [plugin.id] }, action)
  else await action()
  toast(plugin.enabled ? '设置已保存并生效' : '设置已保存，下次启用时生效')
}
async function operate(fn, propagate = false) {
  if (working) return; working = true; renderManager()
  try { await fn() } catch (error) { toast(error.message); if (propagate) throw error } finally { working = false; await scheduleSync() }
}
async function synchronize() {
  if (leaving) return
  const next = await request('/api/plugins')
  if (next.application.session !== pageSession) return followApplication()
  application = next.application
  applicationsView.render(application, working)
  if (application.phase !== 'idle') return
  // A remote stop is already committed: disposal must not start another save
  // against disappearing services. Edits are backed up when they occur.
  if (next.pendingConfig?.backend) return
  const removed = snapshot.plugins.filter(p => p.enabled && p.client && !next.plugins.some(n => n.id === p.id && n.enabled)).map(p => p.id)
  if (removed.length && !stopping.running) await root.parallel('plugins/remote-stop', { targets: removed }).catch(error => toast(error.message))
  snapshot = next
  if (development) development = await (await fetch('/__cordis/dev')).json()
  await host.sync(snapshot.plugins)
  renderManager()
}
async function followApplication() {
  if (leaving) return
  leaving = true
  document.querySelector('#app').inert = true
  try {
    await root.parallel('plugins/remote-stop', { targets: snapshot.plugins.filter(p => p.enabled).map(p => p.id) })
  } catch (error) { toast(error.message) }
  try { await host.sync([]) } finally { location.reload() }
}
async function switchApplication(id) {
  if (leaving) return
  await stopping.run({ reason: 'application', targets: snapshot.plugins.filter(p => p.enabled).map(p => p.id) }, async () => {
    await request('/api/applications/switch', 'POST', { id, session: pageSession })
    await followApplication()
  })
}
function scheduleSync() { const task = syncQueue.then(synchronize); syncQueue = task.catch(error => { $('#connection').textContent = '连接中断'; toast(error.message) }); return syncQueue }
$('#manage-plugins').onclick = () => { $('#plugin-manager').showModal(); scheduleSync() }
$('#close-manager').onclick = () => $('#plugin-manager').close()
$('#plugin-manager').addEventListener('cancel', event => { if (working) event.preventDefault() })
$('#plugin-manager').addEventListener('close', () => { document.body.append($('#toast')); $('#toast').hidden = true })
$('#application-picker').addEventListener('close', () => { document.body.append($('#toast')); $('#toast').hidden = true })
const events = new EventSource('/api/events')
events.addEventListener('applications', event => {
  const next = JSON.parse(event.data)
  if (next.session !== pageSession && next.phase === 'idle') { void followApplication(); return }
  application = next; applicationsView.render(application, working)
})
events.addEventListener('plugins', () => { $('#connection').textContent = '本地连接正常'; scheduleSync() })
events.onerror = () => { $('#connection').textContent = '正在重新连接…' }
await scheduleSync()
document.documentElement.dataset.cordisReady = 'true'
if (import.meta.hot) {
  // CSS is updated without replacing the page, including after a build error.
  import.meta.hot.on('vite:beforeUpdate', () => document.querySelectorAll('vite-error-overlay').forEach(node => node.remove()))
  import.meta.hot.on('cordis:unchanged', () => document.querySelectorAll('vite-error-overlay').forEach(node => node.remove()))
  import.meta.hot.on('cordis:plugins', ({ version, targets }) => {
    const ids = targets[application.current?.id] || []
    if (!ids.length) return
    const task = syncQueue.then(() => stopping.run({ reason: 'reload', targets: snapshot.plugins.filter(p => p.enabled).map(p => p.id) }, async () => {
      development.version = version
      await host.reload(ids)
      document.querySelectorAll('vite-error-overlay').forEach(node => node.remove())
      renderManager()
    }))
    syncQueue = task.catch(error => toast('热更新未完成：' + error.message))
  })
  import.meta.hot.on('cordis:catalog', () => {
    void scheduleSync().then(() => document.querySelectorAll('vite-error-overlay').forEach(node => node.remove()))
  })
  const ready = () => import.meta.hot.send('cordis:ready', { application: application.current?.name || application.current?.id, visibility: document.visibilityState })
  root.effect(() => installDevelopmentSave({ hot: import.meta.hot, ready, report: toast,
    enqueue(action) { const task = syncQueue.then(action); syncQueue = task.catch(() => {}); return task },
    protect: action => stopping.run({ reason: 'reload', targets: snapshot.plugins.filter(p => p.enabled).map(p => p.id) }, async () => {
      await action()
      // Mount the new generations while the page's editing holds are still active.
      await synchronize()
    }),
  }))
  import.meta.hot.on('cordis:blocked', ({ message, clients }) => toast(message + ' 等待：' + clients.map(client => client.application + '（' + client.id.slice(0, 8) + '）').join('、')))
  import.meta.hot.on('cordis:restart', () => location.reload())
  import.meta.hot.on('vite:ws:connect', ready)
  ready()
}

if (!application.current && !leaving) applicationsView.open()
