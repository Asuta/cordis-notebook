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
    { action: 'assert', assertion: 'placeholder', target: { css: 'input' }, expected: false },
    { action: 'click', target: { css: 'button', text: '保存' } },
    { action: 'inspect', target: { css: 'body' }, script: 'document.body.remove()' },
    { action: 'click', target: { css: 'button' }, errorKind: 'usage' },
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
    { action: 'inspect', target: { role: 'button', name: '保存' } },
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
  assert.equal(v.report.steps[0].errorKind, 'usage')
  const report = await v.run('browser_finish', { result: 'passed', summary: '尚未完成实际检查' })
  assert.equal(report.status, 'incomplete'); assert.equal(report.gaps.length, 2)
  assert.equal(report.steps.length, 1); assert.deepEqual(report.errors, [])
})

test('截图作为图片内容传给模型，不在文字工具结果中塞入 base64', () => {
  const result = browserToolResult({ snapshot: '页面', image: { type: 'image', mimeType: 'image/jpeg', data: 'image-bytes' } })
  assert.equal(result.content[1].type, 'image')
  assert.doesNotMatch(result.content[0].text, /image-bytes/)
  assert.match(browserGuidance(false), /用户关闭.*不要运行浏览器测试/)
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
  const saved = JSON.parse(await readFile(join(dir, 'conversations.json'), 'utf8'))
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

test('真实浏览器使用独立应用数据，执行交互断言、截图并关闭端口', { skip: process.env.CORDIS_BROWSER_TEST !== '1', timeout: 90000 }, async t => {
  const root = await mkdtemp(resolve('browser-test-')), folder = join(root, 'applications/sample/plugins/counter')
  await mkdir(folder, { recursive: true })
  await writeFile(join(root, 'applications/sample/package.json'), JSON.stringify({ cordisApp: { id: 'sample', name: '浏览器验收测试' } }))
  await writeFile(join(folder, 'package.json'), JSON.stringify({ name: '@test/counter', type: 'module', version: '1.0.0', cordis: {
    schemaVersion: 1, id: 'counter', name: '计数器', client: 'client.js', requires: { server: [], client: [] }, provides: { server: [], client: [] },
    public: ['client.js'], build: [{ type: 'bundle', input: 'client.js', output: 'client.js', platform: 'browser' }],
  } }))
  await writeFile(join(folder, 'client.js'), `export default ctx => {
    const box=document.createElement('section');box.style.backgroundColor='rgb(240, 245, 250)';
    const button=document.createElement('button');let count=0;button.textContent='计数 0';button.onclick=()=>button.textContent='计数 '+ ++count;
    const input=document.createElement('textarea');input.setAttribute('aria-label','笔记正文');input.placeholder='写下此刻的想法…';
    input.style.cssText='color:rgb(11,22,33);background:transparent;font-size:16px';
    box.append(button,input);document.body.append(box);ctx.effect(()=>()=>box.remove())
  }`)
  const v = new BrowserVerification({ root, appId: 'sample', dataDir: join(root, 'reports') })
  t.after(async () => { await v.close(); assert.ok(root.startsWith(resolve('browser-test-'))); await rm(root, { recursive: true, force: true }) })
  const opened = await v.run('browser_open')
  assert.match(opened.snapshot, /计数 0/); assert.equal(opened.image.type, 'image')
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
  await v.run('browser_action', { action: 'screenshot' })
  const report = await v.run('browser_finish', { result: 'passed', summary: '按钮点击后计数增加' })
  assert.equal(report.status, 'passed', JSON.stringify(report.errors))
  assert.equal(report.steps.filter(step => step.errorKind === 'usage').length, 1, '通过仍保留已修正的参数错误')
  assert.equal(report.checks.length, 6)
  assert.equal(report.screenshots.length, 2)
  assert.equal((await readFile(join(root, 'reports/browser', report.id, '1.jpg')))[0], 0xff)
  await assert.rejects(fetch(opened.url, { signal: AbortSignal.timeout(1000) }))
  const failed = new BrowserVerification({ root, appId: 'sample', dataDir: join(root, 'reports') })
  try {
    await failed.run('browser_open')
    await assert.rejects(failed.run('browser_action', { action: 'assert', target: input, assertion: 'text', expected: '写下此刻的想法…' }), /页面断言失败/)
    await failed.run('browser_action', { action: 'assert', target: input, assertion: 'placeholder', expected: '写下此刻的想法…' })
    await assert.rejects(failed.run('browser_action', { action: 'click', target: { css: '#missing-button' } }), /实际匹配 0/)
    const final = await failed.run('browser_finish', { result: 'passed', summary: '成功检查不能掩盖真实失败' })
    assert.equal(final.status, 'failed')
    assert.equal(final.checks[0].passed, false); assert.equal(final.checks[1].passed, true)
    assert.ok(final.steps.some(step => step.errorKind === 'assertion'))
    assert.ok(final.steps.some(step => step.errorKind === 'operation'))
  } finally { await failed.close() }
})
