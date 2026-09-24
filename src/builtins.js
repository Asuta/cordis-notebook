import { storage } from './plugins/storage.js'
import { notes } from './plugins/notes.js'
import { api } from './plugins/notes-api.js'
import { themePlugin } from './plugins/theme.js'
import { noteFormats } from './plugins/note-formats.js'
import { formatPlain } from './plugins/format-plain.js'
import { formatFreeform } from './plugins/format-freeform.js'
import { formatMarkdown } from './plugins/format-markdown.js'

const entry = (id, name, description, clientRequires, client, server, serverProvides = [], clientProvides = []) => ({ manifest: {
  id, name, description, version: '1.0.0', apiVersion: 1, dependencies: [], client, permissions: ['trusted'], builtin: true,
  requires: { server: server?.inject || [], client: clientRequires }, provides: { server: serverProvides, client: clientProvides },
}, server })
const settings = (item, mode, fields) => {
  item.manifest.settings = { mode, fields }; return item
}
const theme = (id, name, description, client, swatch, defaultEnabled = false) => {
  const item = entry(id, name, description, ['shell'], client, themePlugin(id), ['theme'], ['theme'])
  Object.assign(item.manifest, { exclusiveGroup: 'appearance.theme', groupLabel: '主题', swatch })
  return { ...item, defaultEnabled }
}
export const builtins = [
  entry('note-formats', '笔记格式注册服务', '管理格式声明、校验与文本提取。', [], 'note-formats.js', noteFormats, ['noteFormats'], ['noteFormats']),
  entry('format-plain', '普通笔记格式', '提供普通笔记的数据格式和编辑器关联。', ['noteFormats'], 'format-plain.js', formatPlain),
  entry('format-freeform', '自由页面格式', '提供文字块数据格式、校验和正文提取。', ['noteFormats'], 'format-freeform.js', formatFreeform),
  entry('format-markdown', 'Markdown 笔记格式', '保存 Markdown 源码，提取正文供搜索与统计使用。', ['noteFormats'], 'format-markdown.js', formatMarkdown),
  entry('storage', '本地文件存储', '兼容原有 notes.json，串行原子写入。', [], null, storage, ['storage']),
  entry('notes', '笔记业务', '笔记增删改查与数据校验。', [], null, notes, ['notes']),
  entry('notes-api', '笔记 API', '通过 HTTP 提供笔记服务，并向页面提供 notesApi 服务。', [], 'notes-api.js', api, [], ['notesApi']),
  entry('layout', '留白布局', '提供侧栏、编辑区、工具栏和扩展面板服务。', [], 'layout.js', null, [], ['shell']),
  settings(entry('notebook', '前端笔记服务', '共享选择、草稿、自动保存与恢复。', ['notesApi', 'shell', 'noteFormats'], 'notebook.js', null, [], ['notebook']), 'restart', {
    autosaveMs: { type: 'number', label: '自动保存间隔（毫秒）', description: '停止输入后等待多久保存。保存设置会先保存草稿，再重新加载笔记服务及其界面。', default: 600, min: 100, max: 10000, step: 100, integer: true },
  }),
  entry('note-list', '笔记列表', '显示笔记、选择与新建，提供列表扩展服务。', ['notebook', 'shell', 'noteFormats'], 'note-list.js', null, [], ['noteListUI']),
  entry('editor-host', '笔记编辑区', '标题、删除与按格式选择编辑器。', ['notebook', 'shell', 'noteFormats'], 'editor-host.js', null, [], ['editorHost']),
  entry('editor', '纯文本编辑器', '编辑普通笔记正文。', ['notebook', 'editorHost'], 'editor.js'),
  entry('free-page-editor', '自由页面编辑器', '向右和向下延伸的纸张，自由摆放文字块。', ['notebook', 'editorHost'], 'free-page-editor.js'),
  entry('markdown-editor', 'Markdown 编辑器', '源码编辑、实时预览、格式快捷操作和 Markdown 导出。', ['notebook', 'editorHost'], 'markdown-editor.js'),
  entry('search', '全文搜索', '按标题和正文即时过滤。', ['notebook', 'noteListUI'], 'search.js'),
  entry('pin', '置顶', '置顶笔记与筛选收藏。', ['notebook', 'noteListUI', 'shell'], 'pin.js'),
  entry('export', '笔记导出', '导出 TXT；自由页面还可导出保留布局的 JSON。', ['notebook', 'shell'], 'export.js'),
  settings(entry('stats', '字数统计', '实时显示正文字符数。', ['notebook', 'shell'], 'stats.js'), 'live', {
    includeWhitespace: { type: 'boolean', label: '统计空格与换行', default: false },
  }),
  { ...settings(entry('note-summary', '保存后摘要', '监听保存成功事件，在页面下方显示最近保存的正文摘要。', ['notebook', 'shell'], 'note-summary.js'), 'live', {
    length: { type: 'number', label: '摘要长度', default: 120, options: [{ label: '80 字', value: 80 }, { label: '120 字', value: 120 }, { label: '200 字', value: 200 }] },
    showCount: { type: 'boolean', label: '显示字符数', default: true },
  }), defaultEnabled: false },
  theme('theme', '苔绿主题', '柔和的苔绿与温暖纸张，同组主题只能启用一个。', 'theme.js', '#68845a', true),
  theme('theme-blue', '晴蓝主题', '清透的雾蓝配色，搭配干净明亮的编辑空间。', 'theme-blue.js', '#547dae'),
  theme('theme-night', '墨夜主题', '深色背景与柔和蓝灰文字，适合夜间书写。', 'theme-night.js', '#263145'),
]
