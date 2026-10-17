import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { createHost } from '../server/server.js'
import { createWaveMock, until } from './helpers/studio-wavespeed.js'

const enabled = process.env.CORDIS_BROWSER_TEST === '1'
async function fixture(t, setup) {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-studio-browser-')), mock = await createWaveMock()
  let app, browser, page
  t.after(async () => {
    if (page) {
      const failures = await page.frameLocator('iframe').locator('.plugin-error').allTextContents().catch(() => [])
      if (failures.length) t.diagnostic('前端插件错误：' + JSON.stringify(failures))
    }
    if (page && process.env.CORDIS_BROWSER_ARTIFACT_DIR) {
      const output = resolve(process.env.CORDIS_BROWSER_ARTIFACT_DIR); await mkdir(output, { recursive: true })
      const file = t.name.includes('并行') ? 'studio-parallel.png' : t.name.includes('默认服务') ? 'studio-reuse-preferences.png' : t.name.includes('卡片收藏点击') ? 'studio-reuse-library.png' : t.name.includes('模型') ? 'studio-wavespeed-models.png' : 'studio-wavespeed-video.png'
      await page.screenshot({ path: join(output, file), fullPage: true }).catch(() => {})
    }
    await browser?.close(); await app?.close(); await mock.close(); await rm(dir, { recursive: true, force: true })
  })
  for (const [provider, file, value] of [
    ['image-provider-wavespeed', 'wavespeed-private.json', mock.config],
    ['image-provider-pixel', 'pixel-private.json', { baseUrl: mock.origin, apiKey: 'mock-key', model: 'mock' }],
  ]) {
    const path = join(dir, 'apps/studio/plugin-data', provider); await mkdir(path, { recursive: true }); await writeFile(join(path, file), JSON.stringify(value))
  }
  app = await createHost({ port: 0, dataDir: dir, initialApplication: 'studio' })
  const origin = 'http://127.0.0.1:' + app.server.address().port
  const request = async (path = '', body) => {
    const response = await fetch(origin + '/api/studio' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Application-Session': app.applications.session }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    assert.equal(response.status, 200, await response.clone().text()); return response.json()
  }
  const edit = async operations => { const state = await request(); return request('/edit', { boardId: state.boards[0].id, revision: state.boards[0].revision, operations }) }
  await setup({ request, edit, mock, dir })
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(10000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.route('**/studio-bridge', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><iframe src="/" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe><script>
    const frame=document.querySelector('iframe'),pending=new Map();let ready;
    window.addEventListener('message',event=>{if(event.source!==frame.contentWindow||event.origin!==location.origin)return;const value=event.data;if(value?.channel!=='cordis-agent')return;if(value.type==='ready')ready=value;if(value.type==='result'){const waiter=pending.get(value.id);if(waiter){pending.delete(value.id);value.error?waiter.reject(Error(value.error)):waiter.resolve(value.result)}}});
    const timer=setInterval(()=>{if(ready?.tools.some(t=>t.name==='studio_action'))clearInterval(timer);else frame.contentWindow.postMessage({channel:'cordis-agent',type:'connect'},location.origin)},100);
    window.testReady=()=>ready?.tools.some(t=>t.name==='studio_action');window.testTools=()=>ready.tools;
    window.testCall=(name,args)=>new Promise((resolve,reject)=>{const id=crypto.randomUUID();pending.set(id,{resolve,reject});frame.contentWindow.postMessage({...ready,channel:'cordis-agent',type:'call',id,name,args},location.origin)});
    </script>` }))
  await page.goto(origin + '/studio-bridge')
  const ready = () => until(() => page.evaluate(() => window.testReady()), '画布 Agent 工具未就绪', 15000)
  await ready()
  const call = (name, args = {}) => page.evaluate(({ name, args }) => window.testCall(name, args), { name, args })
  const frame = page.frameLocator('iframe'), card = frame.locator('[data-node="g"]')
  const choose = async id => {
    await card.locator('.studio-selected-model button').click()
    const dialog = frame.locator('.studio-model-dialog')
    await dialog.getByLabel('模型输出类型').selectOption('')
    await dialog.getByLabel('模型任务类型').selectOption('')
    await dialog.getByLabel('搜索模型', { exact: true }).fill(id)
    await dialog.getByRole('button', { name: id.split('/').at(-1), exact: true }).click()
    await until(async () => (await request()).boards[0].nodes.find(n => n.id === 'g').model === id)
  }
  return { dir, mock, app, page, frame, card, request, edit, call, ready, errors, choose }
}

test('画布浏览器：全目录搜索、模型动态参数与独立草稿、最新参数生成图片、刷新及 Agent 发现', { skip: !enabled, timeout: 65000 }, async t => {
  const f = await fixture(t, async ({ edit }) => edit([{ type: 'add', node: { id: 'g', type: 'generator', x: 20, y: 0, prompt: '浏览器图片验收' } }]))
  const { card, frame, page, mock, request, call, ready, errors, choose } = f
  assert.equal((await page.evaluate(() => window.testTools())).length, 10)
  await card.locator('.studio-provider-select').selectOption('wavespeed')
  await card.locator('.studio-selected-model button').click()
  const dialog = frame.locator('.studio-model-dialog')
  await until(async () => (await dialog.locator('.studio-catalog-status').textContent()).includes('共 5'))
  assert.equal(await dialog.getByRole('button', { name: 'no-schema', exact: true }).isDisabled(), true)
  assert.equal(await dialog.getByRole('button', { name: 'audio', exact: true }).count(), 0)
  await dialog.getByLabel('模型输出类型').selectOption('video')
  await until(async () => (await dialog.locator('.studio-model-result').count()) === 2)
  await dialog.getByLabel('模型任务类型').selectOption('video-to-video')
  await until(async () => (await dialog.locator('.studio-model-result').count()) === 1)
  assert.equal(await dialog.getByRole('button', { name: 'video-edit', exact: true }).count(), 1)
  await dialog.getByLabel('模型输出类型').selectOption('image')
  await dialog.getByLabel('搜索模型', { exact: true }).fill('mock/image')
  await dialog.getByRole('button', { name: 'image', exact: true }).click()
  const steps = card.getByLabel('参数 steps', { exact: true }), metadata = card.getByLabel('参数 metadata', { exact: true })
  assert.equal(await steps.inputValue(), '20'); assert.equal(await steps.getAttribute('max'), '50')
  for (const height of [800, 1000]) {
    await page.setViewportSize({ width: 1440, height })
    const run = await card.getByRole('button', { name: '✦ 生成图片', exact: true }).boundingBox()
    const controls = await frame.locator('.studio-bottom-controls').boundingBox()
    assert.ok(run.y + run.height < controls.y, '生成按钮必须完整显示在底部工具栏上方')
    assert.equal(await card.locator('.studio-generator-body').evaluate(body => body.scrollHeight > body.clientHeight), true)
  }
  await steps.fill('28'); await steps.press('Tab')
  await until(async () => (await request()).boards[0].nodes[0].modelParameters?.['wavespeed:mock/image']?.steps === 28)
  await choose('mock/video')
  assert.equal(await card.getByLabel('参数 steps', { exact: true }).count(), 0)
  await card.getByLabel('参数 duration', { exact: true }).waitFor()
  await choose('mock/image')
  assert.equal(await steps.inputValue(), '28')
  await metadata.fill('{ broken'); await metadata.press('Tab')
  await until(() => card.getByRole('button', { name: '✦ 生成图片', exact: true }).isDisabled())
  assert.equal(mock.requests.filter(r => r.body).length, 0)
  assert.equal(await metadata.inputValue(), '{ broken')
  await metadata.fill('{"purpose":"browser"}'); await metadata.press('Tab')
  await card.getByLabel('参数 options/strength', { exact: true }).fill('0.7')
  await steps.fill('31')
  await card.getByRole('button', { name: '✦ 生成图片', exact: true }).click()
  let completed
  await until(async () => { completed = await request(); return completed.jobs[0]?.status === 'succeeded' }, '图片生成未完成', 12000)
  const result = completed.boards[0].nodes.find(n => n.jobId === completed.jobs[0].id)
  assert.equal(result.type, 'image'); assert.equal(completed.jobs[0].input.parameters.steps, 31)
  assert.equal(completed.jobs[0].input.parameters.options.strength, 0.7)
  assert.deepEqual(completed.jobs[0].input.parameters.metadata, { purpose: 'browser' })
  const submitted = mock.requests.find(r => r.body).body
  assert.equal(submitted.enable_sync_mode, false); assert.equal(submitted.enable_base64_output, false)
  await until(() => frame.locator('[data-node="' + result.id + '"] img').evaluate(image => image.complete && image.naturalWidth > 0))
  const resultCard = frame.locator('[data-node="' + result.id + '"]')
  const imageBox = await resultCard.locator('img').boundingBox()
  await page.mouse.move(imageBox.x + imageBox.width / 2, imageBox.y + imageBox.height / 2)
  await page.mouse.down(); await page.mouse.move(imageBox.x + imageBox.width / 2 + 60, imageBox.y + imageBox.height / 2 + 36, { steps: 5 }); await page.mouse.up()
  await until(async () => (await request()).boards[0].nodes.find(node => node.id === result.id).x > result.x, '拖动结果图片没有移动卡片')
  assert.equal(await frame.locator('.studio-viewer').evaluate(node => node.open), false)
  await resultCard.locator('img').dblclick()
  const viewer = frame.locator('.studio-viewer')
  await viewer.waitFor({ state: 'visible' })
  assert.match(await viewer.locator('.studio-viewer-stage img').getAttribute('src'), /\/api\/studio\/images\/[a-f0-9-]+\.png$/)
  const box = await viewer.boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height + 12)
  await until(() => viewer.evaluate(node => !node.open), '点击弹窗外下方区域没有关闭预览')
  await frame.locator('.studio-assets button').first().click()
  await viewer.waitFor({ state: 'visible' })
  assert.equal(await viewer.evaluate(node => node.open), true)
  await viewer.getByRole('button', { name: '关闭预览', exact: true }).click()
  const count = (await request()).boards[0].nodes.length
  await frame.locator('.studio-assets button').first().dragTo(frame.locator('.studio-stage'), { targetPosition: { x: 620, y: 420 } })
  await until(async () => (await request()).boards[0].nodes.length === count + 1, '拖拽素材没有创建卡片')
  const dropped = (await request()).boards[0].nodes.at(-1)
  assert.equal(dropped.type, 'image'); assert.ok(dropped.assetId)
  await page.reload(); await ready()
  assert.equal(await steps.inputValue(), '31'); assert.deepEqual(JSON.parse(await metadata.inputValue()), { purpose: 'browser' })
  const state = await call('studio_read')
  const found = await call('studio_action', { id: 'models', revision: state.board.revision, args: { provider: 'wavespeed', kind: 'video', query: 'mock/' } })
  assert.equal(found.total, 2)
  const model = await call('studio_action', { id: 'model', revision: state.board.revision, args: { provider: 'wavespeed', model: 'mock/video' } })
  assert.deepEqual(model.mediaFields.map(f => f.path), ['/start_image', '/end_image'])
  assert.equal(mock.requests.filter(r => r.body).length, 1); assert.deepEqual(mock.errors, []); assert.deepEqual(errors, [])
})

test('画布浏览器：上传与连线参考共同排序、首尾帧、原任务恢复、视频播放下载及后台刷新', { skip: !enabled, timeout: 65000 }, async t => {
  let connected
  const f = await fixture(t, async ({ edit, request, mock }) => {
    connected = await request('/upload', { name: '连线参考图', base64: mock.png.toString('base64') })
    await edit([
      { type: 'add', node: { id: 'image', type: 'image', title: '连线参考图', assetId: connected.id, x: -320, y: 0 } },
      { type: 'add', node: { id: 'g', type: 'generator', title: '视频生成', provider: 'wavespeed', model: 'mock/video', prompt: '浏览器视频验收', x: 20, y: 0 } },
      { type: 'connect', id: 'connected', from: 'image', to: 'g' },
    ])
  })
  const { card, frame, page, mock, request, edit, call, ready, errors, dir } = f
  await card.getByLabel('参数 duration', { exact: true }).waitFor()
  await card.getByRole('button', { name: '＋ 新建参考槽位', exact: true }).click()
  await card.getByLabel('选择参考素材 1', { exact: true }).click()
  await frame.locator('.studio-asset-picker input[type=file]').setInputFiles({ name: '卡片内参考图.png', mimeType: 'image/png', buffer: mock.png })
  await until(async () => (await card.locator('.studio-reference-row').count()) === 2)
  await card.locator('.studio-reference-thumb').first().click()
  const viewer = frame.locator('.studio-viewer')
  await viewer.waitFor({ state: 'visible' })
  assert.equal(await viewer.evaluate(node => node.open), true)
  assert.match(await viewer.locator('.studio-viewer-stage img').getAttribute('src'), /\/api\/studio\/images\/[a-f0-9-]+\.png$/)
  if (process.env.CORDIS_BROWSER_ARTIFACT_DIR) {
    const output = resolve(process.env.CORDIS_BROWSER_ARTIFACT_DIR); await mkdir(output, { recursive: true })
    await page.screenshot({ path: join(output, 'studio-reference-preview.png'), fullPage: true })
  }
  await viewer.getByRole('button', { name: '关闭预览', exact: true }).click()
  assert.equal(await viewer.evaluate(node => node.open), false)
  const directKey = await card.locator('.studio-reference-row').first().getAttribute('data-reference')
  assert.match(directKey, /^direct:/)
  const sourceRow = card.locator('.studio-reference-row').nth(1), targetRow = card.locator('.studio-reference-row').first()
  const sourceBox = await sourceRow.locator('.studio-reference-grip').boundingBox(), targetBox = await targetRow.boundingBox()
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 4, { steps: 6 })
  assert.equal(await sourceRow.evaluate(node => node.classList.contains('is-pointer-dragging')), true)
  if (process.env.CORDIS_BROWSER_ARTIFACT_DIR) {
    const output = resolve(process.env.CORDIS_BROWSER_ARTIFACT_DIR); await mkdir(output, { recursive: true })
    await page.screenshot({ path: join(output, 'studio-reference-drag.png'), fullPage: true })
  }
  await page.mouse.up()
  await until(async () => (await card.locator('.studio-reference-row').first().getAttribute('data-reference')) === 'edge:connected')
  await card.getByLabel('参考素材 1 输入位置', { exact: true }).selectOption('/start_image')
  await card.getByLabel('参考素材 2 输入位置', { exact: true }).selectOption('/end_image')
  await card.getByLabel('参数 duration', { exact: true }).selectOption('1')
  mock.state.complete = false
  await card.getByRole('button', { name: '✦ 生成视频', exact: true }).click()
  let state
  await until(async () => { state = await request(); return !!state.jobs[0]?.remote?.taskId }, '视频任务 ID 未保存')
  const taskId = state.jobs[0].remote.taskId, jobId = state.jobs[0].id
  const resultCard = frame.locator('[data-node="' + state.jobs[0].resultNodeId + '"]')
  assert.equal(state.boards[0].nodes.find(node => node.jobId === jobId).type, 'video')
  await until(async () => (await resultCard.innerText()).includes('正在生成视频'))
  assert.deepEqual(state.jobs[0].input.assetIds[0], connected.id)
  assert.equal(state.jobs[0].input.parameters.duration, 5)
  await page.reload(); await ready()
  await card.getByRole('button', { name: '■ 暂停查询', exact: true }).click()
  await until(async () => (await request()).jobs[0].status === 'paused')
  await until(async () => (await resultCard.innerText()).includes('已暂停查询'))
  assert.equal(await resultCard.locator('.studio-pending-media.is-active').count(), 0)
  mock.state.complete = true
  await card.getByRole('button', { name: '恢复查询', exact: true }).click()
  await until(async () => { state = await request(); return state.jobs[0]?.status === 'succeeded' }, '恢复查询未完成', 12000)
  assert.equal(state.jobs[0].remote.taskId, taskId)
  assert.equal(mock.requests.filter(r => r.body).length, 1)
  const submitted = mock.requests.find(r => r.body).body
  assert.equal(submitted.start_image, mock.origin + '/media/1'); assert.equal(submitted.end_image, mock.origin + '/media/2')
  const result = state.boards[0].nodes.find(n => n.jobId === jobId), player = resultCard.locator('video')
  await until(() => player.evaluate(video => video.readyState >= 2 && video.videoWidth === 64))
  await frame.getByRole('button', { name: '适应画布', exact: true }).click()
  const downloadEvent = page.waitForEvent('download')
  await resultCard.getByRole('link', { name: '下载视频', exact: true }).click()
  const download = await downloadEvent
  assert.match(download.suggestedFilename(), /\.mp4$/); assert.equal(await download.failure(), null)
  await player.evaluate(async video => { video.dataset.continuity = 'same-player'; video.muted = true; video.loop = true; video.currentTime = 0; await video.play() })
  const before = await player.evaluate(video => video.currentTime)
  await edit([{ type: 'add', node: { id: 'background', type: 'text', text: '后台更新', x: 900, y: 0 } }])
  await frame.locator('[data-node="background"]').waitFor()
  assert.equal(await player.getAttribute('data-continuity'), 'same-player')
  await until(() => player.evaluate(video => !video.paused && video.currentTime > 0.4), '后台更新打断了视频播放')
  assert.ok(await player.evaluate(video => video.currentTime) > before)
  // The existing Agent import tool accepts video without inventing a new tool.
  const videoPath = join(dir, 'agent-import.mp4'); await writeFile(videoPath, mock.mp4)
  const imported = await call('studio_import_image', { path: videoPath })
  assert.equal(imported.kind, 'video')
  const final = await call('studio_jobs')
  assert.equal(final.jobs[0].status, 'succeeded'); assert.equal(final.assets[result.assetId].kind, 'video')
  assert.deepEqual(mock.errors, []); assert.deepEqual(errors, [])
})

test('画布并行浏览器：每次点击独立连线占位，排队、刷新、暂停、乱序成功与失败互不影响', { skip: !enabled, timeout: 65000 }, async t => {
  const f = await fixture(t, async ({ edit, mock }) => {
    mock.state.complete = false
    await edit([{ type: 'add', node: { id: 'g', type: 'generator', provider: 'wavespeed', model: 'mock/image', prompt: '并行任务', x: 20, y: 0 } }])
  })
  const { card, frame, page, mock, request, ready, errors } = f
  const run = card.getByRole('button', { name: '✦ 生成图片', exact: true })
  await card.getByLabel('参数 steps', { exact: true }).waitFor()
  await run.click(); await run.click(); await run.click()
  let state
  await until(async () => { state = await request(); return state.jobs.length === 3 && state.jobs.filter(job => job.remote?.taskId).length === 2 }, '连续点击没有创建独立任务', 12000)
  const [first, second, third] = state.jobs
  const resultCard = job => frame.locator('[data-node="' + job.resultNodeId + '"]')
  assert.equal(third.status, 'queued'); assert.equal(mock.requests.filter(item => item.body).length, 2)
  assert.equal(await run.isEnabled(), true)
  await until(async () => await frame.locator('.studio-pending-media').count() === 3)
  assert.equal(await frame.locator('.studio-result-wire').count(), 3)
  assert.match(await resultCard(third).innerText(), /排队中/)
  assert.equal(await resultCard(first).locator('.studio-pending-spinner').evaluate(node => getComputedStyle(node).animationName), 'studio-pending-spin')
  await page.reload(); await ready()
  assert.equal(await frame.locator('.studio-pending-media').count(), 3)
  await frame.getByRole('button', { name: '适应画布', exact: true }).click()
  if (process.env.CORDIS_BROWSER_ARTIFACT_DIR) await page.screenshot({ path: join(resolve(process.env.CORDIS_BROWSER_ARTIFACT_DIR), 'studio-parallel-loading.png'), fullPage: true })
  await resultCard(first).getByRole('button', { name: '■ 暂停查询', exact: true }).click()
  await until(async () => { state = await request(); return state.jobs[0].status === 'paused' && !!state.jobs[2].remote?.taskId })
  assert.equal(state.jobs[1].status, 'running')
  mock.tasks.get(second.remote.taskId).status = 'failed'; mock.tasks.get(second.remote.taskId).error = '这一次失败'
  mock.tasks.get(state.jobs[2].remote.taskId).status = 'completed'
  await until(async () => { state = await request(); return state.jobs[1].status === 'failed' && state.jobs[2].status === 'succeeded' }, '独立任务未完成', 12000)
  assert.equal(state.boards[0].nodes.find(node => node.id === third.resultNodeId).assetId, state.jobs[2].assetId)
  await until(async () => (await resultCard(second).innerText()).includes('生成失败'))
  assert.equal(await resultCard(second).locator('.is-active').count(), 0)
  mock.tasks.get(first.remote.taskId).status = 'completed'
  await resultCard(first).getByRole('button', { name: '恢复查询', exact: true }).click()
  await until(async () => { state = await request(); return state.jobs[0].status === 'succeeded' }, '原任务未恢复', 12000)
  assert.equal(state.jobs[0].remote.taskId, first.remote.taskId)
  assert.equal(state.boards[0].nodes.length, 4); assert.equal(mock.requests.filter(item => item.body).length, 3)
  await resultCard(first).locator('img').waitFor()
  assert.deepEqual(errors, []); assert.deepEqual(mock.errors, [])
})

test('画布复用浏览器：默认服务、模型收藏、参数收起、拖拽高度、提示词历史与收藏编辑持久化', { skip: !enabled, timeout: 65000 }, async t => {
  const f = await fixture(t, async () => {})
  const { frame, page, request, mock, choose, errors, ready } = f
  await frame.getByRole('button', { name: '创建第一张生成卡片', exact: true }).click()
  await until(async () => (await request()).boards[0].nodes.length === 1)
  let state = await request(), id = state.boards[0].nodes[0].id
  assert.equal(state.boards[0].nodes[0].provider, 'wavespeed')
  const card = frame.locator(`[data-node="${id}"]`)
  await card.locator('.studio-selected-model button').click()
  const catalog = frame.locator('.studio-model-dialog')
  await catalog.getByLabel('搜索模型', { exact: true }).fill('MOCK IMAGE')
  await catalog.getByRole('button', { name: '收藏模型 mock/image', exact: true }).click()
  await catalog.getByLabel('模型收藏筛选').selectOption('1')
  await until(async () => await catalog.locator('.studio-model-result').count() === 1)
  await catalog.getByRole('button', { name: 'image', exact: true }).click()
  await catalog.waitFor({ state: 'hidden' })
  const prompt = card.getByRole('textbox', { name: '媒体生成 提示词', exact: true })
  await prompt.fill('只编辑还没生成'); await prompt.press('Tab')
  await card.getByRole('button', { name: '提示词历史与收藏' }).click()
  const history = frame.getByRole('dialog', { name: '提示词收藏与历史', exact: true })
  await history.getByRole('tab', { name: '历史', exact: true }).click()
  assert.equal(await history.locator('.studio-prompt-record').count(), 0)
  await history.getByRole('button', { name: '关闭', exact: true }).click()
  await card.getByLabel('参数 steps', { exact: true }).fill('28'); await card.getByLabel('参数 steps', { exact: true }).press('Tab')
  await card.getByRole('button', { name: '收起参数 steps', exact: true }).click()
  await card.locator('[data-collapsed-parameter="/steps"]').waitFor()
  assert.equal(await card.getByLabel('参数 steps', { exact: true }).count(), 0)
  assert.equal(await card.locator('.studio-generator-body').evaluate(body => body.lastElementChild.classList.contains('studio-collapsed-parameters')), true)
  await frame.getByRole('button', { name: '适应画布', exact: true }).click()
  const handle = card.getByRole('separator', { name: '调整生成卡片高度' }), before = await card.evaluate(card => card.offsetHeight), grip = await handle.boundingBox()
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down(); await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 200, { steps: 10 }); await page.mouse.up()
  await until(async () => (await request()).boards[0].nodes[0].cardHeight > before + 100)
  await frame.getByRole('button', { name: '适应画布', exact: true }).click()
  await card.getByRole('button', { name: '✦ 生成图片', exact: true }).click()
  await until(async () => (await request()).jobs[0]?.status === 'succeeded')
  assert.equal(mock.requests.filter(item => item.body?.steps === 28).length, 1)
  await card.getByRole('button', { name: '提示词历史与收藏' }).click()
  await history.getByRole('tab', { name: '历史', exact: true }).click()
  assert.equal(await history.locator('.studio-prompt-record').count(), 1)
  await history.locator('.studio-prompt-record').getByRole('button', { name: '收藏', exact: true }).click()
  const editor = frame.getByRole('dialog', { name: '编辑收藏', exact: true })
  await editor.getByLabel('收藏名称').fill('常用人物提示词'); await editor.getByRole('button', { name: '保存收藏', exact: true }).click()
  await history.getByRole('tab', { name: '收藏', exact: true }).click()
  await history.getByRole('button', { name: '编辑', exact: true }).click()
  await editor.getByLabel('收藏提示词').fill('二次编辑后的提示词'); await editor.getByRole('button', { name: '保存收藏', exact: true }).click()
  await history.getByRole('button', { name: '使用', exact: true }).click()
  await until(async () => (await request()).boards[0].nodes[0].prompt === '二次编辑后的提示词')
  assert.equal(await prompt.inputValue(), '二次编辑后的提示词')
  await page.reload(); await ready()
  assert.equal(await prompt.inputValue(), '二次编辑后的提示词')
  assert.equal(await card.getByRole('button', { name: '展开参数 steps', exact: true }).count(), 1)
  await card.getByRole('button', { name: '展开参数 steps', exact: true }).click()
  assert.equal(await card.getByLabel('参数 steps', { exact: true }).inputValue(), '28')
  const library = await request('/generation-library'); assert.equal(library.prompts[0].prompt, '二次编辑后的提示词'); assert.equal(library.models[0].model, 'mock/image'); assert.equal(library.history.length, 1)
  assert.deepEqual(errors, [])
})

test('画布复用浏览器：复制冻结连线，卡片收藏点击和拖拽跨画板恢复全部配置', { skip: !enabled, timeout: 65000 }, async t => {
  const f = await fixture(t, async ({ request, edit, mock }) => {
    const asset = await request('/upload', { name: '参考图', base64: mock.png.toString('base64') })
    await edit([
      { type: 'add', node: { id: 'i', type: 'image', assetId: asset.id, x: 20, y: 0 } },
      { type: 'add', node: { id: 'text', type: 'text', text: '来自连线的文字', x: 20, y: 330 } },
      { type: 'add', node: { id: 'g', type: 'generator', provider: 'wavespeed', model: 'mock/video', prompt: '视频动作', x: 400, y: 0, modelParameters: { 'wavespeed:mock/video': { duration: 5 } }, referenceBindings: { 'wavespeed:mock/video': { 'edge:media': '/start_image' } } } },
      { type: 'connect', id: 'media', from: 'i', to: 'g' }, { type: 'connect', id: 'words', from: 'text', to: 'g' },
    ])
  })
  const { frame, page, card, request, errors, mock } = f
  await card.locator('.studio-card-head').click({ position: { x: 80, y: 20 } })
  await frame.getByRole('button', { name: '创建副本', exact: true }).click()
  await until(async () => (await request()).boards[0].nodes.length === 4)
  let state = await request(), copied = state.boards[0].nodes.at(-1)
  assert.equal(copied.textReferences[0].text, '来自连线的文字'); assert.equal(copied.references.length, 1); assert.equal(state.boards[0].edges.some(edge => edge.to === copied.id), false)
  // Move the overlapping copy away, then save the original card through its title bar.
  await request('/edit', { boardId: state.boards[0].id, revision: state.boards[0].revision, operations: [{ type: 'update', id: copied.id, patch: { x: 800 } }] })
  await frame.getByRole('button', { name: '载入最新', exact: true }).click()
  await card.getByRole('button', { name: '收藏生成卡片', exact: true }).click()
  const editor = frame.getByRole('dialog', { name: '编辑收藏', exact: true })
  await editor.getByLabel('收藏名称').fill('我的视频配置'); await editor.getByRole('button', { name: '保存收藏', exact: true }).click()
  await frame.getByRole('button', { name: '＋ 新建画板', exact: true }).click()
  await frame.getByRole('button', { name: '★ 生成卡片收藏', exact: true }).click()
  const library = frame.getByRole('region', { name: '生成卡片收藏库', exact: true })
  await library.getByRole('button', { name: '添加到画布', exact: true }).click()
  await until(async () => (await request()).boards[1]?.nodes.length === 1)
  state = await request(); let restored = state.boards[1].nodes[0]
  assert.equal(restored.prompt, '视频动作'); assert.equal(restored.textReferences[0].text, '来自连线的文字'); assert.equal(restored.modelParameters['wavespeed:mock/video'].duration, 5)
  assert.equal(restored.referenceBindings['wavespeed:mock/video'][restored.referenceOrder[0]], '/start_image')
  await library.locator('.studio-saved-card').dragTo(frame.locator('.studio-stage'), { targetPosition: { x: 950, y: 400 } })
  await until(async () => (await request()).boards[1].nodes.length === 2)
  assert.equal((await request()).jobs.length, 0); assert.equal(mock.requests.some(item => item.body?.prompt), false)
  assert.deepEqual(errors, [])
})
