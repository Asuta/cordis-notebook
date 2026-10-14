import { openConversationStore } from '../workbench/conversation-store.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { BrowserVerification } from '../workbench/browser-verification.js'
import { browserToolResult, browserGuidance } from '../workbench/browser-tools.js'
import { createWorkbench } from '../workbench/server.js'
import { browserSchemas, validateBrowserInput } from '../workbench/browser-contract.js'
import { Value } from '@sinclair/typebox/value'

test('浏览器参数按操作和断言类型校验，拒绝缺失目标、混合定位及调用者指定错误分类', () => {
  for (const input of [
    { action: 'press', value: 'Escape' },
    { action: 'assert', target: { css: 'body' } },
    { action: 'assert', assertion: 'visible', target: { css: 'body' }, expected: 'true' },
    { action: 'assert', assertion: 'disabled', target: { css: 'button' }, expected: 'true' },
    { action: 'assert', assertion: 'placeholder', target: { css: 'input' }, expected: false },
    { action: 'click', target: { css: 'button', text: '保存' } },
    { action: 'inspect', target: { css: 'body' }, script: 'document.body.remove()' },
    { action: 'click', target: { css: 'button' }, errorKind: 'usage' },
    { action: 'assert', target: { testId: 'counter', css: 'span' }, expected: '1' },
    { action: 'assert', target: { testId: 'counter' }, expected: '1', timeoutMs: 10001 },
  ]) {
    assert.equal(Value.Check(browserSchemas.browser_action, input), false, JSON.stringify(input))
    assert.throws(() => validateBrowserInput('browser_action', input), error => error.kind === 'usage')
  }
  for (const input of [
    { action: 'press', target: { label: '正文' }, value: 'Escape' },
    { action: 'assert', target: { css: 'body' }, expected: '文字' },
    { action: 'assert', assertion: 'value', target: { label: '正文' }, expected: '' },
    { action: 'assert', assertion: 'placeholder', target: { label: '正文' }, expected: '请输入' },
    { action: 'assert', assertion: 'visible', target: { css: '#hidden' }, expected: false },
    { action: 'assert', assertion: 'disabled', target: { role: 'menuitem', name: '操作' }, expected: true },
    { action: 'inspect', target: { role: 'button', name: '保存' } },
    { action: 'assert', target: { testId: 'counter' }, expected: '1', timeoutMs: 0 },
  ]) {
    assert.equal(Value.Check(browserSchemas.browser_action, input), true, JSON.stringify(input))
    validateBrowserInput('browser_action', input)
  }
})

test('参数错误不启动浏览器，缺少验收证据标记未完成并保留调用记录', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-browser-usage-'))
  const v = new BrowserVerification({ root: resolve('.'), appId: 'notebook', dataDir: dir })
  t.after(async () => { await v.close(); await rm(dir, { recursive: true, force: true }) })
  await assert.rejects(v.run('browser_action', { action: 'press', value: 'Escape' }), /调用参数错误/)
  assert.equal(v.child, undefined); assert.equal(v.directory, undefined)
  const unopened = await v.run('browser_report', {})
  assert.equal(unopened.steps.length, 1); assert.equal(unopened.reportTool, 'browser_report')
  assert.equal(v.child, undefined); assert.equal(v.directory, undefined)
  assert.equal(v.report.steps[0].errorKind, 'usage')
  const report = await v.run('browser_finish', { result: 'passed', summary: '尚未完成实际检查' })
  assert.equal(report.status, 'incomplete'); assert.equal(report.gaps.length, 2)
  assert.equal(report.steps.length, 1); assert.deepEqual(report.errors, [])
  assert.deepEqual(await v.run('browser_report', {}), report)
})

test('验收插件入口要求已打开的隔离实例，且拒绝脚本、外部地址和停用参数', async t => {
  for (const args of [{ id: 'counter', url: 'http://localhost:3210' }, { id: '../counter' }, { id: 'counter', enable: false }]) {
    assert.throws(() => validateBrowserInput('browser_plugin', args), /调用参数错误/)
  }
  const dir = await mkdtemp(join(tmpdir(), 'cordis-browser-plugin-'))
  const v = new BrowserVerification({ root: resolve('.'), appId: 'notebook', dataDir: dir })
  t.after(async () => { await v.close(); await rm(dir, { recursive: true, force: true }) })
  await assert.rejects(v.run('browser_plugin', { id: 'counter', enable: true }), /请先 browser_open/)
  assert.equal(v.child, undefined)
  assert.equal(v.directory, undefined)
})

test('截图作为图片内容传给模型，不在文字工具结果中塞入 base64', () => {
  const result = browserToolResult({ snapshot: '页面', image: { type: 'image', mimeType: 'image/jpeg', data: 'image-bytes' } })
  assert.equal(result.content[1].type, 'image')
  assert.doesNotMatch(result.content[0].text, /image-bytes/)
  assert.match(browserGuidance(false), /用户关闭.*不要运行浏览器测试/)
})

test('批量操作预校验全部参数，顺序执行失败即停并保留现场；独立复测不覆盖原报告', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-browser-batch-')), workerFile = join(dir, 'worker.cjs')
  await writeFile(workerFile, `let count=0; const checks=[]; process.on('message', m => {
    if(m.type==='close') process.exit(0);
    if(m.method==='finish') { process.send({id:m.id,result:{checks,errors:[]}}); return; }
    if(m.input?.target?.css==='#bad') {
      checks.push({passed:false}); process.send({id:m.id,error:'真实断言失败',errorKind:'assertion',checks,errors:[]}); return;
    }
    if(m.input?.action==='click') count++;
    if(m.input?.action==='assert') checks.push({passed:true});
    process.send({id:m.id,result:{checks,errors:[],snapshot:'计数 '+count,...(m.method==='open' || m.input?.action==='screenshot' ? {image:{type:'image',mimeType:'image/jpeg',data:'eA=='}} : {})}});
  })`)
  const v = new BrowserVerification({ root: resolve('.'), appId: 'notebook', dataDir: dir, workerFile })
  t.after(async () => { await v.close(); await rm(dir, { recursive: true, force: true }) })
  await assert.rejects(v.run('browser_retest', { reason: '尚未开始' }), /已开始/)
  await v.run('browser_open')
  const click = { action: 'click', target: { css: '#button' } }
  await assert.rejects(v.run('browser_batch', { steps: [click, { action: 'press', value: 'Escape' }] }), /调用参数错误/)
  assert.equal((await v.run('browser_action', { action: 'snapshot' })).snapshot, '计数 0', '参数错误整批零执行')
  await assert.rejects(v.run('browser_batch', { steps: Array(13).fill(click) }), /调用参数错误/)
  const result = await v.run('browser_batch', { steps: [click, { action: 'assert', target: { css: '#bad' }, expected: 'ok' }, click] })
  assert.equal(result.ok, false); assert.equal(result.completed, 1); assert.equal(result.stoppedAt, 2)
  assert.match(result.failure.snapshot, /计数 1/)
  assert.equal(v.report.steps.filter(step => step.batchId === result.batchId).length, 2)
  const old = await v.run('browser_finish', { result: 'passed', summary: '后续不执行' })
  assert.equal(old.status, 'failed')
  const oldFile = join(dir, 'browser', old.id, 'report.json'), oldBytes = await readFile(oldFile, 'utf8')
  await assert.rejects(v.run('browser_retest', { reason: '   ' }), /调用参数错误/)
  assert.equal(await readFile(oldFile, 'utf8'), oldBytes, '无效复测参数不能修改已结束的原始报告')
  const fresh = await v.run('browser_retest', { reason: '修复正文来源后复测' })
  assert.notEqual(fresh.report.id, old.id); assert.match(fresh.snapshot, /计数 0/)
  const batch = await v.run('browser_batch', { steps: [click,
    { action: 'assert', target: { css: '#button' }, expected: '计数 1' }, { action: 'screenshot' }] })
  assert.equal(batch.ok, true); assert.equal(batch.completed, 3); assert.equal(batch.image.type, 'image')
  const tool = browserToolResult(batch)
  assert.equal(tool.content.filter(item => item.type === 'image').length, 1)
  assert.doesNotMatch(tool.content[0].text, /eA==/)
  const final = await v.run('browser_finish', { result: 'passed', summary: '新实例顺序操作通过' })
  assert.equal(final.status, 'passed'); assert.equal(final.previousAttemptId, old.id)
  assert.equal(final.previousAttempts[0].status, 'failed'); assert.equal(final.previousAttempts[0].checks[0].passed, false)
  assert.equal(final.checks.length, 1); assert.equal(final.checks[0].passed, true)
  assert.equal(await readFile(oldFile, 'utf8'), oldBytes, '原始报告字节不变')
  const saved = JSON.parse(await readFile(join(dir, 'browser', final.id, 'report.json'), 'utf8'))
  assert.equal(saved.previousAttempts[0].reportUrl, old.reportUrl)
  await assert.rejects(v.run('browser_retest', { reason: '已通过不重复' }), /失败或未完成/)
  const wb = await createWorkbench({ root: resolve('.'), port: 0, appPort: 0, autoStart: false, dataDir: dir })
  await wb.close()
  const historyStore = await openConversationStore(dir)
  historyStore.mark({ id: 'history', appId: 'notebook', messages: [], turns: [{ id: 'turn', events: [], browserVerification: final }] }); await historyStore.flush()
  const restored = await createWorkbench({ root: resolve('.'), port: 0, appPort: 0, autoStart: false, dataDir: dir })
  try {
    const base = 'http://127.0.0.1:' + restored.server.address().port
    assert.equal((await (await fetch(base + old.reportUrl)).json()).status, 'failed')
    assert.equal((await fetch(base + old.screenshots[0].url)).status, 200)
    assert.equal((await (await fetch(base + final.reportUrl)).json()).status, 'passed')
  } finally { await restored.close() }
})

test('批量操作遇到页面错误立即停止，取消后的验收不能开启复测', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-browser-page-batch-')), workerFile = join(dir, 'worker.cjs')
  await writeFile(workerFile, `process.on('message', m => {
    if(m.type==='close') process.exit(0);
    process.send({id:m.id,result:{checks:[],errors:m.method==='open'?[]:['页面错误'],snapshot:'错误现场'}});
  })`)
  const controller = new AbortController(), v = new BrowserVerification({ root: resolve('.'), appId: 'notebook', dataDir: dir, workerFile, signal: controller.signal })
  t.after(async () => { await v.close(); await rm(dir, { recursive: true, force: true }) })
  await v.run('browser_open')
  const result = await v.run('browser_batch', { steps: [{ action: 'snapshot' }, { action: 'screenshot' }] })
  assert.equal(result.stoppedAt, 1); assert.equal(result.failure.errorKind, 'page')
  assert.equal(v.report.steps.filter(step => step.batchId).length, 1)
  controller.abort(); await v.close('stopped')
  await assert.rejects(v.run('browser_retest', { reason: '取消后重试' }), /停止/)
})

test('每轮开关固定，偏好随会话保存，新会话默认关闭，关闭时后端拒绝且不启动实例', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-browser-policy-')), workerFile = join(dir, 'worker.cjs')
  await writeFile(workerFile, `process.send({type:'ready'}); process.on('message', m => {
    if (m.type === 'run') setTimeout(() => {process.send({type:'assistant', text:String(m.task.browserVerificationEnabled)}); process.send({type:'done'});}, 150);
  })`)
  await writeFile(join(dir, 'config.json'), JSON.stringify({ apiKey: 'test-key' }))
  let starts = 0
  const wb = await createWorkbench({ root: resolve('.'), port: 0, appPort: 0, autoStart: false, dataDir: dir, workerFile,
    browserFactory: () => { starts++; throw Error('不应启动') } })
  t.after(async () => { await wb.close(); await rm(dir, { recursive: true, force: true }) })
  const base = 'http://127.0.0.1:' + wb.server.address().port
  const request = async (path, input) => {
    const response = await fetch(base + '/api/' + path, input === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    assert.equal(response.status, 200); return response.json()
  }
  const untilDone = async () => {
    for (let i = 0; i < 100; i++) { const state = await request('state'); if (!state.activeThreadId) return state; await new Promise(resolve => setTimeout(resolve, 30)) }
    assert.fail('会话未结束')
  }
  const first = await request('run', { appId: 'notebook', prompt: '默认关闭' }); await untilDone()
  assert.equal(first.browserVerificationEnabled, false); assert.equal(first.turns[0].browserVerification.status, 'disabled')
  await assert.rejects(wb.execute({ turn: { browserVerificationEnabled: false } }, 'browser_open', {}), /用户关闭/)
  await assert.rejects(wb.execute({ turn: { browserVerificationEnabled: false } }, 'browser_plugin', { id: 'counter', enable: true }), /用户关闭/)
  assert.equal(starts, 0)
  await request('thread-preferences', { threadId: first.id, browserVerificationEnabled: true })
  const second = await request('run', { appId: 'notebook', threadId: first.id, prompt: '继承开启' })
  await request('thread-preferences', { threadId: first.id, browserVerificationEnabled: false })
  const finished = (await untilDone()).threads.find(item => item.id === first.id)
  assert.equal(second.turns[1].browserVerificationEnabled, true)
  assert.equal(finished.turns[1].browserVerification.status, 'not-run')
  assert.equal(finished.messages.at(-1).text, 'true')
  assert.equal(finished.browserVerificationEnabled, false)
  const fresh = await request('run', { appId: 'notebook', prompt: '新会话' }); await untilDone()
  assert.equal(fresh.browserVerificationEnabled, false)
  const saved = (await openConversationStore(dir)).conversations
  assert.equal(saved.find(item => item.id === first.id).browserVerificationEnabled, false)
})

test('验收失败不能改口通过，未调用不创建目录，停止会终止卡住的操作', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-browser-lifecycle-')), workerFile = join(dir, 'worker.cjs')
  await writeFile(workerFile, `process.on('message', m => {
    if(m.type==='close') process.exit(0);
    if(m.input?.target?.css==='#hang') return;
    if(m.input?.target?.css==='#bad') process.send({id:m.id,error:'断言失败',errorKind:'assertion'});
    else process.send({id:m.id,result:{checks:[{passed:true}],errors:[],image:{type:'image',mimeType:'image/jpeg',data:'eA=='}}});
  })`)
  t.after(() => rm(dir, { recursive: true, force: true }))
  const unused = new BrowserVerification({ root: resolve('.'), appId: 'notebook', dataDir: dir, workerFile })
  await unused.close(); await assert.rejects(readFile(join(dir, 'browser', unused.report.id, 'report.json')), { code: 'ENOENT' })
  const v = new BrowserVerification({ root: resolve('.'), appId: 'notebook', dataDir: dir, workerFile })
  t.after(() => v.close())
  await v.run('browser_open')
  await assert.rejects(v.run('browser_action', { action: 'click', target: { css: '#bad' } }), /断言失败/)
  await v.run('browser_action', { action: 'snapshot' })
  const report = await v.run('browser_finish', { result: 'passed', summary: '后续成功仍保留首次失败' })
  assert.equal(report.status, 'failed'); assert.ok(report.steps.some(step => step.error))
  assert.equal(v.child, null)
  const controller = new AbortController(), stopped = new BrowserVerification({ root: resolve('.'), appId: 'notebook', dataDir: dir, workerFile, signal: controller.signal })
  await stopped.run('browser_open')
  const hanging = stopped.run('browser_action', { action: 'click', target: { css: '#hang' } }); const rejected = assert.rejects(hanging, /退出|停止/)
  controller.abort(); await stopped.close('stopped'); await rejected
  assert.equal(stopped.report.status, 'stopped'); assert.equal(stopped.child, null)
})

for (const scenario of ['late-error', 'finish-exit']) test('结束验收必须读取最终状态：' + scenario, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-browser-final-')), workerFile = join(dir, 'worker.cjs')
  await writeFile(workerFile, `const errors = []; process.on('message', m => {
    if(m.type === 'close') process.exit(0);
    if(m.method === 'finish') {
      if(${JSON.stringify(scenario)} === 'finish-exit') process.exit(1);
      process.send({id:m.id,result:{checks:[{passed:true}],errors}}); return;
    }
    process.send({id:m.id,result:{checks:[{passed:true}],errors:[],image:{type:'image',mimeType:'image/jpeg',data:'eA=='}}});
    if(m.method === 'action') errors.push('最后一次操作之后发生的页面错误');
  })`)
  const v = new BrowserVerification({ root: resolve('.'), appId: 'notebook', dataDir: dir, workerFile })
  t.after(async () => { await v.close(); await rm(dir, { recursive: true, force: true }) })
  await v.run('browser_open')
  await v.run('browser_action', { action: 'assert', target: { css: 'body' }, expected: '就绪' })
  assert.deepEqual(v.report.errors, [], '上一次操作的快照没有最终错误')
  const report = await v.run('browser_finish', { result: 'passed', summary: '检查页面' })
  assert.equal(report.status, 'failed')
  assert.match(report.errors.join('\n'), scenario === 'late-error' ? /最后一次操作之后/ : /最终验收状态/)
  const saved = JSON.parse(await readFile(join(dir, 'browser', report.id, 'report.json'), 'utf8'))
  assert.equal(saved.status, 'failed'); assert.deepEqual(saved.errors, report.errors)
  assert.equal(v.child, null)
})

test('工作台重启把未完成的验收记录标记停止，报告文件与页面状态一致', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-browser-recovery-')), id = '00000000-0000-0000-0000-000000000002'
  const report = { id, status: 'running', steps: [], errors: [], screenshots: [] }
  await mkdir(join(dir, 'browser', id), { recursive: true })
  await writeFile(join(dir, 'browser', id, 'report.json'), JSON.stringify(report))
  await writeFile(join(dir, 'conversations.json'), JSON.stringify([{ id: 'thread', appId: 'notebook', title: '中断', running: true, messages: [], turns: [{ id: 'turn', status: 'running', events: [], browserVerification: report }] }]))
  const wb = await createWorkbench({ root: resolve('.'), port: 0, appPort: 0, autoStart: false, dataDir: dir })
  t.after(async () => { await wb.close(); await rm(dir, { recursive: true, force: true }) })
  const base = 'http://127.0.0.1:' + wb.server.address().port
  const state = await (await fetch(base + '/api/state')).json()
  assert.equal(state.threads[0].turns[0].browserVerification.status, 'stopped')
  const saved = await (await fetch(base + `/api/browser-artifacts/${id}/report.json`)).json()
  assert.equal(saved.status, 'stopped'); assert.match(saved.errors[0], /中断/)
  assert.equal((await fetch(base + '/api/browser-artifacts/00000000-0000-0000-0000-000000000003/report.json')).status, 404)
})

test('真实浏览器使用独立应用数据，执行交互断言、截图、批量操作和修复后独立复测', { skip: process.env.CORDIS_BROWSER_TEST !== '1', timeout: 120000 }, async t => {
  const root = await mkdtemp(resolve('browser-test-')), folder = join(root, 'applications/sample/plugins/counter')
  await mkdir(folder, { recursive: true })
  await writeFile(join(root, 'applications/sample/package.json'), JSON.stringify({ cordisApp: { id: 'sample', name: '浏览器验收测试' } }))
  await writeFile(join(folder, 'package.json'), JSON.stringify({ name: '@test/counter', type: 'module', version: '1.0.0', cordis: {
    schemaVersion: 1, id: 'counter', name: '计数器', defaultEnabled: false, client: 'client.js', requires: { server: [], client: [] }, provides: { server: [], client: [] },
    public: ['client.js'], build: [{ type: 'bundle', input: 'client.js', output: 'client.js', platform: 'browser' }],
  } }))
  await writeFile(join(folder, 'client.js'), `export default (ctx, sdk) => {
    const box=document.createElement('section');box.id='test-counter';box.style.backgroundColor='rgb(240, 245, 250)';
    const button=document.createElement('button');let count=0;button.textContent='计数 0';button.onclick=()=>button.textContent='计数 '+ ++count;
    const input=document.createElement('textarea');input.setAttribute('aria-label','笔记正文');input.placeholder='写下此刻的想法…';
    input.style.cssText='color:rgb(11,22,33);background:transparent;font-size:16px';
    const status=sdk.el('span',{'data-testid':'async-status'},'旧笔记 4 段');
    const hiding=sdk.el('span',{'data-testid':'async-hiding'},'等待隐藏');
    const trigger=sdk.el('button',{'data-testid':'async-update'},'异步更新');
    let timer;trigger.onclick=()=>{status.textContent='旧笔记 4 段';input.value='';input.placeholder='等待';hiding.hidden=false;
      box.querySelector('[data-testid="async-created"]')?.remove();timer=setTimeout(()=>{
      status.textContent='新笔记 1 段';input.value='异步正文';input.placeholder='新占位符';hiding.hidden=true;
      box.append(sdk.el('span',{'data-testid':'async-created'},'新建完成'));
    },250)};
    box.append(button,input,status,hiding,trigger);document.body.append(box);ctx.effect(()=>()=>{clearTimeout(timer);box.remove()})
  }`)
  const brokenFolder = join(root, 'applications/sample/plugins/broken')
  await mkdir(brokenFolder)
  const brokenManifest = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'))
  brokenManifest.name = '@test/broken'; brokenManifest.cordis.id = 'broken'; brokenManifest.cordis.name = '失败插件'
  await writeFile(join(brokenFolder, 'package.json'), JSON.stringify(brokenManifest))
  await writeFile(join(brokenFolder, 'client.js'), "export default () => { throw Error('验收前端启动失败') }")
  const v = new BrowserVerification({ root, appId: 'sample', dataDir: join(root, 'reports') })
  t.after(async () => { await v.close(); assert.ok(root.startsWith(resolve('browser-test-'))); await rm(root, { recursive: true, force: true }) })
  const opened = await v.run('browser_open')
  assert.equal(opened.instance.scope, 'verification'); assert.equal(opened.instance.appId, 'sample')
  const disabled = await v.run('browser_plugin', { id: 'counter' })
  assert.equal(disabled.enabled, false); assert.equal(disabled.running, false)
  const enabled = await v.run('browser_plugin', { id: 'counter', enable: true })
  assert.equal(enabled.running, true); assert.equal(enabled.verification.client, true)
  assert.equal(v.report.checks.length, 0, '启用只是验收准备，不冒充功能断言')
  assert.equal((await v.run('browser_plugin', { id: 'counter', enable: true })).running, true)
  assert.equal(opened.image.type, 'image')
  assert.ok((await v.run('browser_action', { action: 'snapshot' })).targets.some(item => item.target.testId === 'async-update'))
  assert.equal(opened.report.steps, undefined, '普通返回不包含累计完整报告')
  await assert.rejects(v.run('browser_action', { action: 'press', value: 'Escape' }), /调用参数错误/)
  const input = { label: '笔记正文' }
  await v.run('browser_action', { action: 'assert', target: input, assertion: 'value', expected: '' })
  await v.run('browser_action', { action: 'assert', target: input, assertion: 'placeholder', expected: '写下此刻的想法…' })
  await v.run('browser_action', { action: 'fill', target: input, value: '实际输入内容' })
  await v.run('browser_action', { action: 'press', target: input, value: 'End' })
  const inspected = await v.run('browser_action', { action: 'inspect', target: input })
  assert.equal(inspected.element.value, '实际输入内容'); assert.equal(inspected.element.text, '')
  assert.equal(inspected.element.placeholder, '写下此刻的想法…')
  assert.equal(inspected.element.visible, true); assert.ok(inspected.element.rect.width > 0)
  assert.equal(inspected.element.styles.color, 'rgb(11, 22, 33)')
  assert.equal(inspected.element.styles['background-color'], 'rgba(0, 0, 0, 0)')
  assert.equal(inspected.element.backgrounds[0].color, 'rgb(240, 245, 250)')
  assert.equal(inspected.snapshot, undefined); assert.deepEqual(inspected.checks, [])
  assert.equal(inspected.report.usageErrors, 1)
  const valueCheck = await v.run('browser_action', { action: 'assert', target: input, assertion: 'value', expected: '实际输入内容' })
  assert.equal(valueCheck.checks.length, 1, '只返回本次新增断言')
  await v.run('browser_action', { action: 'assert', target: input, assertion: 'visible', expected: true })
  await v.run('browser_action', { action: 'assert', target: { css: '#absent' }, assertion: 'visible', expected: false })
  const result = await v.run('browser_action', { action: 'click', target: { role: 'button', name: '计数 0' } })
  assert.equal(result.ok, true); assert.equal(result.snapshot, undefined)
  const snapshot = await v.run('browser_action', { action: 'snapshot' })
  assert.match(snapshot.snapshot, /计数 1/)
  await v.run('browser_action', { action: 'assert', target: { role: 'button', name: '计数 1' }, expected: '计数 1' })
  const delayed = await v.run('browser_batch', { steps: [
    { action: 'click', target: { testId: 'async-update' } },
    { action: 'assert', target: { testId: 'async-status' }, expected: '新笔记 1 段' },
    { action: 'click', target: { testId: 'async-update' } },
    { action: 'assert', target: input, assertion: 'value', expected: '异步正文' },
    { action: 'click', target: { testId: 'async-update' } },
    { action: 'assert', target: input, assertion: 'placeholder', expected: '新占位符' },
    { action: 'click', target: { testId: 'async-update' } },
    { action: 'assert', target: { testId: 'async-hiding' }, assertion: 'visible', expected: false },
    { action: 'click', target: { testId: 'async-update' } },
    { action: 'assert', target: { testId: 'async-created' }, expected: '新建完成' },
  ] })
  assert.equal(delayed.ok, true, JSON.stringify(delayed.failure))
  assert.ok(delayed.results[1].checks[0].elapsedMs > 0)
  assert.equal(delayed.results[1].checks.length, 1, '等待中的旧值不产生失败断言')
  await v.run('browser_action', { action: 'screenshot' })
  const report = await v.run('browser_finish', { result: 'passed', summary: '按钮点击后计数增加' })
  assert.equal(report.status, 'passed', JSON.stringify(report.errors))
  assert.equal(report.steps.filter(step => step.errorKind === 'usage').length, 1, '通过仍保留已修正的参数错误')
  assert.equal(report.checks.length, 11)
  assert.equal(report.screenshots.length, 2)
  assert.equal((await readFile(join(root, 'reports/browser', report.id, '1.jpg')))[0], 0xff)
  await assert.rejects(fetch(opened.url, { signal: AbortSignal.timeout(1000) }))
  const failed = new BrowserVerification({ root, appId: 'sample', dataDir: join(root, 'reports') })
  try {
    await failed.run('browser_open')
    assert.equal((await failed.run('browser_plugin', { id: 'counter' })).enabled, false, '上一个验收的开关不泄漏到新实例')
    await failed.run('browser_plugin', { id: 'counter', enable: true })
    await assert.rejects(failed.run('browser_action', { action: 'assert', target: input, assertion: 'text', expected: '写下此刻的想法…', timeoutMs: 100 }), /页面断言失败/)
    await failed.run('browser_action', { action: 'assert', target: input, assertion: 'placeholder', expected: '写下此刻的想法…' })
    await assert.rejects(failed.run('browser_action', { action: 'click', target: { role: 'button', name: '不存在' } }), error => {
      assert.match(error.message, /实际匹配 0/); assert.match(error.message, /browser_report/)
      assert.equal(error.diagnostics.matchCount, 0)
      assert.ok(error.diagnostics.candidates.some(candidate => candidate.text === '计数 0'))
      return true
    })
    await assert.rejects(failed.run('browser_action', { action: 'click', target: { css: '#test-counter > button:not([data-testid]),#test-counter > textarea' } }), error => {
      assert.equal(error.diagnostics.matchCount, 2); assert.equal(error.diagnostics.candidates.length, 2); return true
    })
    const current = await failed.run('browser_report', {})
    assert.equal(current.steps.at(-1).diagnostics.matchCount, 2)
    assert.equal(failed.progress().operationErrors, 2); assert.equal(failed.progress().failedChecks, 1)
    await assert.rejects(failed.run('browser_action', { action: 'assert', target: { css: '#test-counter > span' }, expected: '旧笔记', timeoutMs: 0 }), /定位需要唯一元素/)
    await assert.rejects(failed.run('browser_action', { action: 'assert', target: { css: '#test-counter' }, assertion: 'value', expected: '' }), /调用参数错误/)
    assert.equal(failed.report.checks.length, 3, '重复匹配保留失败，控件类型误用不产生功能断言')
    assert.equal(failed.report.checks[0].timeoutMs, 100)
    assert.equal(failed.report.checks[0].actual, '')
    assert.ok(failed.report.checks[0].elapsedMs >= 100)
    await assert.rejects(failed.run('browser_plugin', { id: 'broken', enable: true }), error => {
      assert.equal(error.diagnostics.enabled, true)
      assert.equal(error.diagnostics.running, false)
      assert.equal(error.diagnostics.clientState, 'failed')
      return true
    })
    const broken = await failed.run('browser_plugin', { id: 'broken' })
    assert.equal(broken.running, false, '失败的前端不能因后端 enabled=true 被误报成功')
    const final = await failed.run('browser_finish', { result: 'passed', summary: '成功检查不能掩盖真实失败' })
    assert.equal(final.status, 'failed')
    assert.equal(final.checks[0].passed, false); assert.equal(final.checks[1].passed, true)
    assert.ok(final.steps.some(step => step.errorKind === 'assertion'))
    assert.ok(final.steps.some(step => step.errorKind === 'operation'))
    const original = await readFile(join(root, 'reports/browser', final.id, 'report.json'), 'utf8')
    // The fresh worker must load repaired source and begin from empty state.
    await writeFile(join(folder, 'client.js'), (await readFile(join(folder, 'client.js'), 'utf8')).replace("'计数 '+ ++count", "'计数 '+ (count += 2)"))
    const retest = await failed.run('browser_retest', { reason: '修复计数增量为 2 后独立复测' })
    assert.notEqual(retest.report.id, final.id)
    assert.equal((await failed.run('browser_plugin', { id: 'counter' })).enabled, false)
    await failed.run('browser_plugin', { id: 'counter', enable: true })
    const batch = await failed.run('browser_batch', { steps: [
      { action: 'click', target: { role: 'button', name: '计数 0' } },
      { action: 'assert', target: { role: 'button', name: '计数 2' }, expected: '计数 2' },
      { action: 'fill', target: input, value: '新实例正文' },
      { action: 'assert', target: input, assertion: 'value', expected: '新实例正文' },
      { action: 'screenshot' },
    ] })
    assert.equal(batch.ok, true, JSON.stringify(batch.failure)); assert.equal(batch.completed, 5)
    assert.equal(batch.image.type, 'image')
    const passed = await failed.run('browser_finish', { result: 'passed', summary: '修复后新实例中的批量操作与断言通过' })
    assert.equal(passed.status, 'passed'); assert.equal(passed.checks.length, 2)
    assert.equal(passed.previousAttempts[0].status, 'failed')
    assert.equal(await readFile(join(root, 'reports/browser', final.id, 'report.json'), 'utf8'), original)
    await assert.rejects(fetch(retest.url, { signal: AbortSignal.timeout(1000) }))
  } finally { await failed.close() }
})
