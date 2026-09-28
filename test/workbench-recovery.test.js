import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createWorkbench } from '../workbench/server.js'

async function until(check) {
  for (let i = 0; i < 1800; i++) { const result = await check(); if (result) return result; await new Promise(r => setTimeout(r, 50)) }
  throw Error('工作台未按预期结束')
}
const request = async (wb, path, data) => {
  const response = await fetch(`http://127.0.0.1:${wb.server.address().port}/api/${path}`, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
  assert.equal(response.status, 200); return response.json()
}

test('损坏的应用清单不阻止工作台启动，错误应用仍可选择并进行代码修复', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cordis-manifest-recovery-'))
  let wb
  t.after(async () => { if (wb) await wb.close(); await rm(root, { recursive: true, force: true }) })
  for (const id of ['notebook', 'drawing', 'missing']) await mkdir(join(root, 'applications', id), { recursive: true })
  await writeFile(join(root, 'applications/notebook/package.json'), '{"cordisApp":')
  await writeFile(join(root, 'applications/drawing/package.json'), JSON.stringify({ cordisApp: { id: 'drawing', name: '画图' } }))
  await writeFile(join(root, 'applications/readme.txt'), '普通文件应被忽略')
  const dataDir = join(root, '.workbench'), workerFile = join(root, 'worker.cjs')
  await mkdir(dataDir)
  await writeFile(join(dataDir, 'config.json'), JSON.stringify({ apiKey: 'fixture-key' }))
  await writeFile(workerFile, `process.send({type:'ready'});process.on('message',m=>{if(m.type==='run'){process.send({type:'assistant',text:'修复应用 '+m.task.appId});process.send({type:'done'});}})`)
  wb = await createWorkbench({ root, dataDir, port: 0, autoStart: false, workerFile })
  wb.application.status = async () => ({ online: false, logs: [] })
  const state = await request(wb, 'state')
  assert.equal(state.applications.length, 3)
  assert.ok(state.applications.find(app => app.id === 'notebook').error)
  assert.ok(state.applications.find(app => app.id === 'missing').error)
  assert.deepEqual(state.applications.find(app => app.id === 'drawing'), { id: 'drawing', name: '画图' })
  const thread = await request(wb, 'run', { appId: 'notebook', prompt: '修复清单' })
  const finished = await until(async () => (await request(wb, 'state')).threads.find(item => item.id === thread.id && !item.running))
  assert.equal(finished.turns[0].status, 'done')
  assert.equal(finished.messages.at(-1).text, '修复应用 notebook')
})

test('真实 Pi 重试：成功恢复、重试耗尽、不可重试错误与中断分别保留正确状态', { timeout: 120000 }, async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'cordis-retry-recovery-'))
  let mode = 'recover', attempts = 0
  const provider = createServer(async (req, res) => {
    for await (const chunk of req) { /* Drain the mocked model request. */ }
    attempts++
    if (mode !== 'success' && (mode !== 'recover' || attempts === 1)) {
      res.writeHead(mode === 'invalid' ? 400 : 503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: mode === 'invalid' ? 'Invalid request parameter' : 'temporarily overloaded', type: mode === 'invalid' ? 'invalid_request_error' : 'server_error' } })); return
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const [delta, finish_reason] of [[{ role: 'assistant', content: '恢复成功' }, null], [{}, 'stop']]) res.write('data: ' + JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta, finish_reason }] }) + '\n\n')
    res.end('data: [DONE]\n\n')
  })
  await new Promise(r => provider.listen(0, '127.0.0.1', r))
  await writeFile(join(dataDir, 'config.json'), JSON.stringify({ apiKey: 'fixture-key', baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, thinking: false }))
  const wb = await createWorkbench({ root: resolve('.'), dataDir, port: 0, autoStart: false })
  wb.application.status = async () => ({ online: false, logs: [] })
  t.after(async () => { await wb.close(); provider.closeAllConnections(); await new Promise(r => provider.close(r)); await rm(dataDir, { recursive: true, force: true }) })
  for (const scenario of ['recover', 'exhaust', 'invalid', 'cancel', 'success']) await t.test(scenario, async () => {
    mode = scenario; attempts = 0
    const thread = await request(wb, 'run', { appId: 'notebook', prompt: '只回复问候，不执行工具。' })
    const latest = async () => (await request(wb, 'state')).threads.find(item => item.id === thread.id)
    if (scenario === 'cancel') {
      await until(async () => (await latest()).turns[0].events.some(event => event.name === '请求重试'))
      await request(wb, 'interrupt', {})
    }
    const done = await until(async () => { const item = await latest(); return !item.running && item })
    assert.equal(done.turns[0].status, scenario === 'cancel' ? 'stopped' : ['recover', 'success'].includes(scenario) ? 'done' : 'error')
    if (scenario === 'recover') {
      assert.equal(attempts, 2)
      assert.ok(done.turns[0].events.some(event => event.status === 'error'))
      assert.ok(done.turns[0].events.some(event => event.name === '请求重试'))
      assert.equal(done.messages.at(-1).text, '恢复成功')
    }
    if (scenario === 'exhaust') assert.equal(attempts, 3)
    if (scenario === 'invalid' || scenario === 'success') assert.equal(attempts, 1)
  })
})
