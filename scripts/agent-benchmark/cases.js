// Changing a prompt or acceptance rule changes the suite hash recorded with every run.
export const cases = [
  {
    id: 'content', appId: 'notebook', pluginId: 'paragraph-count', name: '段落统计',
    prompt: '请给笔记应用开发一个「段落计数」插件，ID paragraph-count。编辑区底栏显示当前笔记的非空段落数（按空行分段）；没有选中笔记显示“未选择笔记”，空正文显示“0 段”。支持普通笔记和 Markdown，编辑、切换后即时更新，停用再启用不重复挂载。统计节点设置 data-testid="paragraph-count"，有内容时显示“N 段”。范围保持简单，不添加设置或额外依赖。自行验证并启用，让我看到效果。',
    checks: ['empty-selection', 'plain-live', 'empty-body', 'markdown-source', 'switch-note', 'disable', 'reenable-once', 'page-errors'],
  },
  {
    id: 'action', appId: 'notebook', pluginId: 'title-copy', name: '复制标题',
    prompt: '请给笔记应用开发一个「复制标题」插件，ID title-copy。在当前笔记的工具栏加一个可访问名称为“复制标题”的按钮，点击复制当前笔记标题并提示“标题已复制”；没有选择笔记时禁用。切换笔记后更新，停用再启用不重复挂载。范围保持简单，不添加设置或额外依赖。自行验证并启用，让我看到效果。',
    checks: ['empty-selection', 'copy-current', 'success-feedback', 'switch-note', 'disable', 'reenable-once', 'page-errors'],
  },
  {
    id: 'editor', appId: 'notebook', pluginId: 'simple-page', name: '新格式编辑器',
    prompt: '请给笔记应用开发一个「便签页面」插件，ID simple-page。新增 simple-page 笔记格式，使用 body 字段保存纯文本，编辑区用一个可访问名称为“便签正文”的 textarea 编辑正文。新建菜单显示“便签页面”；要能创建、自动保存、切换笔记并在刷新后恢复，空正文也能保存，停用再启用不重复注册。格式定义和编辑器都放在这个插件内。范围保持简单，不添加设置或额外依赖。自行验证并启用，让我看到效果。',
    checks: ['create-format', 'autosave', 'switch-note', 'reload', 'empty-body', 'disable', 'reenable-once', 'page-errors'],
  },
  {
    id: 'canvas', appId: 'studio', pluginId: 'quick-card', name: '画布快捷动作',
    prompt: '请给灵感画布应用开发 quick-card 插件。在画布工具栏添加“创建便签”动作，每次点击新增一张 text 类型卡片，标题“快速便签”，正文“从插件创建”。通过现有 canvasUI/canvasSession 接口扩展，保留自动保存和撤销；停用后动作消失，再启用只出现一个。不要改已有插件，不添加依赖，也不要调用图片生成。自行验证并启用，让我看到效果。',
    checks: ['add-card', 'second-card', 'undo', 'reload', 'disable', 'reenable-once', 'page-errors'],
  },
  {
    id: 'backend', appId: 'notebook', pluginId: 'note-summary', name: '后端统计接口',
    prompt: '请给笔记应用开发 note-summary 后端插件，通过 notes 服务只读统计笔记。GET /api/plugins/note-summary/summary 返回 JSON {total,pinned,byType}：总笔记数、置顶数、按实际 type 统计的对象；空库返回 {total:0,pinned:0,byType:{}}，新增、修改置顶、删除笔记后立即反映。不要修改笔记数据，不添加设置、前端或依赖。停用后接口不可用，再启用正常且不重复注册。自行验证并启用。',
    checks: ['empty-data', 'mixed-types', 'pin-update', 'delete-note', 'read-only', 'disable', 'reenable-once', 'page-errors'],
  },
]

export function selectCases(ids = cases.map(item => item.id)) {
  if (!ids.length || new Set(ids).size !== ids.length) throw Error('任务不能为空或重复')
  return ids.map(id => { const item = cases.find(item => item.id === id); if (!item) throw Error('未知评测任务：' + id); return item })
}
