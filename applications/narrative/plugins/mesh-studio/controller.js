export function createStudioController(request) {
  let frame, opened, state = {}, ready, resolveReady, rejectReady, readyTimer, disposed = false, sequence = 0, latest, savedVersion = -1, saving
  const pending = new Map(), listeners = new Set()
  const emit = () => { for (const listener of listeners) listener() }
  const onMessage = event => {
    if (disposed || event.origin !== location.origin || event.source !== frame?.contentWindow || event.data?.channel !== 'narrative-mesh') return
    const data = event.data
    if (data.state) { if (state.localVersion !== data.state.localVersion || data.state.dirty || data.state.busy) savedVersion = -1; state = data.state; if (state.projectName && !state.busy) { clearTimeout(readyTimer); resolveReady?.(); resolveReady = null } emit() }
    if (data.play) { for (const listener of listeners) listener('play'); return }
    const item = pending.get(data.requestId)
    if (item) { clearTimeout(item.timer); pending.delete(data.requestId); data.error ? item.reject(Error(data.error)) : item.resolve(data.result) }
  }
  window.addEventListener('message', onMessage)
  function detach() {
    clearTimeout(readyTimer); rejectReady?.(Error('角色编辑器已关闭')); resolveReady = rejectReady = null
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error('角色编辑器已关闭')) }
    pending.clear(); frame = null; opened = null; state = {}; latest = null; savedVersion = -1; emit()
  }
  async function command(action, args = {}) {
    if (!frame || disposed) throw Error('请先打开角色工作室中的角色工程')
    await ready
    const requestId = 'mesh-' + ++sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(Error('角色编辑器操作超时，请检查编辑器提示')) }, action === 'rebuild' ? 180000 : 30000)
      pending.set(requestId, { resolve, reject, timer })
      frame.contentWindow.postMessage({ channel: 'narrative-mesh', requestId, action, args }, location.origin)
    })
  }
  async function flushInto(project) {
    if (!frame || !opened || opened.projectId !== project.id) return false
    if (state.busy) throw Error('角色编辑器正在处理，请稍后保存或切换作品')
    if (saving) await saving
    else {
      saving = (async () => {
        const snapshot = await command('save')
        if (snapshot.projectName !== opened.editorProject) savedVersion = -1
        opened.editorProject = snapshot.projectName
        if (savedVersion !== snapshot.localVersion || !latest) {
          latest = await request('/api/narrative/mesh/projects/' + encodeURIComponent(project.id) + '/publish', 'POST', { editorProject: snapshot.projectName })
          savedVersion = snapshot.localVersion
        }
      })().finally(() => { saving = null })
      await saving
    }
    const character = project.characters.find(c => c.id === opened.characterId)
    if (!character) throw Error('正在编辑的角色已删除，请先保留角色工程')
    character.meshAvatar = { ...latest }
    return true
  }
  return {
    command, flushInto, detach, invalidate() { savedVersion = -1 },
    get opened() { return opened }, get dirty() { return !!state.dirty },
    snapshot() { return { ...state, opened: opened && { ...opened }, connected: !!frame } },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    attach(next, context) {
      detach(); frame = next; opened = { ...context }; latest = context.model
      ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; readyTimer = setTimeout(() => reject(Error('角色编辑器加载超时，请重新打开')), 30000) }); ready.catch(() => {})
    },
    dispose() { disposed = true; detach(); window.removeEventListener('message', onMessage); listeners.clear() },
  }
}
