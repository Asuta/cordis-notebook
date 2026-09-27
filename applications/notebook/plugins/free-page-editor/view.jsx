export function mountControls(ctx, root, api, sdk) {
  const {
      h,
      React,
      Button,
      Icon,
      Dialog,
      DialogContent,
      DialogHeader,
      DialogTitle,
      DialogDescription,
      DialogFooter,
      Input,
    } = ctx.ui,
    Fragment = React.Fragment
  function Controls() {
    const state = api.status(),
      [tab, setTab] = React.useState('home'),
      [help, setHelp] = React.useState(false),
      [linkOpen, setLinkOpen] = React.useState(false),
      [url, setUrl] = React.useState('')
    api.link = () => {
      setUrl('')
      setLinkOpen(true)
    }
    const disabled = !state.editable || !state.active
    const btn = (label, action, options = {}) => (
      <Button
        key={label}
        size="sm"
        variant={options.active ? 'secondary' : 'ghost'}
        aria-label={label}
        title={options.hint || label}
        disabled={options.disabled ?? disabled}
        onPointerDown={(e) => e.preventDefault()}
        onClick={action}
        aria-pressed={options.active}
      >
        {options.icon && <Icon name={options.icon} />}
        <span>{options.text || label}</span>
      </Button>
    )
    const run = (label, cmd, value, options) => btn(label, () => api.run(cmd, value), options)
    return (
      <>
        <div className="outline-ribbon-tabs" role="tablist" aria-label="自由页面工具栏">
          {[
            ['home', '开始'],
            ['insert', '插入'],
            ['view', '视图'],
          ].map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
          <span className="outline-ribbon-spacer" />
          {btn('快捷键', () => setHelp(true), { disabled: false, icon: 'CircleHelp' })}
        </div>
        <div className="outline-ribbon" role="toolbar" aria-label="自由页面命令">
          <div className="outline-tool-group">
            {btn('撤销', api.undo, { disabled: !state.editable || !state.undo, icon: 'Undo2', hint: '撤销 Ctrl+Z' })}
            {btn('重做', api.redo, { disabled: !state.editable || !state.redo, icon: 'Redo2', hint: '重做 Ctrl+Y' })}
          </div>
          {tab === 'home' && (
            <>
              <div className="outline-tool-group">
                <select
                  aria-label="字体"
                  disabled={disabled}
                  value={state.font || 'Microsoft YaHei'}
                  onChange={(e) => api.run('font', e.target.value)}
                >
                  {[
                    ['Microsoft YaHei', '微软雅黑'],
                    ['SimSun', '宋体'],
                    ['KaiTi', '楷体'],
                    ['Arial', 'Arial'],
                    ['Calibri', 'Calibri'],
                    ['Consolas', 'Consolas'],
                  ].map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="字号"
                  disabled={disabled}
                  value={state.size || 12}
                  onChange={(e) => api.run('size', Number(e.target.value))}
                >
                  {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72, 96].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                {run('加粗', 'bold', null, { text: 'B', active: state.bold, hint: '加粗 Ctrl+B' })}
                {run('斜体', 'italic', null, { text: 'I', active: state.italic, hint: '斜体 Ctrl+I' })}
                {run('下划线', 'underline', null, { text: 'U', active: state.underline, hint: '下划线 Ctrl+U' })}
                {run('删除线', 'strike', null, { text: 'S̶' })}
                <label className="outline-color" title="文字颜色">
                  A
                  <input
                    aria-label="文字颜色"
                    type="color"
                    disabled={disabled}
                    defaultValue="#252525"
                    onChange={(e) => api.run('color', e.target.value)}
                  />
                </label>
                {run('高亮', 'highlight', '#fff59d', { text: '荧光笔' })}
                {run('上标', 'superscript', null, { text: 'x²' })}
                {run('下标', 'subscript', null, { text: 'x₂' })}
                {run('清除格式', 'clear', null, { text: '清除' })}
              </div>
              <div className="outline-tool-group">
                <select
                  aria-label="段落样式"
                  disabled={disabled}
                  value={state.heading || 'normal'}
                  onChange={(e) => api.run('style', e.target.value)}
                >
                  <option value="normal">正文</option>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      标题 {n}
                    </option>
                  ))}
                </select>
                {run('项目符号', 'bullet', null, { text: '• 列表', hint: '项目符号 Ctrl+句号 · 备用 Alt+句号' })}
                {run('编号列表', 'number', null, { text: '1. 列表' })}
                {run('减少缩进', 'indent', -1, { text: '←' })}
                {run('增加缩进', 'indent', 1, { text: '→' })}
                <select
                  aria-label="段落对齐"
                  disabled={disabled}
                  defaultValue="left"
                  onChange={(e) => api.run('align', e.target.value)}
                >
                  {[
                    ['left', '左对齐'],
                    ['center', '居中'],
                    ['right', '右对齐'],
                    ['justify', '两端对齐'],
                  ].map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="段落标记"
                  disabled={disabled}
                  value={state.tag || ''}
                  onChange={(e) => api.run('tag', e.target.value || null)}
                >
                  {[
                    ['', '无标记'],
                    ['todo', '☐ 待办事项'],
                    ['important', '★ 重要'],
                    ['question', '? 问题'],
                    ['definition', '定义'],
                    ['idea', '◇ 灵感'],
                  ].map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                {run('完成待办', 'checked', null, { text: '✓' })}
              </div>
              <div className="outline-tool-group">
                {run('引用', 'quote')}
                {run('代码段落', 'code', null, { text: '代码' })}
                {run('上移段落', 'moveParagraph', -1, { text: '上移' })}
                {run('下移段落', 'moveParagraph', 1, { text: '下移' })}
                {run('折叠子段落', 'collapse', null, { text: '折叠 / 展开', hint: '折叠 Alt+Shift+减号 · 展开 Alt+Shift+加号' })}
                {btn('拆出当前段落', api.split, { text: '拆分' })}
                {btn('复制格式', api.copyFormat)}
                {btn('应用格式', api.pasteFormat)}
              </div>
            </>
          )}
          {tab === 'insert' && (
            <>
              <div className="outline-tool-group">
                {btn('新建容器', api.add, { disabled: !state.editable, icon: 'Plus' })}
                {btn('插入图片', api.image, { disabled: !state.editable, icon: 'Image' })}
                {btn('插入链接', () => api.link(), { icon: 'Link' })}
                {run('插入表格', 'table', null, { icon: 'Table' })}
                {btn('插入空间', () => api.setTool('space'), {
                  disabled: !state.editable,
                  active: state.tool === 'space',
                  hint: '向下拖动，为后面的容器留出空间',
                })}
              </div>
              {state.table && (
                <div className="outline-tool-group">
                  {[
                    ['选中表格', 'selectTable'],
                    ['插入行', 'addRowAfter'],
                    ['插入列', 'addColumnAfter'],
                    ['删除行', 'deleteRow'],
                    ['删除列', 'deleteColumn'],
                    ['合并单元格', 'mergeCells'],
                    ['拆分单元格', 'splitCell'],
                    ['删除表格', 'deleteTable'],
                  ].map(([label, cmd]) => run(label, cmd))}
                </div>
              )}
            </>
          )}
          {tab === 'view' && (
            <>
              <div className="outline-tool-group">
                <label>
                  缩放{' '}
                  <select
                    aria-label="页面缩放"
                    value={[25, 50, 75, 100, 125, 150, 200, 300].includes(state.zoom) ? state.zoom : ''}
                    onChange={(e) => api.zoom(Number(e.target.value))}
                  >
                    <option value="" disabled>
                      {state.zoom}%
                    </option>
                    {[25, 50, 75, 100, 125, 150, 200, 300].map((n) => (
                      <option key={n} value={n}>
                        {n}%
                      </option>
                    ))}
                  </select>
                </label>
                {btn('恢复 100%', () => api.zoom(100), { disabled: false })}
                <label className="outline-color">
                  纸张
                  <input
                    aria-label="纸张颜色"
                    type="color"
                    value={state.page.color || '#ffffff'}
                    disabled={!state.editable}
                    onChange={(e) => api.setPage({ color: e.target.value })}
                  />
                </label>
                <select
                  aria-label="纸张格线"
                  disabled={!state.editable}
                  value={state.page.rule || 'none'}
                  onChange={(e) => api.setPage({ rule: e.target.value })}
                >
                  {[
                    ['none', '无格线'],
                    ['lines', '横线'],
                    ['grid', '方格'],
                    ['dots', '点阵'],
                  ].map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>
        <div className="outline-modebar">
          {btn('编辑与框选', () => api.setTool('type'), {
            disabled: !state.editable,
            active: state.tool === 'type',
            text: '编辑',
            icon: 'FileText',
          })}
          {btn('平移画布', () => api.setTool('pan'), {
            disabled: false,
            active: state.tool === 'pan',
            text: '手形',
            icon: 'Hand',
          })}
          <span className="outline-ribbon-spacer" />
          {btn('新建容器', api.add, { disabled: !state.editable, icon: 'Plus' })}
          {btn('删除所选容器', api.remove, {
            disabled: !state.editable || !state.selected,
            icon: 'Trash2',
            text: '删除',
          })}
          <span className="outline-mode-hint">
            {state.tool === 'pan'
              ? '拖动画布浏览'
              : state.tool === 'space'
                  ? '向下拖动插入空白'
                  : '空白处：单击书写，拖动框选'}
          </span>
        </div>
        <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>插入链接</DialogTitle>
              <DialogDescription>输入 https://、http:// 或 mailto: 地址；留空可移除链接。</DialogDescription>
            </DialogHeader>
            <Input aria-label="链接地址" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
            <DialogFooter>
              <Button variant="outline" onClick={() => setLinkOpen(false)}>
                取消
              </Button>
              <Button
                onClick={() => {
                  if (url && !/^(https?:\/\/|mailto:|#)/i.test(url.trim())) {
                    sdk.toast('请输入有效链接')
                    return
                  }
                  api.run('link', url)
                  setLinkOpen(false)
                }}
              >
                应用链接
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={help} onOpenChange={setHelp}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>自由页面快捷键</DialogTitle>
              <DialogDescription>点击顶部操作柄可选择整个容器并按 Delete 删除。在表格内按 Esc 先选中表格，再按 Esc 选择容器；点击正文恢复文字编辑。</DialogDescription>
            </DialogHeader>
            <dl className="outline-shortcuts">
              {[
                ['Ctrl+B / I / U', '粗体 / 斜体 / 下划线'],
                ['Ctrl+K', '插入链接'],
                ['Ctrl+1 / 2 / 3', '待办 / 重要 / 问题'],
                ['Ctrl+. / Alt+.', '项目符号（两种按键均可）'],
                ['Ctrl+/', '编号列表'],
                ['Ctrl+Shift+8 / Ctrl+Shift+7', '项目符号 / 编号（中文输入法下的替代键）'],
                ['Tab / Shift+Tab', '段落缩进；表格中切换单元格'],
                ['Backspace（行首）', '减少一级缩进；列表中提升一级'],
                ['操作柄 / Esc，随后 Delete', '选中并删除整个容器；Ctrl+Z 可恢复'],
                ['表格左上角 ⊞ / 表格内 Esc，随后 Delete', '选中并删除整张表格；空表格内可直接按 Delete'],
                ['Alt+Shift+↑ / ↓', '上下移动段落或列表项，可跨列表边界，子项跟随'],
                ['Alt+Shift+减号 / 加号', '折叠 / 展开当前项的子内容'],
                ['Ctrl+A，再按 Ctrl+A', '文字全选 → 容器；Esc 后 Ctrl+A 全选容器'],
                ['Ctrl+Z / Ctrl+Y', '撤销 / 重做文字和布局操作'],
                ['Ctrl+C / X / V', '复制 / 剪切 / 粘贴文字或容器'],
                ['Ctrl+滚轮 / Ctrl+加减', '缩放页面；Ctrl+0 恢复 100%'],
                ['空格（非输入时）/ 中键', '临时平移画布'],
                ['Shift+拖动容器', '合并到目标容器；Ctrl+Z 可撤销'],
                ['空白处拖动 / 单击', '框选容器 / 松开后新建输入框；Esc 取消拖动'],
                ['方向键 / Shift+方向键', '操作柄上移动 1 / 10 单位'],
              ].map(([keys, label]) => (
                <React.Fragment key={keys}>
                  <dt>{keys}</dt>
                  <dd>{label}</dd>
                </React.Fragment>
              ))}
            </dl>
            <p className="outline-shortcut-note">项目符号使用 Ctrl+句号，也可用 Alt+句号或 Ctrl+Shift+8；中文输入时按主键盘句号键。组词选词期间不执行快捷键。编辑区会处理收到的编辑快捷键及 Alt+Shift+I；若输入法或浏览器提前截获 Ctrl+句号，请使用备用键或工具栏。</p>
          </DialogContent>
        </Dialog>
      </>
    )
  }
  const view = ctx.ui.mount(ctx, root, <Controls />)
  return () => view.render(<Controls />)
}
