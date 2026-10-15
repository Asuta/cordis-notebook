import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { createApp } from '../server/server.js'
import { blockNoteDocument as blocks } from '../applications/notebook/plugins/format-blocknote/document.js'
const enabled = process.env.CORDIS_BROWSER_TEST === '1'
async function until(check, label) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 40)) }
  assert.fail('等待失败：' + label)
}
async function fixture(t, setup) {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-notion-browser-'))
  const app = await createApp({ port: 0, dataDir: dir, file: join(dir, 'notes.json') })
  let browser
  t.after(async () => { await browser?.close(); await app.close(); await rm(dir, { recursive: true, force: true }) })
  const seed = await setup(app)
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  const url = 'http://127.0.0.1:' + app.server.address().port
  await page.route('**/feature-bridge', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><iframe src="/" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe><script>
    const frame=document.querySelector('iframe'),pending=new Map();let ready;
    window.addEventListener('message',event=>{if(event.source!==frame.contentWindow||event.origin!==location.origin)return;const value=event.data;if(value?.channel!=='cordis-agent')return;if(value.type==='ready')ready=value;if(value.type==='result'){const waiter=pending.get(value.id);if(waiter){pending.delete(value.id);value.error?waiter.reject(Error(value.error)):waiter.resolve(value.result)}}});
    const timer=setInterval(()=>{if(ready?.tools.some(t=>t.name==='notebook_database_write'))clearInterval(timer);else frame.contentWindow.postMessage({channel:'cordis-agent',type:'connect'},location.origin)},100);
    window.testReady=()=>ready?.tools.some(t=>t.name==='notebook_database_write')&&ready?.tools.some(t=>t.name==='notebook_restore');
    window.testCall=(name,args)=>new Promise((resolve,reject)=>{const id=crypto.randomUUID();pending.set(id,{resolve,reject});frame.contentWindow.postMessage({...ready,channel:'cordis-agent',type:'call',id,name,args},location.origin)});
    </script>` }))
  await page.goto(url + '/feature-bridge')
  await until(() => page.evaluate(() => window.testReady()), '新增工具注册')
  const call = (name, args = {}) => page.evaluate(({ name, args }) => window.testCall(name, args), { name, args })
  return { app, page, frame: page.frameLocator('iframe'), call, errors, seed }
}

test('产品浏览器：提示框、目录、块/行内公式、附件上传及保存刷新', { skip: !enabled }, async t => {
  const f = await fixture(t, app => app.ctx.notes.create({ type: 'blocknote', fields: { title: '新增组件', document: { version: 1, blocks: [
    blocks.create('tableOfContents', '', 'toc'), { ...blocks.create('heading', '章节一', 'heading'), props: { level: 1 } },
    blocks.create('callout', '提示内容', 'callout'), blocks.create('equation', 'x^2', 'equation'), blocks.create('file', '', 'file'), blocks.create('paragraph', '', 'last'),
  ] } } }))
  const { frame, page, call, app, seed, errors } = f, editor = frame.getByLabel('BlockNote 正文', { exact: true })
  await editor.waitFor()
  await frame.getByLabel('提示框样式').selectOption('warning')
  await frame.getByLabel('LaTeX 公式', { exact: true }).fill('E=mc^2')
  await until(() => app.ctx.notes.list()[0].document.blocks.find(b => b.id === 'equation').props.expression === 'E=mc^2', '公式保存')
  const before = await call('notebook_blocknote_read')
  await call('notebook_blocknote_edit', { id: before.id, revision: before.revision, operations: [{ op: 'update', blockId: 'heading', patch: { text: '目录同步的新标题' } }] })
  assert.equal(await frame.getByRole('navigation', { name: '页面目录' }).getByRole('button', { name: '目录同步的新标题' }).count(), 1)
  await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter'); await page.keyboard.type('/')
  await frame.getByRole('option', { name: '行内公式', exact: true }).click()
  const inlineSource = frame.locator('.notebook-inline-math input')
  await inlineSource.fill('a^2+b^2')
  await assert.rejects(call('notebook_create', { title: '不应离开未完成的公式' }), /公式/)
  const pending = await call('notebook_blocknote_read')
  await assert.rejects(call('notebook_blocknote_edit', { id: pending.id, revision: pending.revision, operations: [{ op: 'update', blockId: 'heading', patch: { text: '不应覆盖公式草稿' } }] }), /公式/)
  await frame.getByRole('button', { name: '完成', exact: true }).click()
  await until(() => app.ctx.notes.list().find(n => n.id === seed.id).content.includes('a^2+b^2'), '行内公式持久化')
  // BlockNote's native file picker drives the actual upload callback.
  const fileBlock = frame.locator('[data-node-type="blockContainer"][data-id="file"]')
  await fileBlock.click()
  const fileInput = frame.locator('input.bn-file-input[type=file]')
  await fileInput.setInputFiles({ name: 'example.txt', mimeType: 'text/plain', buffer: Buffer.from('附件正文') })
  await until(() => app.ctx.notes.list().find(n => n.id === seed.id).document.blocks.find(b => b.id === 'file').props.url.startsWith('/api/note-files/'), '本地文件上传保存')
  await page.reload(); await until(() => page.evaluate(() => window.testReady()), '刷新后工具恢复')
  await editor.waitFor()
  assert.equal(await frame.getByLabel('LaTeX 公式', { exact: true }).inputValue(), 'E=mc^2')
  assert.equal(await frame.getByLabel('提示框样式').inputValue(), 'warning')
  assert.equal(await frame.getByRole('button', { name: '编辑行内公式' }).count(), 1)
  const exported = await call('notebook_export_document', { format: 'html' })
  assert.match(exported.content, /data-notebook-equation/); assert.match(exported.content, /a\^2\+b\^2/)
  const imported = await call('notebook_import_document', { format: 'html', content: exported.content, title: '扩展块 HTML 回读' })
  const importedNote = app.ctx.notes.list().find(note => note.id === imported.ids[0])
  assert.ok(importedNote.document.blocks.some(block => block.type === 'equation' && block.props.expression === 'E=mc^2'))
  assert.ok(importedNote.document.blocks.some(block => block.type === 'callout'))
  assert.match(importedNote.content, /a\^2\+b\^2/)
  if (process.env.CORDIS_BROWSER_ARTIFACT_DIR) {
    const output = resolve(process.env.CORDIS_BROWSER_ARTIFACT_DIR); await mkdir(output, { recursive: true })
    await page.screenshot({ path: join(output, 'notebook-components.png'), fullPage: true })
  }
  assert.deepEqual(errors, [])
})

test('产品浏览器：自定义字段、命名视图、属性筛选排序和刷新保存，Agent 配置拒绝旧版本', { skip: !enabled }, async t => {
  const { app, frame, page, call, seed, errors } = await fixture(t, app => app.ctx.notes.create({ type: 'database', fields: { title: '预算库' } }))
  await frame.getByRole('button', { name: '新增字段', exact: true }).click()
  await frame.getByLabel('字段名称', { exact: true }).fill('预算')
  await frame.getByLabel('字段类型', { exact: true }).selectOption('number')
  await assert.rejects(call('notebook_create', { title: '不可丢失设置草稿' }), /未保存/)
  await frame.getByRole('dialog', { name: '新增字段', exact: true }).getByRole('button', { name: '保存', exact: true }).click()
  await until(() => app.ctx.notes.list().find(note => note.id === seed.id).database.fields.length === 1, '新增数字字段')
  const field = app.ctx.notes.list().find(note => note.id === seed.id).database.fields[0]
  await frame.getByRole('button', { name: '新增记录', exact: true }).click()
  assert.equal(await frame.getByLabel('记录正文格式', { exact: true }).inputValue(), 'blocknote')
  await frame.getByLabel('记录标题', { exact: true }).fill('大项目')
  await frame.getByLabel('属性：预算', { exact: true }).fill('100')
  await frame.getByRole('button', { name: '保存记录', exact: true }).click()
  await until(() => app.ctx.notes.list().some(note => note.title === '大项目'), '自定义值保存')
  await call('notebook_database_write', { databaseId: seed.id, action: 'create', title: '小项目', properties: { custom: { [field.id]: 2 } } })
  await frame.getByRole('button', { name: '添加属性筛选', exact: true }).click()
  await frame.getByLabel('筛选条件 1', { exact: true }).selectOption('gte')
  await frame.getByLabel('筛选值 1', { exact: true }).fill('10')
  await frame.getByLabel('排序方式', { exact: true }).selectOption(field.id)
  await frame.getByLabel('排序方向', { exact: true }).selectOption('desc')
  await frame.getByRole('button', { name: '新建视图', exact: true }).click()
  await frame.getByLabel('视图名称', { exact: true }).fill('高预算项目')
  await frame.getByRole('dialog', { name: '新建视图', exact: true }).getByRole('button', { name: '保存', exact: true }).click()
  await until(() => app.ctx.notes.list().find(note => note.id === seed.id).database.views.length === 3, '命名视图保存')
  const before = await call('notebook_database_read', { id: seed.id })
  assert.deepEqual(before.rows.map(note => note.title), ['大项目'])
  await page.reload(); await until(() => page.evaluate(() => window.testReady()), '刷新视图工具')
  await call('notebook_open', { id: seed.id })
  assert.equal(await frame.getByRole('button', { name: '高预算项目', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.equal(await frame.getByLabel('筛选值 1', { exact: true }).inputValue(), '10')
  assert.equal(await frame.getByRole('table', { name: '数据库记录' }).getByRole('button', { name: '小项目', exact: true }).count(), 0)
  await frame.locator('.database-field-list summary').click()
  await frame.getByRole('button', { name: '预算', exact: true }).click()
  await frame.getByLabel('字段名称', { exact: true }).fill('金额')
  await frame.getByRole('dialog', { name: '编辑字段', exact: true }).getByRole('button', { name: '保存', exact: true }).click()
  await until(() => app.ctx.notes.list().find(note => note.id === seed.id).database.fields[0].name === '金额', '字段重命名')
  assert.equal(app.ctx.notes.list().find(note => note.title === '大项目').properties.custom[field.id], 100)
  await assert.rejects(call('notebook_database_configure', { id: seed.id, revision: before.revision, fields: [] }), /版本/)
  const current = await call('notebook_database_read', { id: seed.id })
  await assert.rejects(call('notebook_database_configure', { id: seed.id, revision: current.revision, fields: [{ ...current.fields[0], type: 'checkbox' }] }), /字段|类型/)
  await frame.getByLabel('筛选值 1', { exact: true }).fill('200')
  await frame.getByRole('button', { name: '保存视图', exact: true }).click()
  await until(() => app.ctx.notes.list().find(note => note.id === seed.id).database.views.find(view => view.name === '高预算项目').filter.rules[0].value === 200, '保存已有视图设置')
  assert.equal((await call('notebook_database_read', { id: seed.id })).rows.length, 0)
  if (process.env.CORDIS_BROWSER_ARTIFACT_DIR) await page.screenshot({ path: join(resolve(process.env.CORDIS_BROWSER_ARTIFACT_DIR), 'database-custom-views.png'), fullPage: true })
  assert.deepEqual(errors, [])
})

test('产品浏览器：停用默认格式后，新记录选择可用格式并按所选类型保存', { skip: !enabled }, async t => {
  const { app, frame, page, seed, errors } = await fixture(t, async app => {
    for (const id of ['note-transfer', 'blocknote-editor', 'blocknote-agent-tools', 'format-blocknote']) await app.manager.toggle(id, false)
    return app.ctx.notes.create({ type: 'database', fields: { title: '可用格式回退' } })
  })
  for (const plainEnabled of [true, false]) {
    if (!plainEnabled) {
      await app.manager.toggle('format-plain', false)
      await page.reload(); await until(() => page.evaluate(() => window.testReady()), '格式停用后工具恢复')
    }
    await frame.getByRole('button', { name: '新增记录', exact: true }).click()
    const select = frame.getByLabel('记录正文格式', { exact: true }), type = await select.inputValue()
    const available = await select.locator('option').evaluateAll(options => options.map(option => option.value))
    assert.equal(available.includes('blocknote'), false)
    assert.ok(type && available.includes(type), '表单默认值必须属于当前可用格式')
    if (plainEnabled) assert.equal(type, 'plain')
    else assert.equal(available.includes('plain'), false)
    const title = '回退保存：' + type
    await frame.getByLabel('记录标题', { exact: true }).fill(title)
    await frame.getByRole('button', { name: '保存记录', exact: true }).click()
    await frame.getByRole('dialog', { name: '新增记录', exact: true }).waitFor({ state: 'detached' })
    const saved = app.ctx.notes.list().find(note => note.title === title)
    assert.equal(saved?.type, type, '实际保存格式与下拉框选择一致')
    assert.equal(saved?.parentId, seed.id)
  }
  await page.reload(); await until(() => page.evaluate(() => window.testReady()), '回退记录刷新')
  const table = frame.getByRole('table', { name: '数据库记录', exact: true })
  await table.waitFor()
  assert.equal(await table.locator('tbody tr').count(), 2)
  assert.deepEqual(errors, [])
})

test('产品浏览器：斜线菜单插入数据库，内嵌编辑共享记录，视图和引用保存刷新', { skip: !enabled }, async t => {
  const f = await fixture(t, async app => {
    const database = await app.ctx.notes.create({ type: 'database', fields: { title: '嵌入的任务库' } })
    const row = await app.ctx.notes.create({ type: 'blocknote', fields: { title: '共享任务', parentId: database.id } })
    const page = await app.ctx.notes.create({ type: 'blocknote', fields: { title: '项目主页', document: { version: 1, blocks: [blocks.create('paragraph', '项目介绍', 'intro')] } } })
    return { database, row, page }
  })
  const { frame, page, call, seed, app, errors } = f
  const editor = frame.getByLabel('BlockNote 正文', { exact: true })
  await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter'); await page.keyboard.type('/')
  await frame.getByRole('option', { name: '数据库视图', exact: true }).click()
  await frame.getByLabel('引用数据库', { exact: true }).selectOption(seed.database.id)
  const embedded = frame.getByRole('region', { name: '数据库：嵌入的任务库', exact: true })
  await embedded.getByRole('button', { name: '共享任务', exact: true }).waitFor()
  await embedded.getByLabel('状态：共享任务', { exact: true }).selectOption('doing')
  await until(() => app.ctx.notes.list().find(note => note.id === seed.row.id).properties?.status === 'doing', '内嵌编辑写原记录')
  await embedded.getByRole('button', { name: '看板视图', exact: true }).click()
  await until(() => app.ctx.notes.list().find(note => note.id === seed.page.id).document.blocks.some(block => block.type === 'databaseView' && block.props.viewId === 'board'), '引用视图保存')
  assert.equal(app.ctx.notes.list().find(note => note.id === seed.database.id).database.activeViewId, 'table', '内嵌选择不改数据库默认视图')
  await embedded.getByRole('button', { name: '新建视图', exact: true }).click()
  await frame.getByLabel('视图名称', { exact: true }).fill('主页专用看板')
  await frame.getByRole('dialog', { name: '新建视图', exact: true }).getByRole('button', { name: '保存', exact: true }).click()
  await until(() => app.ctx.notes.list().find(note => note.id === seed.database.id).database.views.length === 3, '正文中新建命名视图')
  assert.equal(app.ctx.notes.list().find(note => note.id === seed.database.id).database.activeViewId, 'table', '正文中新建视图也不改变原数据库默认视图')
  await embedded.getByRole('button', { name: '看板视图', exact: true }).click()
  await until(() => app.ctx.notes.list().find(note => note.id === seed.page.id).document.blocks.some(block => block.type === 'databaseView' && block.props.viewId === 'board'), '重新保存原引用视图')
  await page.reload(); await until(() => page.evaluate(() => window.testReady()), '内嵌刷新工具')
  await call('notebook_open', { id: seed.page.id })
  await embedded.getByRole('button', { name: '共享任务', exact: true }).waitFor()
  assert.equal(await embedded.getByRole('button', { name: '看板视图', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.equal((await call('notebook_database_read', { id: seed.database.id })).rows[0].properties.status, 'doing')
  const exported = await call('notebook_export_document', { format: 'html' })
  assert.match(exported.content, /data-notebook-database/)
  const imported = await call('notebook_import_document', { format: 'html', content: exported.content, title: '主页引用副本' })
  const importedPage = app.ctx.notes.list().find(note => note.id === imported.ids[0])
  assert.equal(importedPage.document.blocks.find(block => block.type === 'databaseView').props.databaseId, seed.database.id)
  await app.manager.toggle('database-editor', false)
  await frame.getByText('请启用“数据库与命名视图”插件以显示此数据库。', { exact: true }).waitFor()
  assert.equal(await editor.getAttribute('contenteditable'), 'true', '可选数据库服务停用不影响正文编辑')
  await app.manager.toggle('database-editor', true)
  await embedded.getByRole('button', { name: '共享任务', exact: true }).waitFor()
  if (process.env.CORDIS_BROWSER_ARTIFACT_DIR) await page.screenshot({ path: join(resolve(process.env.CORDIS_BROWSER_ARTIFACT_DIR), 'database-embedded.png'), fullPage: true })
  assert.deepEqual(errors, [])
})

test('产品浏览器：模板库保存、独立创建、编辑和回收，Agent 模板版本保护', { skip: !enabled }, async t => {
  const f = await fixture(t, async app => {
    const database = await app.ctx.notes.create({ type: 'database', fields: { title: '会议库' } })
    const page = await app.ctx.notes.create({ type: 'blocknote', fields: { title: '会议样例', parentId: database.id, properties: { status: 'doing', tags: ['周会'] }, document: { version: 1, blocks: [blocks.create('heading', '讨论事项', 'heading'), blocks.create('checkListItem', '跟进行动', 'task')] } } })
    return { database, page }
  })
  const { frame, call, app, seed, errors } = f
  await frame.getByRole('button', { name: '更多笔记操作' }).click()
  await frame.getByRole('menuitem', { name: '模板库', exact: true }).click()
  await frame.getByLabel('模板名称', { exact: true }).fill('周会模板')
  assert.equal(await frame.getByLabel('模板范围', { exact: true }).inputValue(), seed.database.id)
  await assert.rejects(call('notebook_create', { title: '不可丢失模板表单' }), /未保存/)
  await frame.getByRole('button', { name: '保存为模板', exact: true }).click()
  await until(() => app.ctx.notes.list().some(note => note.template && note.title === '周会模板'), '模板保存')
  await frame.getByLabel('模板新页面标题', { exact: true }).fill('本周会议')
  await frame.getByRole('button', { name: '使用模板：周会模板', exact: true }).click()
  await until(() => app.ctx.notes.list().some(note => note.title === '本周会议'), '模板创建页面')
  const copy = app.ctx.notes.list().find(note => note.title === '本周会议')
  assert.equal(copy.template, null); assert.equal(copy.parentId, seed.database.id); assert.equal(copy.properties.status, 'doing'); assert.match(copy.content, /跟进行动/)
  const [template] = await call('notebook_templates', { databaseId: seed.database.id })
  const list = await call('notebook_list'); assert.equal(list.notes.some(note => note.id === template.id), false)
  await call('notebook_open', { id: template.id })
  const read = await call('notebook_blocknote_read')
  await call('notebook_blocknote_edit', { id: read.id, revision: read.revision, operations: [{ op: 'update', blockId: 'heading', patch: { text: '新版模板' } }] })
  assert.match(app.ctx.notes.list().find(note => note.id === copy.id).content, /讨论事项/)
  await assert.rejects(call('notebook_template_apply', { templateId: template.id, revision: template.revision }), /版本/)
  const [latest] = await call('notebook_templates')
  const second = await call('notebook_template_apply', { templateId: latest.id, revision: latest.revision, title: '下周会议' })
  assert.match(second.content, /新版模板/)
  await call('notebook_template_delete', { templateId: latest.id, revision: latest.revision })
  assert.equal((await call('notebook_templates')).length, 0)
  const trash = await call('notebook_history', { trash: true })
  await call('notebook_restore', { kind: 'trash', entryId: trash.find(entry => entry.note.id === latest.id).id })
  assert.equal((await call('notebook_templates')).length, 1)
  assert.equal((await call('notebook_database_read', { id: seed.database.id })).rows.length, 3)
  assert.deepEqual(errors, [])
})

test('产品浏览器：数据库表格/看板、日期筛选、Agent 读写、冲突和属性草稿保护', { skip: !enabled }, async t => {
  const f = await fixture(t, app => app.ctx.notes.create({ type: 'database', fields: { title: '项目任务' } }))
  const { frame, page, call, app, seed, errors } = f
  await frame.getByRole('button', { name: '新增记录', exact: true }).click()
  await frame.getByLabel('记录标题', { exact: true }).fill('第一条任务')
  await frame.getByLabel('记录状态', { exact: true }).selectOption('doing')
  await frame.getByLabel('记录标签', { exact: true }).fill('本周, 开发')
  await frame.getByLabel('记录日期', { exact: true }).fill('2026-10-16')
  await assert.rejects(call('notebook_create', { title: '不应丢失属性草稿' }), /未保存/)
  await frame.getByRole('button', { name: '保存记录', exact: true }).click()
  await until(() => app.ctx.notes.list().some(note => note.title === '第一条任务'), '新增记录')
  let row = app.ctx.notes.list().find(note => note.title === '第一条任务')
  assert.equal(row.properties.date, '2026-10-16')
  assert.equal(row.parentId, seed.id)
  await frame.getByRole('button', { name: '看板视图', exact: true }).click()
  await until(() => app.ctx.notes.list().find(note => note.id === seed.id).database.view === 'board', '看板偏好保存')
  await frame.getByLabel('状态：第一条任务').selectOption('done')
  await until(() => app.ctx.notes.list().find(note => note.id === row.id).properties.status === 'done', '看板状态修改')
  await frame.getByLabel('筛选状态').selectOption('doing')
  assert.equal(await frame.getByText('没有符合筛选条件的记录。').count(), 1)
  await frame.getByRole('button', { name: '清除筛选' }).click()
  await frame.getByLabel('开始日期').fill('2026-10-17')
  assert.equal(await frame.getByText('没有符合筛选条件的记录。').count(), 1)
  await frame.getByRole('button', { name: '清除筛选' }).click()
  const read = await call('notebook_database_read', { id: seed.id, tag: '本周' })
  assert.equal(read.rows[0].properties.status, 'done')
  await call('notebook_database_write', { databaseId: seed.id, action: 'update', rowId: row.id, revision: read.rows[0].revision, properties: { status: 'todo' } })
  await assert.rejects(call('notebook_database_write', { databaseId: seed.id, action: 'update', rowId: row.id, revision: read.rows[0].revision, title: '旧写入' }), /版本/)
  const created = await call('notebook_database_write', { databaseId: seed.id, action: 'create', title: 'Agent 新记录', properties: { tags: ['自动化'], date: '2026-10-20' } })
  assert.equal(created.parentId, seed.id)
  await frame.getByRole('button', { name: '第一条任务', exact: true }).click()
  await frame.getByLabel('BlockNote 正文', { exact: true }).waitFor()
  await frame.getByRole('navigation', { name: '页面路径' }).getByRole('button', { name: '项目任务', exact: true }).click()
  await page.reload(); await until(() => page.evaluate(() => window.testReady()), '刷新后数据库工具')
  assert.equal(await frame.getByRole('button', { name: '看板视图', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.equal((await call('notebook_database_read', { id: seed.id })).rows.length, 2)
  if (process.env.CORDIS_BROWSER_ARTIFACT_DIR) {
    const output = resolve(process.env.CORDIS_BROWSER_ARTIFACT_DIR); await mkdir(output, { recursive: true })
    await page.screenshot({ path: join(output, 'notebook-database.png'), fullPage: true })
  }
  assert.deepEqual(errors, [])
})

test('产品浏览器：历史预览、恢复、删除入回收站及 Agent 恢复', { skip: !enabled }, async t => {
  const f = await fixture(t, async app => {
    const note = await app.ctx.notes.create({ fields: { title: '历史原版', content: '应当保留的正文' } })
    await app.ctx.notes.update(note.id, { title: '历史新版', content: '修改后正文' }, 0)
    return note
  })
  const { frame, call, app, seed, errors } = f
  await frame.getByRole('button', { name: '更多笔记操作' }).click()
  await frame.getByRole('menuitem', { name: '历史与回收站', exact: true }).click()
  await frame.getByRole('button', { name: /历史原版.*v0/ }).click()
  assert.match(await frame.getByLabel('版本内容预览').innerText(), /应当保留的正文/)
  await frame.getByRole('button', { name: '恢复所选记录', exact: true }).click()
  await until(() => app.ctx.notes.list()[0].title === '历史原版', '历史恢复')
  await frame.getByRole('button', { name: '关闭', exact: true }).click()
  await frame.getByRole('button', { name: '更多笔记操作' }).click()
  await frame.getByRole('menuitem', { name: '删除笔记', exact: true }).click()
  await frame.getByRole('button', { name: '确认删除', exact: true }).click()
  await until(() => app.ctx.notes.list().length === 0, '移入回收站')
  const trash = await call('notebook_history', { trash: true })
  assert.equal(trash[0].note.id, seed.id)
  await call('notebook_restore', { kind: 'trash', entryId: trash[0].id })
  await frame.getByLabel('笔记标题', { exact: true }).waitFor()
  assert.equal(await frame.getByLabel('笔记标题', { exact: true }).inputValue(), '历史原版')
  assert.equal(app.ctx.notes.list()[0].content, '应当保留的正文')
  assert.deepEqual(errors, [])
})
