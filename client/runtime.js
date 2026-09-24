import { Context, Service } from 'cordis'
import { ClientPlugins } from './plugin-host.js'
import { serviceRelations } from './plugin-relations.js'
import { createDependencyView } from './dependency-view.js'
import { StopCoordinator } from './stop-coordinator.js'
import { createSettingsView } from './settings-view.js'
import { applyConfiguration } from './config-transaction.js'
const $ = s => document.querySelector(s), root = new Context(), failures = new Map(), slots = new Map()
const stopping = new StopCoordinator(root, error => toast(error.message))
let snapshot = { plugins: [] }, syncQueue = Promise.resolve(), working = false, installPackage = null
async function request(path, method = 'GET', data, signal) {
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, signal, ...(data === undefined ? {} : { body: JSON.stringify(data) }) })
  const result = await response.json(); if (!response.ok) throw new Error(result.error || '请求失败'); return result
}
function toast(message) { const node = $('#toast'); if ($('#plugin-manager').open) $('#plugin-manager').append(node); else document.body.append(node); node.textContent = message; node.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => node.hidden = true, 6000) }
function el(tag, props = {}, text) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) { if (key === 'class') node.className = value; else if (key.startsWith('aria-')) node.setAttribute(key, value); else node[key] = value }
  if (text !== undefined) node.textContent = text; return node
}
function sdkFor(ctx, plugin) {
  const controller = new AbortController(); ctx.effect(() => () => controller.abort())
  const sdk = {
    id: plugin.id, el, toast,
    request: (path, method, data) => request(path, method, data, controller.signal),
    rpc: (method, args) => request(`/api/plugins/${plugin.id}/rpc`, 'POST', { method, args }, controller.signal),
    provide(name, value) { return new class extends Service { constructor() { super(ctx, name); Object.defineProperties(this, Object.getOwnPropertyDescriptors(value)) } }() },
    service: name => ctx[name], effect: callback => ctx.effect(callback),
    listen(target, event, handler) { target.addEventListener(event, handler); ctx.effect(() => () => target.removeEventListener(event, handler)) },
    guard(callback) { return ctx.on('plugins/before-stop', async () => { await callback() }) },
    slot(name, node) { if (slots.has(name)) throw new Error(`插槽已被占用：${name}`); slots.set(name, node); ctx.effect(() => () => slots.delete(name)) },
    mount(name, node) {
      if (name === 'app') { ctx.effect(() => { $('#app').append(node); return () => node.remove() }); return node }
      const services = plugin.builtin ? ctx : root
      const service = name === 'list-filters' ? services.noteListUI : services.shell
      if (service && (plugin.builtin || !slots.has(name))) return service.mount(ctx, name === 'list-filters' ? 'filters' : name, node)
      const slot = slots.get(name); if (!slot) throw new Error('缺少界面扩展服务：' + name)
      ctx.effect(() => { slot.append(node); return () => node.remove() }); return node
    },
    watch(service, handler) { if (service.observe) return service.observe(ctx, handler); service.addEventListener('change', handler); ctx.effect(() => () => service.removeEventListener('change', handler)); handler() },
    button(slot, label, handler) { const button = el('button', {}, label); sdk.listen(button, 'click', () => Promise.resolve().then(handler).catch(error => toast(error.message))); return sdk.mount(slot, button) },
  }; return sdk
}
const host = new ClientPlugins(root, {
  sdkFor, load: plugin => import((plugin.builtin ? '/builtin/' + plugin.client : '/plugins/' + plugin.id + '/' + plugin.client) + '?generation=' + plugin.generation + '&attempt=' + plugin.attempt),
  onChange: () => queueMicrotask(renderManager),
})
const settingsView = createSettingsView({ el, getSnapshot: () => snapshot, save: (plugin, config) => operate(() => saveConfig(plugin, config), true) })
const labels = { waiting: '等待服务', 'not-applicable': '无需运行', enabled: '运行中', disabled: '已停用', starting: '启动中', stopping: '停止中', failed: '运行失败' }
let managerView = 'cards'
try { if (localStorage.getItem('cordis-manager-view') === 'tree') managerView = 'tree' } catch {}
const viewBar = el('div', { class: 'manager-viewbar', 'aria-label': '插件显示方式' }), viewButtons = el('div', { class: 'manager-view-switch' })
const cardsButton = el('button', { 'aria-pressed': 'true' }, '▦ 卡片视图'), treeButton = el('button', { 'aria-pressed': 'false' }, '⑂ 依赖树')
viewButtons.append(cardsButton, treeButton); viewBar.append(el('span', {}, '浏览插件'), viewButtons)
const dependencyView = createDependencyView({ el, card: pluginCard, labels, failures })
$('#plugin-list').before(viewBar, dependencyView.host)
function setManagerView(view) { managerView = view; try { localStorage.setItem('cordis-manager-view', view) } catch {}; renderManager() }
cardsButton.onclick = () => setManagerView('cards'); treeButton.onclick = () => setManagerView('tree')
function renderManager() {
  settingsView.update(snapshot, working)
  $('#close-manager').disabled = working
  const visiblePlugins = snapshot.plugins.map(p => host.describe(p))
  failures.clear()
  for (const p of visiblePlugins) if (p.clientState === 'failed') failures.set(p.id, { message: p.error })
  $('#plugin-list').replaceChildren()
  $('#plugin-summary').textContent = `${visiblePlugins.filter(p => p.state === 'enabled').length} 个运行中 / ${snapshot.plugins.length} 个已安装 · Cordis 双端插件运行时`
  const tree = managerView === 'tree'
  $('#plugin-list').hidden = tree; dependencyView.host.hidden = !tree
  cardsButton.setAttribute('aria-pressed', String(!tree)); treeButton.setAttribute('aria-pressed', String(tree))
  if (tree) dependencyView.render(visiblePlugins)
  else for (const plugin of visiblePlugins) $('#plugin-list').append(pluginCard(plugin))
  $('#app-placeholder').hidden = host.state('layout') === 'enabled'
}
function pluginCard(plugin, id = 'plugin-' + plugin.id) {
    const exclusive = plugin.builtin && plugin.exclusiveGroup
    const busy = working || !!snapshot.pendingSwitch || !!snapshot.pendingConfig
    const card = el('article', { class: 'plugin-card', id }), top = el('div', { class: 'plugin-heading' })
    top.append(el('strong', {}, plugin.name), el('span', { class: 'plugin-status ' + (failures.has(plugin.id) ? 'failed' : plugin.state) }, failures.has(plugin.id) ? '前端失败' : labels[plugin.state]))
    card.append(top, el('p', {}, plugin.description), el('small', {}, `${plugin.id} · v${plugin.version} · ${plugin.builtin ? '内置插件' : '第三方 · 完全信任'}${plugin.pid ? ' · PID ' + plugin.pid : ''}`))
    if (plugin.dependencies.length) card.append(el('small', {}, (plugin.builtin ? '插件包依赖：' : '兼容插件依赖：') + plugin.dependencies.join('、')))
    if (exclusive) {
      const group = el('div', { class: 'theme-group' }), swatch = el('i', { class: 'theme-swatch', 'aria-hidden': 'true' })
      swatch.style.background = plugin.swatch
      const current = snapshot.plugins.find(p => p.exclusiveGroup === exclusive && p.state === 'enabled')
      group.append(swatch, document.createTextNode(`${plugin.groupLabel} · 单选组${current?.id === plugin.id ? ' · 当前主题' : current ? ' · 使用后替换' + current.name : ' · 当前为默认样式'}`)); card.append(group)
      if (snapshot.pendingSwitch?.group === exclusive) card.append(el('small', { role: 'status' }, '正在确认主题切换…'))
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
    if (plugin.logs?.length) { const details = el('details'); details.append(el('summary', {}, '后端日志'), el('pre', {}, plugin.logs.join(''))); card.append(details) }
    const actions = el('div', { class: 'plugin-actions' }), on = plugin.enabled && plugin.state !== 'failed'
    const toggle = el('button', { disabled: busy || ['starting', 'stopping'].includes(plugin.state), 'aria-label': `${on ? '停用' : exclusive ? '使用' : '启用'}${plugin.name}` }, exclusive ? on ? '恢复默认样式' : '使用此主题' : on ? '停用' : plugin.state === 'failed' ? '重新启动' : '启用')
    toggle.onclick = () => operate(() => failures.has(plugin.id) && plugin.enabled ? retryPlugin(plugin) : changePlugin(plugin, !on)); actions.append(toggle)
    if (plugin.settings) {
      const settings = el('button', { disabled: busy, 'aria-label': `设置${plugin.name}` }, '设置…')
      settings.onclick = () => settingsView.open(plugin); actions.append(settings)
    }
    if (plugin.state === 'failed' && !exclusive) { const stop = el('button', { disabled: busy }, '停用'); stop.onclick = () => operate(() => changePlugin(plugin, false)); actions.append(stop) }
    if (plugin.enabled && ['failed', 'disabled'].includes(plugin.clientState)) { const retry = el('button', { disabled: busy }, '重载前端'); retry.onclick = () => operate(() => retryPlugin(plugin)); actions.append(retry) }
    if (!plugin.builtin) {
      const remove = el('button', { disabled: working || plugin.state !== 'disabled', 'aria-label': `卸载${plugin.name}` }, '卸载（保留数据）')
      remove.onclick = () => operate(() => request(`/api/plugins/${plugin.id}`, 'DELETE')); actions.append(remove)
      const clear = el('button', { disabled: working || plugin.state !== 'disabled' }, '清理数据')
      clear.onclick = () => { const confirmation = window.prompt(`将永久删除 ${plugin.name} 在专属数据目录内的文件。输入插件 ID ${plugin.id} 确认：`); if (confirmation === plugin.id) operate(async () => { await request(`/api/plugins/${plugin.id}/clear-data`, 'POST', { confirmation }); toast('插件专属数据已清理') }) }; actions.append(clear)
    }
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
  return stopping.run({ reason: 'reload', targets: [plugin.id] }, () => host.retry(plugin.id))
}
async function applyPluginChange(plugin, enabled) {
  const result = await request(`/api/plugins/${plugin.id}/toggle`, 'POST', { enabled })
  failures.delete(plugin.id)
  const pending = result.pendingSwitch
  if (!pending) return
  let loadError
  try {
    await scheduleSync()
    if (snapshot.pendingSwitch?.token !== pending.token) throw new Error('切换已取消，请重新选择主题')
    if (pending.target) {
      const target = snapshot.plugins.find(p => p.id === pending.target)
      if (host.state(pending.target) !== 'enabled' || host.entries.get(pending.target)?.generation !== target.generation) throw new Error(failures.get(pending.target)?.message || '主题前端未成功挂载')
    } else if (snapshot.plugins.some(p => p.exclusiveGroup === pending.group && host.state(p.id) === 'enabled')) throw new Error('旧主题尚未完成卸载')
  } catch (error) { loadError = error }
  const confirmed = await request('/api/plugins/exclusive/confirm', 'POST', { token: pending.token, success: !loadError, error: loadError?.message })
  await scheduleSync()
  if (loadError) {
    const restoreFailed = pending.previous.some(id => host.state(id) !== 'enabled')
    throw new Error(restoreFailed ? `${confirmed.message}；原主题页面恢复失败，请重载前端。` : confirmed.message)
  }
  toast(pending.target ? `已切换为${plugin.name}` : '已恢复默认样式')
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
  const next = await request('/api/plugins')
  // A remote stop is already committed: disposal must not start another save
  // against disappearing services. Edits are backed up when they occur.
  const removed = snapshot.plugins.some(p => p.enabled && p.client && !next.plugins.some(n => n.id === p.id && n.enabled))
  if (removed && !stopping.running && root.notebook?.dirty) toast('其他页面已停用插件，未保存草稿保留在此浏览器。')
  snapshot = next
  await host.sync(snapshot.plugins)
  renderManager()
}
function scheduleSync() { const task = syncQueue.then(synchronize); syncQueue = task.catch(error => { $('#connection').textContent = '连接中断'; toast(error.message) }); return syncQueue }
$('#manage-plugins').onclick = () => { $('#plugin-manager').showModal(); scheduleSync() }
$('#close-manager').onclick = () => $('#plugin-manager').close()
$('#plugin-manager').addEventListener('cancel', event => { if (working) event.preventDefault() })
$('#plugin-manager').addEventListener('close', () => { document.body.append($('#toast')); $('#toast').hidden = true })
$('#plugin-file').onchange = async event => {
  installPackage = null; $('#install-preview').hidden = true; $('#trust-plugin').checked = false; $('#install-plugin').disabled = true
  const file = event.target.files[0]; if (!file) return
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('插件包不能超过 2 MB')
    const pkg = JSON.parse(await file.text()); if (!pkg.manifest?.id || !pkg.files) throw new Error('请选择 .cordis-plugin.json 插件包')
    installPackage = pkg; $('#install-description').textContent = `${pkg.manifest.name} · ${pkg.manifest.id} · v${pkg.manifest.version}`; $('#install-preview').hidden = false
  } catch (error) { toast(error.message) }
}
$('#trust-plugin').onchange = event => $('#install-plugin').disabled = !event.target.checked
$('#install-plugin').onclick = () => operate(async () => {
  if (!installPackage || !$('#trust-plugin').checked) return
  await request('/api/plugins/install', 'POST', { package: installPackage, trust: true }); installPackage = null; $('#install-preview').hidden = true; $('#plugin-file').value = ''; toast('安装完成。点击启用以启动插件。')
})
const events = new EventSource('/api/events')
events.addEventListener('plugins', () => { $('#connection').textContent = '本地连接正常'; scheduleSync() })
events.onerror = () => { $('#connection').textContent = '正在重新连接…' }
await scheduleSync()
