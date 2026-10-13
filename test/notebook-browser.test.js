import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir, cp, readFile, readdir, symlink, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, basename } from 'node:path'
import { chromium } from 'playwright'
import { createApp } from '../server/server.js'
import { startDevelopment } from '../scripts/dev.js'

const enabled = process.env.CORDIS_BROWSER_TEST === '1'
async function until(check, label) {
  const end = Date.now() + 15000
  while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 40)) }
  assert.fail('等待失败：' + label)
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-product-'))
  const app = await createApp({ port: 0, file: join(dir, 'notes.json') }), browser = await chromium.launch({ headless: true })
  t.after(async () => { await browser.close(); await app.close(); await rm(dir, { recursive: true, force: true }) })
  const errors = [], page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') t.diagnostic(message.text().slice(0,1500)) })
  page.on('requestfailed', request => t.diagnostic(request.url() + ': ' + request.failure()?.errorText))
  const url = 'http://127.0.0.1:' + app.server.address().port
  await page.goto(url)
  return { dir, app, browser, page, url, errors }
}
async function create(page, label, title) {
  await page.getByRole('button', { name: '新建笔记', exact: true }).click()
  const response = page.waitForResponse(response => response.url().endsWith('/api/notes') && response.request().method() === 'POST')
  await page.getByRole('menuitem', { name: label, exact: true }).click()
  assert.equal((await response).ok(), true)
  await until(async () => (await page.locator('.note-card[aria-current=page]').innerText()).includes('无标题笔记') && await page.getByRole('textbox', { name: '笔记标题', exact: true }).inputValue() === '', '新笔记完成选择')
  await page.getByRole('textbox', { name: '笔记标题', exact: true }).fill(title)
}

test('产品浏览器：BlockNote 导入导出、页面关系、引用改名跳转和备份恢复', { skip: !enabled, timeout: 90000 }, async t => {
  const { page, app, url, errors } = await fixture(t)
  await page.route(url + '/transfer-bridge', route => route.fulfill({ contentType: 'text/html', body: `
    <style>body{margin:0}iframe{width:100vw;height:100vh;border:0}</style><iframe src="/"></iframe><script>
    let ready; const pending=new Map();
    addEventListener('message',e=>{const m=e.data;if(m?.channel!=='cordis-agent')return;if(m.type==='ready')ready=m;if(m.type==='result'){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(m.error)):p.resolve(m.result)}});
    const frame=document.querySelector('iframe');const timer=setInterval(()=>{if(ready)clearInterval(timer);else frame.contentWindow.postMessage({channel:'cordis-agent',type:'connect'},location.origin)},100);
    window.testReady=()=>ready?.tools.some(t=>t.name==='notebook_page_relations')&&ready?.tools.some(t=>t.name==='notebook_import_document');
    window.testCall=(name,args)=>new Promise((resolve,reject)=>{const id=crypto.randomUUID();pending.set(id,{resolve,reject});frame.contentWindow.postMessage({...ready,channel:'cordis-agent',type:'call',id,name,args},location.origin)});
    </script>` }))
  await page.goto(url + '/transfer-bridge')
  await until(() => page.evaluate(() => window.testReady()), '导入与页面关系工具公开')
  const call = (name, args = {}) => page.evaluate(({ name, args }) => window.testCall(name, args), { name, args })
  const frame = page.frameLocator('iframe'), editor = frame.getByLabel('BlockNote 正文', { exact: true })
  const parent = (await call('notebook_create', { title: '参考页面' })).note
  const imported = await call('notebook_import_document', { format: 'markdown', title: '导入文档', parentId: parent.id, content: '# 导入标题\n\n**加粗** 和 [链接](https://example.com)\n\n- 第一项\n- 第二项' })
  assert.equal(imported.count, 1)
  await editor.waitFor()
  assert.match(await editor.innerText(), /导入标题/)
  assert.equal(app.ctx.notes.list().find(note => note.id === imported.ids[0]).parentId, parent.id)
  const exported = await call('notebook_export_document', { format: 'markdown' })
  assert.match(exported.content, /\*\*加粗\*\*/)
  const html = await call('notebook_export_document', { format: 'html' })
  assert.match(html.content, /<strong>加粗<\/strong>/)
  const relations = await call('notebook_page_relations')
  assert.equal(relations.ancestors[0].id, parent.id)
  // Real suggestion menu: insert an inline reference through typing, then save.
  await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter'); await page.keyboard.type('@')
  await frame.getByRole('option', { name: /参考页面/ }).click()
  await page.keyboard.press('Control+s')
  await until(() => app.ctx.noteFormats.references(app.ctx.notes.list().find(note => note.id === imported.ids[0])).includes(parent.id), '@ 引用保存')
  assert.match((await call('notebook_export_document', { format: 'html' })).content, /参考页面/)
  assert.match((await call('notebook_export_document', { format: 'markdown' })).content, /参考页面/)
  assert.equal((await call('notebook_page_relations', { id: parent.id })).backlinks[0].id, imported.ids[0])
  await frame.getByRole('button', { name: '打开页面：参考页面', exact: true }).click()
  await until(async () => (await call('notebook_read')).note.id === parent.id, '点击引用跳转')
  const before = await call('notebook_read')
  await call('notebook_update', { id: parent.id, revision: before.revision, patch: { title: '参考页面改名' } })
  await call('notebook_open', { id: imported.ids[0] })
  await frame.getByRole('button', { name: '打开页面：参考页面改名', exact: true }).waitFor()
  await page.reload(); await until(() => page.evaluate(() => window.testReady()), '刷新后工具恢复')
  await frame.getByRole('button', { name: '打开页面：参考页面改名', exact: true }).waitFor()
  if (process.env.CORDIS_BROWSER_ARTIFACT_DIR) {
    const directory = resolve(process.env.CORDIS_BROWSER_ARTIFACT_DIR)
    await mkdir(directory, { recursive: true })
    await page.screenshot({ path: join(directory, 'notebook-page-relations.png'), fullPage: true })
  }
  await frame.getByRole('button', { name: '更多笔记操作' }).click()
  await frame.getByRole('menuitem', { name: '页面关系', exact: true }).click()
  const dialog = frame.getByRole('dialog', { name: '页面关系', exact: true })
  await dialog.getByLabel('父页面', { exact: true }).selectOption('')
  await until(() => app.ctx.notes.list().find(note => note.id === imported.ids[0]).parentId === null, '移动回顶层')
  await dialog.getByRole('button', { name: '新建子页面', exact: true }).click()
  await until(() => app.ctx.notes.list().some(note => note.parentId === imported.ids[0]), '界面创建子页面')
  assert.ok(await frame.locator('.note-tree-row').count() >= 3)
  await call('notebook_open', { id: imported.ids[0] })
  await assert.rejects(call('notebook_import_document', { format: 'markdown', content: '# 失败', parentId: 'missing' }), /父页面不存在/)
  const safeHTML = await call('notebook_import_document', { format: 'html', title: '安全 HTML', content: '<script>window.importRan=true</script><h2>HTML 标题</h2><p><em>正文</em></p><iframe src="javascript:alert(1)"></iframe>' })
  assert.equal(safeHTML.count, 1)
  assert.match(await editor.innerText(), /HTML 标题/)
  assert.equal(await page.locator('iframe').evaluate(element => element.contentWindow.importRan), undefined)
  // Download and import the actual backup through the UI, without overwriting originals.
  await frame.getByRole('button', { name: '更多笔记操作' }).click()
  await frame.getByRole('menuitem', { name: '导入与备份', exact: true }).click()
  const transfer = frame.getByRole('dialog', { name: '导入与备份' })
  const downloadPromise = page.waitForEvent('download')
  await transfer.getByRole('button', { name: '备份全部笔记（含图片）' }).click()
  const download = await downloadPromise, backup = JSON.parse(await readFile(await download.path(), 'utf8')), originalIds = app.ctx.notes.list().map(note => note.id)
  await transfer.getByLabel('选择文件').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  await until(async () => (await transfer.getByRole('status').innerText()).includes('文件已读取'), '读取备份文件')
  await transfer.getByRole('button', { name: '导入为新笔记', exact: true }).click()
  await until(() => app.ctx.notes.list().length === originalIds.length * 2, 'UI 恢复备份')
  assert.ok(originalIds.every(id => app.ctx.notes.list().some(note => note.id === id)))
  await transfer.getByRole('button', { name: '关闭', exact: true }).click()
  await call('notebook_open', { id: parent.id })
  // The normal delete UI promotes any children; references become explicit missing links.
  await frame.getByRole('button', { name: '更多笔记操作' }).click()
  await frame.getByRole('menuitem', { name: /删除/ }).click()
  await frame.getByRole('button', { name: '确认删除', exact: true }).click()
  await until(() => !app.ctx.notes.list().some(note => note.id === parent.id), '删除被引用页面')
  await call('notebook_open', { id: imported.ids[0] })
  assert.equal(await frame.getByRole('button', { name: /页面已不存在/ }).isDisabled(), true)
  assert.deepEqual(errors, [])
})

test('产品浏览器：五种笔记格式输入、保存和刷新保留原始内容', { skip: !enabled, timeout: 90000 }, async t => {
  const { page, app, errors } = await fixture(t)
  for (const [type, label] of [['plain', '普通笔记'], ['markdown', 'Markdown 笔记'], ['freeform', '自由页面'], ['block', '块页面'], ['blocknote', 'BlockNote 页面']]) {
    const text = type === 'markdown' ? '# 标题\n\n第一段\n\n第二段' : type + ' 正文保持'
    await create(page, label, label + '回归')
    if (type === 'plain') await page.getByRole('textbox', { name: '笔记正文' }).fill(text)
    if (type === 'markdown') await page.getByRole('textbox', { name: 'Markdown 源码' }).fill(text)
    if (type === 'freeform') { await page.getByRole('button', { name: '新建容器', exact: true }).click(); await page.locator('.free-page [contenteditable=true]').fill(text) }
    if (type === 'block') { await page.locator('.block-editor [contenteditable=true]').click(); await page.keyboard.insertText(text) }
    if (type === 'blocknote') { await page.getByLabel('BlockNote 正文', { exact: true }).click(); await page.keyboard.insertText(text) }
    await page.keyboard.press('Control+s')
    await until(() => app.ctx.notes.list().some(n => n.type === type && n.content.includes('正文保持') || n.type === 'markdown' && n.markdown === text), label + '写入')
    const saved = app.ctx.notes.list().find(n => n.type === type)
    await page.reload()
    await page.getByRole('textbox', { name: '笔记标题', exact: true }).waitFor()
    if (type === 'plain') assert.equal(await page.getByRole('textbox', { name: '笔记正文' }).inputValue(), text)
    if (type === 'markdown') assert.equal(await page.getByRole('textbox', { name: 'Markdown 源码' }).inputValue(), text)
    if (type === 'freeform') assert.equal(await page.locator('.free-page [contenteditable=true]').innerText(), text)
    if (type === 'block') assert.match(await page.locator('.block-editor [contenteditable=true]').innerText(), /block 正文保持/)
    if (type === 'blocknote') assert.match(await page.getByLabel('BlockNote 正文', { exact: true }).innerText(), /blocknote 正文保持/)
    assert.deepEqual(app.ctx.notes.list().find(n => n.id === saved.id), saved)
  }
  assert.deepEqual(errors, [])
})

test('产品浏览器：BlockNote 原生 Agent 修改、表格、选区替换、撤销隔离和图片保存', { skip: !enabled, timeout: 90000 }, async t => {
  const { page, app, url, errors } = await fixture(t)
  // A local parent speaks the same public postMessage protocol as the workbench.
  // No editor/model globals are exposed by application code for this test.
  await page.route(url + '/test-bridge', route => route.fulfill({ contentType: 'text/html', body: `
    <style>body{margin:0}iframe{width:100vw;height:100vh;border:0}</style><iframe src="/"></iframe>
    <script>
      let ready, attachment; const pending = new Map();
      window.addEventListener('message', event => {
        const m = event.data; if(m?.channel !== 'cordis-agent') return;
        if(m.type === 'ready') ready = m;
        if(m.type === 'attachment') attachment = m.attachment;
        if(m.type === 'result') { const p=pending.get(m.id); pending.delete(m.id); if(p) m.error?p.reject(Error(m.error)):p.resolve(m.result); }
      });
      const frame=document.querySelector('iframe'); frame.onload=()=>frame.contentWindow.postMessage({channel:'cordis-agent',type:'connect'},location.origin);
      const connectTimer=setInterval(()=>{ if(ready) clearInterval(connectTimer); else frame.contentWindow.postMessage({channel:'cordis-agent',type:'connect'},location.origin); },100);
      window.testReady=()=>ready?.tools.some(t=>t.name==='notebook_blocknote_edit');
      window.testAttachment=()=>attachment;
      window.testCall=(name,args)=>new Promise((resolve,reject)=>{
        const id=crypto.randomUUID(); pending.set(id,{resolve,reject});
        frame.contentWindow.postMessage({...ready,channel:'cordis-agent',type:'call',id,name,args},location.origin);
      });
    </script>` } ))
  await page.goto(url + '/test-bridge')
  await until(() => page.evaluate(() => window.testReady()), 'BlockNote 工具公开')
  const call = (name, args = {}) => page.evaluate(({ name, args }) => window.testCall(name, args), { name, args })
  await call('notebook_create', { type: 'blocknote' })
  const frame = page.frameLocator('iframe'), editor = frame.getByLabel('BlockNote 正文', { exact: true })
  await editor.click(); await page.keyboard.insertText('原始正文')
  const before = await call('notebook_blocknote_read')
  await call('notebook_blocknote_edit', { id: before.id, revision: before.revision, operations: [
    { op: 'update', blockId: before.blocks[0].id, patch: { text: 'Agent 修改后的正文' } },
    { op: 'insert', block: { type: 'checkListItem', text: '已完成任务', props: { checked: true } } },
    { op: 'insert', block: { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [{ type: 'tableCell', props: { colspan: 2, rowspan: 2 }, content: [{ type: 'text', text: '表格正文', styles: { bold: true } }] }, []] }, { cells: [[]] },
    ] } } },
  ] })
  await until(async () => {
    assert.deepEqual(errors, [])
    const failure = frame.locator('.ui-error')
    if (await failure.count()) assert.fail(await failure.innerText())
    return await editor.isVisible() && (await editor.innerText()).includes('Agent 修改后的正文')
  }, 'Agent 修改显示')
  await editor.locator('p').first().click(); await page.keyboard.press('Control+z')
  assert.ok((await editor.innerText()).includes('Agent 修改后的正文'), '不能撤销到 Agent 修改前的旧版本')
  assert.equal(await editor.locator('input[type=checkbox]').isChecked(), true)
  assert.match(await editor.locator('table').innerText(), /表格正文/)
  assert.equal(await editor.locator('td[rowspan="2"]').count(), 1)
  await editor.locator('p').first().click(); await page.keyboard.press('Home'); await page.keyboard.press('Shift+End')
  await editor.locator('p').first().click({ button: 'right' })
  await frame.getByRole('button', { name: '添加到 Chat', exact: true }).click()
  const attachment = await page.evaluate(() => window.testAttachment())
  assert.ok(attachment.text.includes('Agent'))
  await call('replace_selection', { id: attachment.id, text: '选区已替换' })
  await until(async () => (await editor.innerText()).includes('选区已替换'), '选区替换')
  await editor.locator('p').first().click(); await page.keyboard.press('End')
  await editor.evaluate(element => {
    const clipboard = new DataTransfer(), bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII='), c => c.charCodeAt(0))
    clipboard.items.add(new File([bytes], 'pixel.png', { type: 'image/png' }))
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }))
  })
  await editor.locator('img').waitFor()
  await page.keyboard.press('Control+s')
  await until(() => app.ctx.notes.list().some(n => n.document?.blocks.some(b => b.type === 'image' && b.props.url.startsWith('/api/note-assets/'))), '图片保存')
  const saved = structuredClone(app.ctx.notes.list()[0])
  await page.goto(url)
  await page.getByLabel('BlockNote 正文', { exact: true }).locator('img').waitFor()
  assert.match(await page.getByLabel('BlockNote 正文', { exact: true }).innerText(), /选区已替换/)
  assert.deepEqual(app.ctx.notes.list()[0], saved)
  assert.deepEqual(errors, [])
})

test('产品浏览器：旧块页面复制到 BlockNote，保留原件并能继续编辑', { skip: !enabled, timeout: 45000 }, async t => {
  const { page, app, errors } = await fixture(t)
  await create(page, '块页面', '旧页面')
  await page.locator('.block-editor [contenteditable=true]').click(); await page.keyboard.insertText('旧页面正文')
  await page.keyboard.press('Control+s')
  await until(() => app.ctx.notes.list()[0]?.content.includes('旧页面正文'), '原件保存')
  const original = structuredClone(app.ctx.notes.list()[0])
  await page.getByRole('button', { name: '更多笔记操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '复制为 BlockNote 页面', exact: true }).click()
  await page.getByLabel('BlockNote 正文', { exact: true }).waitFor()
  await until(() => app.ctx.notes.list().some(n => n.type === 'blocknote' && n.content.includes('旧页面正文')), '副本保存')
  assert.deepEqual(app.ctx.notes.list().find(n => n.id === original.id), original)
  assert.equal(app.ctx.notes.list().find(n => n.type === 'blocknote').title, '旧页面（BlockNote 副本）')
  assert.match(await page.getByLabel('BlockNote 正文', { exact: true }).innerText(), /旧页面正文/)
  assert.deepEqual(errors, [])
})

test('产品浏览器：普通 409 保存失败保留重试入口，恢复后正常保存', { skip: !enabled, timeout: 45000 }, async t => {
  const { page, app, errors } = await fixture(t)
  await create(page, '普通笔记', '临时错误恢复')
  let unavailable = true
  await page.route('**/api/notes/*', async route => {
    if (unavailable && route.request().method() === 'PATCH') {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: '笔记格式“plain”不可用，请启用对应格式插件' }) })
    } else await route.continue()
  })
  await page.getByRole('textbox', { name: '笔记正文' }).fill('恢复后应保存这份草稿')
  await page.keyboard.press('Control+s')
  await page.getByText('保存失败 · 草稿已保留，点击重试', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '另存为副本', exact: true }).count(), 0)
  assert.equal(await page.getByRole('textbox', { name: '笔记正文' }).inputValue(), '恢复后应保存这份草稿')
  unavailable = false
  await page.getByText('保存失败 · 草稿已保留，点击重试', { exact: true }).click()
  await until(() => app.ctx.notes.list()[0]?.content === '恢复后应保存这份草稿', '错误恢复后的重试写入')
  await page.reload()
  await page.getByRole('textbox', { name: '笔记正文' }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '笔记正文' }).inputValue(), '恢复后应保存这份草稿')
  assert.deepEqual(errors, [])
})

test('产品浏览器：循环层级草稿可见且反复刷新后仍可另存为顶层副本', { skip: !enabled, timeout: 60000 }, async t => {
  const { page, app, errors } = await fixture(t)
  await create(page, '普通笔记', '恢复目标 A')
  await create(page, '普通笔记', '父页面 B')
  await page.keyboard.press('Control+s')
  await until(() => app.ctx.notes.list().some(note => note.title === '父页面 B'), 'B 页保存')
  const a = app.ctx.notes.list().find(note => note.title === '恢复目标 A'), b = app.ctx.notes.list().find(note => note.title === '父页面 B')
  await page.locator('.note-card').filter({ hasText: '恢复目标 A' }).click()
  await page.route('**/api/notes/' + a.id, route => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: '模拟网络保存失败' }) }) : route.continue())
  await page.getByRole('textbox', { name: '笔记正文', exact: true }).fill('未保存的 A 正文')
  await page.getByRole('button', { name: '更多笔记操作' }).click()
  await page.getByRole('menuitem', { name: '页面关系', exact: true }).click()
  const relations = page.getByRole('dialog', { name: '页面关系', exact: true })
  await relations.getByLabel('父页面', { exact: true }).selectOption(b.id)
  await until(async () => (await page.locator('.save-status').innerText()).includes('保存失败'), '草稿保留')
  await relations.getByRole('button', { name: '关闭', exact: true }).click()
  // The other tab changes B while A still has the unsaved A -> B edge.
  await app.ctx.notes.update(b.id, { parentId: a.id })
  const serverNotes = app.ctx.notes.list()
  await page.reload()
  await page.getByRole('alert').filter({ hasText: '草稿的父页面关系已失效' }).waitFor()
  assert.equal(await page.locator('.note-card').count(), 2)
  assert.equal(await page.getByRole('textbox', { name: '笔记正文', exact: true }).inputValue(), '未保存的 A 正文')
  await page.getByRole('textbox', { name: '笔记正文', exact: true }).fill('继续补充的 A 正文')
  await page.reload()
  await page.getByRole('alert').filter({ hasText: '草稿的父页面关系已失效' }).waitFor()
  await page.getByRole('button', { name: '另存为副本', exact: true }).click()
  await until(() => app.ctx.notes.list().length === 3, '层级草稿恢复成副本')
  const copy = app.ctx.notes.list().find(note => !serverNotes.some(original => original.id === note.id))
  assert.equal(copy.content, '继续补充的 A 正文')
  assert.equal(copy.parentId, null)
  assert.deepEqual(app.ctx.notes.list().filter(note => note.id !== copy.id), serverNotes)
  assert.deepEqual(errors, [])
})

test('产品浏览器：两页冲突有提示、刷新保留草稿、另存副本不覆盖原笔记', { skip: !enabled, timeout: 60000 }, async t => {
  const { page: a, app, browser, url, errors } = await fixture(t)
  await create(a, '普通笔记', '两页冲突')
  await a.getByRole('textbox', { name: '笔记正文' }).fill('原正文'); await a.keyboard.press('Control+s')
  await until(() => app.ctx.notes.list()[0]?.content === '原正文', '原正文保存')
  const b = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); await b.goto(url)
  await b.getByRole('textbox', { name: '笔记标题', exact: true }).waitFor()
  await a.getByRole('textbox', { name: '笔记正文' }).fill('A 页新正文'); await a.keyboard.press('Control+s')
  await until(() => app.ctx.notes.list()[0]?.content === 'A 页新正文', 'A 保存')
  await b.getByRole('textbox', { name: '笔记标题', exact: true }).fill('B 页草稿'); await b.keyboard.press('Control+s')
  await b.getByRole('button', { name: '另存为副本', exact: true }).waitFor()
  await b.reload()
  await b.getByRole('button', { name: '另存为副本', exact: true }).waitFor()
  assert.equal(await b.getByRole('textbox', { name: '笔记正文' }).inputValue(), '原正文')
  await b.getByRole('button', { name: '另存为副本', exact: true }).click()
  await until(() => app.ctx.notes.list().length === 2, '副本保存')
  assert.ok(app.ctx.notes.list().some(n => n.title === '两页冲突' && n.content === 'A 页新正文'))
  assert.ok(app.ctx.notes.list().some(n => n.title === 'B 页草稿（副本）' && n.content === '原正文'))
  assert.deepEqual(errors, [])
})

test('产品浏览器：块页面图片上传、HTML 粘贴和撤销后保存刷新', { skip: !enabled, timeout: 60000 }, async t => {
  const { page, app, errors } = await fixture(t)
  await create(page, '块页面', '图片粘贴回归')
  const editor = page.locator('.block-editor [contenteditable=true]')
  await editor.click(); await page.keyboard.insertText('图片父块')
  // Exercise a real browser ClipboardEvent with a local image payload.
  await editor.evaluate(element => {
    const clipboard = new DataTransfer(), bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII='), c => c.charCodeAt(0))
    clipboard.items.add(new File([bytes], 'pixel.png', { type: 'image/png' }))
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }))
  })
  const image = editor.locator('img'); await image.waitFor()
  const source = await image.getAttribute('src')
  assert.match(source, /^\/api\/note-assets\//)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await editor.press('Control+a'); await editor.press('Control+c')
  await editor.locator('p').first().click(); await page.keyboard.press('End'); await page.keyboard.insertText('粘贴位置'); await page.keyboard.press('Control+v')
  await until(async () => await editor.locator('img').count() === 2, 'HTML 图片粘贴')
  await page.keyboard.press('Control+z'); await until(async () => await editor.locator('img').count() === 1, '撤销')
  await page.keyboard.press('Control+Shift+z'); await until(async () => await editor.locator('img').count() === 2, '重做')
  await page.keyboard.press('Control+s')
  await until(() => (JSON.stringify(app.ctx.notes.list()[0]?.document).match(/"kind":"image"/g) || []).length === 2, '图片落盘')
  await page.reload(); await page.locator('.block-editor [contenteditable=true] img').first().waitFor()
  assert.equal(await page.locator('.block-editor [contenteditable=true] img').count(), 2)
  assert.deepEqual(errors, [])
})

test('产品浏览器：笔记开发模式热更新保存草稿，插件停用/启用后数据仍可编辑', { skip: !enabled, timeout: 90000 }, async t => {
  // Copy sources only into an isolated fixture; never edit the user's active checkout.
  const dir = await mkdtemp(resolve('product-dev-test-')), apps = join(dir, 'applications')
  let dev, browser
  const cacheDir = resolve('node_modules/.vite', basename(dir))
  t.after(async () => { await browser?.close(); await dev?.close(); await rm(dir, { recursive: true, force: true }); await rm(cacheDir, { recursive: true, force: true }) })
  await mkdir(apps)
  await cp(resolve('applications/notebook'), join(apps, 'notebook'), { recursive: true, filter: path => !path.split(/[\\/]/).some(part => ['node_modules', 'dist'].includes(part)) })
  for (const plugin of await readdir(join(apps, 'notebook/plugins'))) {
    const dependencies = resolve('applications/notebook/plugins', plugin, 'node_modules')
    if (await stat(dependencies).then(() => true, () => false)) await symlink(dependencies, join(apps, 'notebook/plugins', plugin, 'node_modules'), 'junction')
  }
  dev = await startDevelopment({ port: 0, applicationsDir: apps, initialApplication: 'notebook', dataDir: join(dir, 'data'), cacheDir })
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') t.diagnostic(message.text().slice(0,1500)) })
  page.on('requestfailed', request => t.diagnostic(request.url() + ': ' + request.failure()?.errorText))
  const url = 'http://127.0.0.1:' + dev.vite.httpServer.address().port
  await page.goto(url); await create(page, '普通笔记', '热更新回归')
  await page.getByRole('textbox', { name: '笔记正文' }).fill('热更新前未保存的内容')
  const source = join(apps, 'notebook/plugins/editor/view.jsx')
  await writeFile(source, (await readFile(source, 'utf8')).replace('写下此刻的想法…', '热更新已生效'))
  await page.getByPlaceholder('热更新已生效').waitFor({ timeout: 30000 })
  assert.equal(await page.getByRole('textbox', { name: '笔记正文' }).inputValue(), '热更新前未保存的内容')
  const state = await (await fetch(url + '/api/plugins')).json()
  async function toggle(enabled) {
    const response = await fetch(url + '/api/plugins/editor/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Application-Session': state.application.session }, body: JSON.stringify({ enabled }) })
    assert.equal(response.ok, true)
  }
  await toggle(false); await page.getByRole('textbox', { name: '笔记正文' }).waitFor({ state: 'detached' })
  await toggle(true); await page.getByRole('textbox', { name: '笔记正文' }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '笔记正文' }).inputValue(), '热更新前未保存的内容')
  assert.deepEqual(errors, [])
})
