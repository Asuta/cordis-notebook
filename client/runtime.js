import { Context, Service } from 'cordis'
const $ = s => document.querySelector(s), root = new Context(), mounted = new Map(), failures = new Map(), slots = new Map(), guards = new Set()
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
    provide(name, value) { return new class extends Service { constructor() { super(ctx, name); Object.assign(this, value) } }() },
    service: name => ctx[name], effect: callback => ctx.effect(callback),
    listen(target, event, handler) { target.addEventListener(event, handler); ctx.effect(() => () => target.removeEventListener(event, handler)) },
    guard(callback) { guards.add(callback); ctx.effect(() => () => guards.delete(callback)) },
    slot(name, node) { if (slots.has(name)) throw new Error(`插槽已被占用：${name}`); slots.set(name, node); ctx.effect(() => () => slots.delete(name)) },
    mount(name, node) { const slot = name === 'app' ? $('#app') : slots.get(name); if (!slot) throw new Error(`缺少界面插槽：${name}`); slot.append(node); ctx.effect(() => () => node.remove()); return node },
    watch(service, handler) { service.addEventListener('change', handler); ctx.effect(() => () => service.removeEventListener('change', handler)); handler() },
    button(slot, label, handler) { const button = el('button', {}, label); sdk.listen(button, 'click', () => Promise.resolve().then(handler).catch(error => toast(error.message))); return sdk.mount(slot, button) },
  }; return sdk
}
async function saveDrafts() { for (const guard of guards) await guard() }
const labels = { enabled: '运行中', disabled: '已停用', starting: '启动中', stopping: '停止中', failed: '运行失败' }
function renderManager() {
  $('#plugin-list').replaceChildren()
  $('#plugin-summary').textContent = `${snapshot.plugins.filter(p => p.state === 'enabled').length} 个运行中 / ${snapshot.plugins.length} 个已安装 · Cordis 双端插件运行时`
  for (const plugin of snapshot.plugins) {
    const card = el('article', { class: 'plugin-card', id: 'plugin-' + plugin.id }), top = el('div', { class: 'plugin-heading' })
    top.append(el('strong', {}, plugin.name), el('span', { class: 'plugin-status ' + (failures.has(plugin.id) ? 'failed' : plugin.state) }, failures.has(plugin.id) ? '前端失败' : labels[plugin.state]))
    card.append(top, el('p', {}, plugin.description), el('small', {}, `${plugin.id} · v${plugin.version} · ${plugin.builtin ? '内置插件' : '第三方 · 完全信任'}${plugin.pid ? ' · PID ' + plugin.pid : ''}`))
    if (plugin.dependencies.length) card.append(el('small', {}, '依赖：' + plugin.dependencies.join('、')))
    const error = failures.get(plugin.id)?.message || plugin.error
    if (error) card.append(el('pre', { class: 'plugin-error' }, error))
    if (plugin.logs?.length) { const details = el('details'); details.append(el('summary', {}, '后端日志'), el('pre', {}, plugin.logs.join(''))); card.append(details) }
    const actions = el('div', { class: 'plugin-actions' }), on = plugin.state === 'enabled'
    const toggle = el('button', { disabled: working || ['starting', 'stopping'].includes(plugin.state), 'aria-label': `${on ? '停用' : '启用'}${plugin.name}` }, on ? '停用' : plugin.state === 'failed' ? '重新启动' : '启用')
    toggle.onclick = () => operate(async () => { await saveDrafts(); await request(`/api/plugins/${plugin.id}/toggle`, 'POST', { enabled: !on }); failures.delete(plugin.id) }); actions.append(toggle)
    if (plugin.state === 'failed') { const stop = el('button', {}, '停用'); stop.onclick = () => operate(() => request(`/api/plugins/${plugin.id}/toggle`, 'POST', { enabled: false })); actions.append(stop) }
    if (failures.has(plugin.id) && on) { const retry = el('button', {}, '重载前端'); retry.onclick = () => { failures.clear(); scheduleSync() }; actions.append(retry) }
    if (!plugin.builtin) {
      const remove = el('button', { disabled: working || plugin.state !== 'disabled', 'aria-label': `卸载${plugin.name}` }, '卸载（保留数据）')
      remove.onclick = () => operate(() => request(`/api/plugins/${plugin.id}`, 'DELETE')); actions.append(remove)
      const clear = el('button', { disabled: working || plugin.state !== 'disabled' }, '清理数据')
      clear.onclick = () => { const confirmation = window.prompt(`将永久删除 ${plugin.name} 在专属数据目录内的文件。输入插件 ID ${plugin.id} 确认：`); if (confirmation === plugin.id) operate(async () => { await request(`/api/plugins/${plugin.id}/clear-data`, 'POST', { confirmation }); toast('插件专属数据已清理') }) }; actions.append(clear)
    }
    card.append(actions); $('#plugin-list').append(card)
  }
  $('#app-placeholder').hidden = mounted.has('layout')
}
async function operate(fn) {
  if (working) return; working = true; renderManager()
  try { await fn() } catch (error) { toast(error.message) } finally { working = false; await scheduleSync() }
}
async function synchronize() {
  snapshot = await request('/api/plugins')
  const wanted = new Map(snapshot.plugins.filter(p => p.state === 'enabled' && p.client).map(p => [p.id, p]))
  for (const [id, item] of [...mounted].reverse()) if (!wanted.has(id) || wanted.get(id).generation !== item.generation) {
    if (id === 'notebook' || id === 'editor') { try { await saveDrafts() } catch { toast('服务已停用，未保存草稿保留在此浏览器，重新启用后可恢复。') } }
    await item.fiber.dispose(); mounted.delete(id)
  }
  const visiting = new Set()
  async function mount(plugin) {
    if (mounted.has(plugin.id) || failures.get(plugin.id)?.generation === plugin.generation) return
    if (visiting.has(plugin.id)) throw new Error('前端插件存在循环依赖')
    visiting.add(plugin.id); let fiber
    try {
      for (const dependency of plugin.dependencies) if (wanted.has(dependency)) { await mount(wanted.get(dependency)); if (!mounted.has(dependency)) throw new Error(`前端依赖 ${dependency} 加载失败`) }
      const url = plugin.builtin ? '/builtin/' + plugin.client : `/plugins/${plugin.id}/${plugin.client}`
      const module = await deadline(import(url + '?generation=' + plugin.generation))
      if (typeof module.default !== 'function') throw new Error('前端入口需要导出 default 函数')
      fiber = root.plugin({ inject: module.inject || [], async apply(ctx) { const cleanup = await deadline(Promise.resolve(module.default(ctx, sdkFor(ctx, plugin)))); if (typeof cleanup === 'function') ctx.effect(() => cleanup) } })
      await deadline(fiber); mounted.set(plugin.id, { fiber, generation: plugin.generation }); failures.delete(plugin.id)
    } catch (error) { if (fiber) await fiber.dispose(); failures.set(plugin.id, { generation: plugin.generation, message: error.message }) } finally { visiting.delete(plugin.id) }
  }
  for (const plugin of wanted.values()) await mount(plugin)
  renderManager()
}
async function deadline(promise) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('前端插件加载超过 10 秒')), 10000) })]) } finally { clearTimeout(timer) } }
function scheduleSync() { const task = syncQueue.then(synchronize); syncQueue = task.catch(error => { $('#connection').textContent = '连接中断'; toast(error.message) }); return syncQueue }
$('#manage-plugins').onclick = () => { $('#plugin-manager').showModal(); scheduleSync() }
$('#close-manager').onclick = () => $('#plugin-manager').close()
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
