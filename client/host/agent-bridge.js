/** Application-neutral, lifecycle-owned tools. The workbench owns the Agent process. */
export function createAgentBridge({ application, session, stopping, window, document }) {
  const tools = new Map(), attachments = new Map(), pageId = crypto.randomUUID()
  let peer, origin, menu, releaseReload
  const send = message => { if (peer) peer.postMessage({ channel: 'cordis-agent', pageId, appId: application?.id, session, ...message }, origin) }
  const describe = () => [...tools.values()].map(({ definition }) => definition)
  const register = (owner, definition, execute) => {
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(definition.name) || tools.has(definition.name)) throw Error('Agent 工具名称无效或重复')
    const entry = { definition, execute }
    tools.set(definition.name, entry); send({ type: 'ready', tools: describe() })
    owner.effect(() => () => { if (tools.get(definition.name) === entry) tools.delete(definition.name); send({ type: 'ready', tools: describe() }) })
  }
  async function call(name, args) {
    if (name === 'workspace_prepare_reload') {
      if (releaseReload) throw Error('页面已经在准备重启')
      // Keep the editors held across the process restart, not only across the save request.
      return new Promise((resolve, reject) => {
        void stopping.run({ reason: 'reload', targets: [] }, () => new Promise(done => {
          const timer = setTimeout(() => releaseReload?.(), 60000)
          releaseReload = () => { clearTimeout(timer); releaseReload = null; done() }
          resolve({ ready: true })
        })).catch(reject)
      })
    }
    if (name === 'workspace_release_reload') { releaseReload?.(); return { released: true } }
    if (name === 'replace_selection') {
      const entry = attachments.get(args.id)
      if (!entry) throw Error('选区已过期，请重新添加到聊天')
      if (typeof args.text !== 'string' || args.text.length > 200000) throw Error('替换内容无效')
      const result = await entry.apply(args.text)
      attachments.delete(args.id)
      return result ?? { updated: true }
    }
    const entry = tools.get(name)
    if (!entry) throw Error('工具不可用，所属插件可能已停用')
    return entry.execute(args || {})
  }
  const listener = async event => {
    const message = event.data
    if (message?.channel !== 'cordis-agent') return
    if (message.type === 'connect' && window.parent !== window && event.source === window.parent) {
      // The containing workbench must be local. Port separation preserves the application's storage origin.
      let url; try { url = new URL(event.origin) } catch { return }
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) return
      peer = event.source; origin = event.origin; send({ type: 'ready', tools: describe() }); return
    }
    if (event.source !== peer || event.origin !== origin || message.type !== 'call') return
    if (message.pageId !== pageId || message.session !== session) return send({ type: 'result', id: message.id, error: '应用页面已更换' })
    try { send({ type: 'result', id: message.id, result: await call(message.name, message.args) }) }
    catch (error) { send({ type: 'result', id: message.id, error: error.message }) }
  }
  window.addEventListener('message', listener)
  const dismiss = event => { if (menu && !menu.contains(event.target)) menu.remove() }
  document.addEventListener('pointerdown', dismiss)
  const pulse = setInterval(() => send({ type: 'ready', tools: describe() }), 3000)
  window.addEventListener('pagehide', () => { send({ type: 'disconnect' }); clearInterval(pulse) }, { once: true })
  return {
    forOwner(owner) {
      return {
        register: (definition, execute) => register(owner, definition, execute),
        selection(target, capture) {
          const ids = new Set()
          const listener = event => {
            if (!peer) return
            const selected = capture(event)
            if (!selected?.text) return
            event.preventDefault(); menu?.remove()
            menu = document.createElement('button'); menu.textContent = '添加到 Chat'
            Object.assign(menu.style, { position: 'fixed', left: Math.min(event.clientX, window.innerWidth - 155) + 'px', top: Math.min(event.clientY, window.innerHeight - 45) + 'px', zIndex: '2147483647', padding: '10px 18px', background: '#202738', color: '#fff', border: '1px solid #64748b', borderRadius: '9px', cursor: 'pointer' })
            menu.onpointerdown = e => e.preventDefault()
            menu.onclick = () => {
              const id = crypto.randomUUID(); ids.add(id); attachments.set(id, selected)
              if (attachments.size > 50) attachments.delete(attachments.keys().next().value)
              send({ type: 'attachment', attachment: { id, text: selected.text, label: selected.label || '当前选区', noteId: selected.noteId, blockId: selected.blockId } })
              menu.remove()
            }
            document.body.append(menu)
          }
          target.addEventListener('contextmenu', listener)
          owner.effect(() => () => { target.removeEventListener('contextmenu', listener); for (const id of ids) attachments.delete(id); menu?.remove() })
        },
      }
    },
    call, describe,
    dispose() { clearInterval(pulse); releaseReload?.(); window.removeEventListener('message', listener); document.removeEventListener('pointerdown', dismiss); menu?.remove(); tools.clear(); attachments.clear() },
  }
}
