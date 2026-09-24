import { markdown } from '../plugins/markdown/server.js'
import { themeEngine } from '../plugins/theme-engine/server.js'
import { storage } from '../plugins/storage/server.js'
import { notes } from '../plugins/notes/server.js'
import { api } from '../plugins/notes-api/server.js'
import { theme as greenTheme } from '../plugins/theme/server.js'
import { theme as blueTheme } from '../plugins/theme-blue/server.js'
import { theme as nightTheme } from '../plugins/theme-night/server.js'
import { noteFormats } from '../plugins/note-formats/server.js'
import { formatPlain } from '../plugins/format-plain/server.js'
import { formatFreeform } from '../plugins/format-freeform/server.js'
import { formatMarkdown } from '../plugins/format-markdown/server.js'

const entry = (id, name, description, clientRequires, client, server, serverProvides = [], clientProvides = []) => ({ manifest: {
  id, name, description, version: '1.0.0', apiVersion: 1, dependencies: [], client: Array.isArray(client) ? client[0] : client, permissions: ['trusted'], builtin: true,
  requires: { server: server?.inject || [], client: clientRequires }, provides: { server: serverProvides, client: clientProvides },
}, server, clientAssets: client ? [].concat(client) : [] })
const settings = (item, mode, fields) => {
  item.manifest.settings = { mode, fields }; return item
}
const theme = (id, name, description, server, swatch, defaultEnabled = false) => {
  const item = entry(id, name, description, ['shell', 'themeEngine'], 'client.js', server, ['theme'], ['theme'])
  Object.assign(item.manifest, { exclusiveGroup: 'appearance.theme', groupLabel: '主题', swatch })
  return { ...item, defaultEnabled }
}
export const builtins = [
  entry('ui', '界面组件与渲染', '统一 React、shadcn 组件与随插件清理的界面挂载。', [], ['client.js', 'runtime.bundle.js', 'style.css'], null, [], ['ui']),
  entry('plugin-manager-ui', '插件中心界面', '分类浏览插件、外观预览和依赖详情；停用后保留宿主恢复入口。', ['ui', 'pluginManagement'], ['client.js', 'view.bundle.js']),
  entry('markdown', 'Markdown 解析能力', '提供安全渲染与正文提取，供格式和编辑器依赖。', [], ['client.js', 'parser.bundle.js'], markdown, ['markdown'], ['markdown']),
  entry('theme-engine', '主题引擎', '提供主题应用与清理能力，资源归属具体主题插件。', [], ['client.js', 'styles.js'], themeEngine, ['themeEngine'], ['themeEngine']),
  entry('note-formats', '笔记格式注册服务', '管理格式声明、校验与文本提取。', [], ['client.js', 'registry.js', 'note.js'], noteFormats, ['noteFormats'], ['noteFormats']),
  entry('format-plain', '普通笔记格式', '提供普通笔记的数据格式和编辑器关联。', ['noteFormats'], ['client.js', 'format.js'], formatPlain),
  entry('format-freeform', '自由页面格式', '提供文字块数据格式、校验和正文提取。', ['noteFormats'], ['client.js', 'format.js'], formatFreeform),
  entry('format-markdown', 'Markdown 笔记格式', '保存 Markdown 源码，提取正文供搜索与统计使用。', ['noteFormats', 'markdown'], ['client.js', 'format.js'], formatMarkdown),
  entry('storage', '本地文件存储', '兼容原有 notes.json，串行原子写入。', [], null, storage, ['storage']),
  entry('notes', '笔记业务', '笔记增删改查与数据校验。', [], null, notes, ['notes']),
  entry('notes-api', '笔记 API', '通过 HTTP 提供笔记服务，并向页面提供 notesApi 服务。', [], 'client.js', api, [], ['notesApi']),
  entry('layout', '留白布局', '提供侧栏、编辑区、工具栏和扩展面板服务。', ['ui'], ['client.js', 'mounts.js', 'view.bundle.js', 'style.css'], null, [], ['shell']),
  settings(entry('notebook', '前端笔记服务', '共享选择、草稿、自动保存与恢复。', ['notesApi', 'shell', 'noteFormats'], ['client.js', 'model.js'], null, [], ['notebook']), 'restart', {
    autosaveMs: { type: 'number', label: '自动保存间隔（毫秒）', description: '停止输入后等待多久保存。保存设置会先保存草稿，再重新加载笔记服务及其界面。', default: 600, min: 100, max: 10000, step: 100, integer: true },
  }),
  entry('note-list', '笔记列表', '显示笔记、选择与新建，提供列表扩展服务。', ['ui', 'notebook', 'shell', 'noteFormats'], ['client.js', 'view.bundle.js'], null, [], ['noteListUI']),
  entry('editor-host', '笔记编辑区', '标题、删除与按格式选择编辑器。', ['ui', 'notebook', 'shell', 'noteFormats'], ['client.js', 'view.bundle.js'], null, [], ['editorHost']),
  entry('editor', '纯文本编辑器', '编辑普通笔记正文。', ['ui', 'notebook', 'editorHost', 'noteFormats'], ['client.js', 'view.bundle.js']),
  entry('free-page-editor', '自由页面编辑器', '向右和向下延伸的纸张，自由摆放文字块。', ['ui', 'notebook', 'editorHost', 'noteFormats'], ['client.js', 'history.js', 'view.bundle.js', 'style.css']),
  entry('markdown-editor', 'Markdown 编辑器', '源码编辑、实时预览、格式快捷操作和 Markdown 导出。', ['ui', 'notebook', 'editorHost', 'noteFormats', 'markdown'], ['client.js', 'view.bundle.js', 'style.css']),
  entry('search', '全文搜索', '按标题和正文即时过滤。', ['ui', 'notebook', 'noteListUI'], ['client.js', 'view.bundle.js']),
  entry('pin', '置顶', '置顶笔记与筛选收藏。', ['notebook', 'noteListUI', 'shell'], 'client.js'),
  entry('export', '笔记导出', '导出 TXT；自由页面还可导出保留布局的 JSON。', ['notebook', 'shell'], 'client.js'),
  settings(entry('stats', '字数统计', '实时显示正文字符数。', ['notebook', 'shell'], 'client.js'), 'live', {
    includeWhitespace: { type: 'boolean', label: '统计空格与换行', default: false },
  }),
  { ...settings(entry('note-summary', '保存后摘要', '监听保存成功事件，在页面下方显示最近保存的正文摘要。', ['notebook', 'shell'], 'client.js'), 'live', {
    length: { type: 'number', label: '摘要长度', default: 120, options: [{ label: '80 字', value: 80 }, { label: '120 字', value: 120 }, { label: '200 字', value: 200 }] },
    showCount: { type: 'boolean', label: '显示字符数', default: true },
  }), defaultEnabled: false },
  theme('theme', '苔绿主题', '柔和的苔绿与温暖纸张，同组主题只能启用一个。', greenTheme, '#68845a', true),
  theme('theme-blue', '晴蓝主题', '清透的雾蓝配色，搭配干净明亮的编辑空间。', blueTheme, '#547dae'),
  theme('theme-night', '墨夜主题', '深色背景与柔和蓝灰文字，适合夜间书写。', nightTheme, '#263145'),
]
