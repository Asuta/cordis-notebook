import { Service } from 'cordis'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Notes } from './notes.js'
import { body } from './http.js'

class Storage extends Service {
  constructor(ctx, { file }) { super(ctx, 'storage'); this.file = file }
  async read() {
    await mkdir(dirname(this.file), { recursive: true })
    try { return JSON.parse(await readFile(this.file, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
  }
  async write(items) { await writeFile(this.file + '.tmp', JSON.stringify(items, null, 2)); await rename(this.file + '.tmp', this.file) }
}
const storage = { apply: (ctx, config) => { new Storage(ctx, config) } }
const notes = { inject: ['storage'], async apply(ctx) { const service = new Notes(ctx); await service.load(); ctx.effect(() => () => service.queue) } }
const api = { inject: ['notes', 'http'], apply(ctx) {
  const route = (method, pattern, fn) => ctx.http.route(ctx, method, pattern, fn)
  route('GET', /^\/api\/notes$/, () => ctx.notes.list())
  route('POST', /^\/api\/notes$/, () => ctx.notes.create())
  route('PATCH', /^\/api\/notes\/([\w-]+)$/, async ({ req, match }) => ctx.notes.update(match[1], await body(req)))
  route('DELETE', /^\/api\/notes\/([\w-]+)$/, ({ match }) => ctx.notes.remove(match[1]))
} }
const entry = (id, name, description, clientRequires, client, server, serverProvides = [], clientProvides = []) => ({ manifest: {
  id, name, description, version: '1.0.0', apiVersion: 1, dependencies: [], client, permissions: ['trusted'], builtin: true,
  requires: { server: server?.inject || [], client: clientRequires }, provides: { server: serverProvides, client: clientProvides },
}, server })
class Theme extends Service {
  constructor(ctx, id) { super(ctx, 'theme'); this.id = id }
}
const theme = (id, name, description, client, swatch, defaultEnabled = false) => {
  const item = entry(id, name, description, ['shell'], client, { apply(ctx) { new Theme(ctx, id) } }, ['theme'], ['theme'])
  Object.assign(item.manifest, { exclusiveGroup: 'appearance.theme', groupLabel: '主题', swatch })
  return { ...item, defaultEnabled }
}
export const builtins = [
  entry('storage', '本地文件存储', '兼容原有 notes.json，串行原子写入。', [], null, storage, ['storage']),
  entry('notes', '笔记业务', '笔记增删改查与数据校验。', [], null, notes, ['notes']),
  entry('notes-api', '笔记 API', '通过 HTTP 提供笔记服务，并向页面提供 notesApi 服务。', [], 'notes-api.js', api, [], ['notesApi']),
  entry('layout', '留白布局', '提供侧栏、编辑区、工具栏和扩展面板服务。', [], 'layout.js', null, [], ['shell']),
  entry('notebook', '前端笔记服务', '共享选择、草稿、自动保存与恢复。', ['notesApi', 'shell'], 'notebook.js', null, [], ['notebook']),
  entry('note-list', '笔记列表', '显示笔记、选择与新建，提供列表扩展服务。', ['notebook', 'shell'], 'note-list.js', null, [], ['noteListUI']),
  entry('editor', '纯文本编辑器', '编辑标题和正文，删除笔记。', ['notebook', 'shell'], 'editor.js'),
  entry('search', '全文搜索', '按标题和正文即时过滤。', ['notebook', 'noteListUI'], 'search.js'),
  entry('pin', '置顶', '置顶笔记与筛选收藏。', ['notebook', 'noteListUI', 'shell'], 'pin.js'),
  entry('export', '文本导出', '把当前笔记导出为 TXT。', ['notebook', 'shell'], 'export.js'),
  entry('stats', '字数统计', '实时显示正文字符数。', ['notebook', 'shell'], 'stats.js'),
  theme('theme', '苔绿主题', '柔和的苔绿与温暖纸张，同组主题只能启用一个。', 'theme.js', '#68845a', true),
  theme('theme-blue', '晴蓝主题', '清透的雾蓝配色，搭配干净明亮的编辑空间。', 'theme-blue.js', '#547dae'),
  theme('theme-night', '墨夜主题', '深色背景与柔和蓝灰文字，适合夜间书写。', 'theme-night.js', '#263145'),
]
