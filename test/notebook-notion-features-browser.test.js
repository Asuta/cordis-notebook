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
  const seed = await setup(app)
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  t.after(async () => { await browser.close(); await app.close(); await rm(dir, { recursive: true, force: true }) })
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
