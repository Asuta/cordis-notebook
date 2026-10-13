import { maxBackupBytes } from './backup.js'

export default function(ctx, sdk) {
  const model = ctx.notebook, io = ctx.blockNoteIO
  let disposed = false, working = false
  const el = sdk.el, dialog = el('dialog', { class: 'note-transfer-dialog', 'aria-labelledby': 'note-transfer-heading' })
  const title = el('input', { id: 'transfer-title', maxlength: '200', placeholder: '留空使用文件名或“导入笔记”' })
  const format = el('select', { id: 'transfer-format' })
  for (const [value, label] of [['markdown', 'Markdown'], ['html', 'HTML'], ['json', 'JSON / 图片备份']]) format.append(el('option', { value }, label))
  const source = el('textarea', { id: 'transfer-source', rows: '7', placeholder: '粘贴内容，或选择文件' })
  const file = el('input', { id: 'transfer-file', type: 'file', accept: '.md,.markdown,.html,.htm,.json' })
  const status = el('p', { role: 'status', class: 'transfer-status' })
  const close = el('button', { type: 'button' }, '关闭')
  const submit = el('button', { type: 'button' }, '导入为新笔记')
  const backup = el('button', { type: 'button' }, '备份全部笔记（含图片）')
  const markdown = el('button', { type: 'button' }, '导出当前页面 Markdown')
  const html = el('button', { type: 'button' }, '导出当前页面 HTML')
  const label = (text, input) => { const wrap = el('label', { for: input.id }, text); wrap.append(input); return wrap }
  const row = (...nodes) => { const wrap = el('div', { class: 'transfer-actions' }); wrap.append(...nodes); return wrap }
  dialog.append(el('h2', { id: 'note-transfer-heading' }, '导入与备份'),
    el('p', {}, '导入会创建新副本。Markdown / HTML 转换可能简化样式，导出的媒体保留原地址；完整恢复请选择包含图片的 JSON 备份。'),
    label('选择文件', file), label('导入格式', format), label('新笔记标题', title), label('导入内容', source),
    row(submit), el('hr'), row(markdown, html), row(backup),
    el('p', {}, '完整备份包含所有已保存笔记、页面关系和本地图片，最多 32 MB。外部图片和音视频仍使用原链接。'), status, row(close))
  sdk.mount('panels', dialog)
  const button = sdk.button('toolbar', '导入与备份', () => {
    setTimeout(() => { if (!disposed && !dialog.open) dialog.showModal() }, 0)
  }); button.setAttribute('aria-label', '导入与备份')
  const refresh = () => {
    const busy = working || model.busy
    submit.disabled = busy; backup.disabled = busy || !model.notes.length
    markdown.disabled = html.disabled = busy || model.current()?.type !== 'blocknote'
    file.disabled = format.disabled = title.disabled = source.disabled = busy
  }
  const run = async action => {
    if (working || model.busy || disposed) throw Error('请等待当前操作完成')
    working = true; status.textContent = '正在处理…'; refresh()
    try { return await action() }
    catch (error) { if (!disposed) status.textContent = error.message; throw error }
    finally { working = false; if (!disposed) refresh() }
  }
  const download = (content, name, mime) => {
    const url = URL.createObjectURL(new Blob([content], { type: mime })), link = el('a', { href: url, download: name.replace(/[<>:"/\\|?*]/g, '_') })
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const importContent = async ({ format, content, title = '', parentId = null }) => {
    if (typeof content !== 'string' || new TextEncoder().encode(content).length > maxBackupBytes) throw Error('导入文件不能超过 32 MB')
    if (typeof title !== 'string' || title.length > 200) throw Error('标题不能超过 200 字符')
    if (disposed) throw Error('导入服务已停用')
    if (format === 'json') {
      const data = JSON.parse(content)
      if (data?.format === 'cordis-notebook-backup' || data?.format === 'cordis-note') {
        const notes = await model.importNotes(async () => (await sdk.request('/api/notebook-restore', 'POST', data)).notes)
        if (!notes) throw Error('恢复已中断，请检查笔记列表')
        return { ids: notes.map(note => note.id), count: notes.length }
      }
    }
    const document = io.parse(format, content)
    const note = await model.create('blocknote', { title: title || '导入笔记', document, parentId })
    if (!note) throw Error('导入已中断，请检查笔记列表')
    return { ids: [note.id], count: 1 }
  }
  sdk.listen(close, 'click', () => dialog.close())
  sdk.listen(file, 'change', async () => {
    const selected = file.files?.[0]; if (!selected) return
    try {
      await run(async () => {
        if (selected.size > maxBackupBytes) throw Error('文件不能超过 32 MB')
        const text = await selected.text(); if (disposed) return
        source.value = text; title.value = selected.name.replace(/\.(?:md|markdown|html?|json)$/i, '').slice(0, 200)
        format.value = /\.html?$/i.test(selected.name) ? 'html' : /\.json$/i.test(selected.name) ? 'json' : 'markdown'
        status.textContent = '文件已读取，点击“导入为新笔记”开始。'
      })
    } catch { /* Error is shown in the dialog. */ }
  })
  sdk.listen(submit, 'click', async () => {
    try { await run(async () => { const result = await importContent({ format: format.value, content: source.value, title: title.value }); if (!disposed) { status.textContent = `已导入 ${result.count} 篇新笔记，原笔记保留。`; source.value = ''; file.value = ''; ctx.shell.showEditor?.() } }) } catch { /* shown */ }
  })
  for (const [button, kind, mime] of [[markdown, 'markdown', 'text/markdown;charset=utf-8'], [html, 'html', 'text/html;charset=utf-8']]) sdk.listen(button, 'click', async () => {
    try { await run(async () => { const note = model.current(), text = io.export(note, kind); download(text, (note.title || '笔记') + (kind === 'markdown' ? '.md' : '.html'), mime); status.textContent = '已导出。部分样式、嵌套和页面引用可能简化；完整结构请使用图片备份。' }) } catch { /* shown */ }
  })
  sdk.listen(backup, 'click', async () => {
    try { await run(async () => { await model.flush(); if (disposed) return; const data = await sdk.request('/api/notebook-backup'); if (disposed) return; download(JSON.stringify(data), '笔记备份-' + new Date().toISOString().slice(0, 10) + '.json', 'application/json'); status.textContent = `已备份 ${data.notes.length} 篇笔记和 ${data.assets.length} 张本地图片。` }) } catch { /* shown */ }
  })
  const object = properties => ({ type: 'object', properties, additionalProperties: false })
  sdk.agent.register({ name: 'notebook_import_document', description: '将 Markdown、HTML 或原生 BlockNote JSON 导入为新笔记；也可恢复 cordis-note / cordis-notebook-backup JSON 为新副本，不覆盖已有笔记。可提供 title/parentId；备份自身的标题与层级优先。Markdown/HTML 可能简化样式。', inputSchema: { ...object({ format: { enum: ['markdown', 'html', 'json'], type: 'string' }, content: { type: 'string' }, title: { type: 'string' }, parentId: { type: ['string', 'null'] } }), required: ['format', 'content'] } }, args => run(() => importContent(args)))
  sdk.agent.register({ name: 'notebook_export_document', description: '返回当前 BlockNote 页面 Markdown、HTML 或原生 JSON 文本，包含当前草稿。Markdown/HTML 是有损转换；带图片的完整备份请在“导入与备份”下载。', inputSchema: { ...object({ format: { type: 'string', enum: ['markdown', 'html', 'json'] } }), required: ['format'] } }, ({ format }) => {
    if (disposed || model.busy) throw Error('当前不可导出')
    return { format, content: io.export(model.current(), format), lossy: format !== 'json' }
  })
  model.observe(ctx, refresh)
  refresh()
  ctx.effect(() => () => { disposed = true; if (dialog.open) dialog.close() })
}
