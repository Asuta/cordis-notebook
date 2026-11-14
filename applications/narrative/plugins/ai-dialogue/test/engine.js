import { context } from './helpers.js'
export function fixture() {
  const ctx = context(), observers = new Set(), handlers = new Map(), events = [], calls = [], errors = []
  const project = {
    characters: [{ id: 'lin', name: '林栀', description: '星空观测员', personality: '温柔好奇' }],
    settings: { worldInfo: '今夜的观测站。' },
    nodes: [{ id: 'talk', type: 'chat', title: '聊天', stage: { characterId: 'lin' }, lines: [{ speaker: 'lin', text: '欢迎来到观测站。' }], choices: [], chat: { characterId: 'lin', prompt: '说说星空。', maxTurns: 2, next: 'next', label: '继续剧情', demoReplies: ['作者的第一轮示例。', '作者的第二轮示例。'] } }, { id: 'next', type: 'story', title: '后续', lines: [], choices: [] }],
  }
  const fresh = () => ({ nodeId: 'talk', lineIndex: 3, text: { speaker: '', text: '' }, transcript: [{ id: 'prior', role: 'narrator', name: '', text: '以前的剧情。' }], variables: { trust: 2 }, chatTurns: 12, busy: false, ended: false, error: '', visited: [] })
  const notify = type => { for (const fn of [...observers]) fn({ type }) }
  const own = (owner, set, value) => { set.add(value); owner.effect(() => () => set.delete(value)) }
  const engine = {
    project, mode: 'play', runtime: fresh(), held: false, selection: { nodeId: 'talk' }, eventHook: null,
    scene() { return project.nodes.find(node => node.id === (this.mode === 'play' ? this.runtime?.nodeId : this.selection.nodeId)) },
    registerNode(owner, handler) { handlers.set(handler.type, handler); owner.effect(() => () => handlers.delete(handler.type)) },
    observe(owner, callback) { own(owner, observers, callback) },
    transact(fn) { if (this.runtime) fn(this.runtime); notify('runtime') },
    error(message) { errors.push(message); if (this.runtime) this.runtime.error = message; notify('runtime') },
    async emit(event, payload) { events.push({ event, payload }); if (this.eventHook) await this.eventHook(event, payload) },
    async go(nodeId) { calls.push(nodeId); this.runtime.nodeId = nodeId; this.runtime.busy = false; this.runtime.chatTurns = 0; const node = this.scene(); await handlers.get(node.type)?.enter(node); notify('runtime') },
    stop() { this.mode = 'edit'; this.runtime = null; notify('mode') },
    restore() { this.mode = 'play'; this.runtime = fresh(); notify('mode') },
    update(mutator, options) { mutator(project); for (const fn of [...observers]) fn({ type: 'project', ...options }) },
  }
  return { ctx, engine, node: project.nodes[0], handlers, events, calls, errors, notify, observers }
}
