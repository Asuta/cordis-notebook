import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { AttachmentStore } from '../workbench/attachments.js'
import { workspaceImage, saveToolImages, recoverToolImages } from '../workbench/output-images.js'
import { createWorkbench } from '../workbench/server.js'
import { openConversationStore } from '../workbench/conversation-store.js'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-output-images-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const root = join(dir, 'project'), dataDir = join(root, '.workbench')
  await mkdir(join(root, 'applications'), { recursive: true })
  await mkdir(join(root, 'output'))
  const png = await sharp({ create: { width: 4, height: 3, channels: 3, background: 'red' } }).png().toBuffer()
  const path = join(root, 'output', '中文 图片.png')
  await writeFile(path, png)
  return { dir, root, dataDir, png, path, store: new AttachmentStore(dataDir) }
}

test('项目图片允许相对、绝对及文件 URL，拒绝越界、目录链接、伪造图片与非图片文件', async t => {
  const { dir, root, path, png } = await fixture(t)
  for (const value of ['output/中文 图片.png', path, pathToFileURL(path).href]) assert.deepEqual((await workspaceImage(root, value)).bytes, png)
  await writeFile(join(dir, 'outside.png'), png)
  await assert.rejects(workspaceImage(root, '../outside.png'), { status: 403 })
  await symlink(dir, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  try { await assert.rejects(workspaceImage(root, 'linked/outside.png'), { status: 403 }) }
  finally { await rm(join(root, 'linked')) }
  await writeFile(join(root, 'fake.png'), '<script>secret</script>')
  await assert.rejects(workspaceImage(root, 'fake.png'), { status: 400 })
  await assert.rejects(workspaceImage(root, '.workbench/config.json'), { status: 400 })
  await assert.rejects(workspaceImage(root, 'missing.png'), { status: 404 })
})

test('工具图片单独持久化，坏图片不丢弃有效图片，旧会话恢复可重复执行', async t => {
  const { dataDir, png, store } = await fixture(t)
  const content = [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }, { type: 'image', data: 'broken' }]
  const result = await saveToolImages(store, content)
  assert.equal(result.images.length, 1); assert.equal(result.errors.length, 1)
  assert.deepEqual(await new AttachmentStore(dataDir).bytes(result.images[0].id), png)
  await mkdir(join(dataDir, 'pi'), { recursive: true })
  const sessionFile = join(dataDir, 'pi', 'session.jsonl')
  await writeFile(sessionFile, JSON.stringify({ type: 'message', message: { role: 'toolResult', toolCallId: 'call-one', content } }) + '\n')
  const thread = { sessionFile, turns: [{ events: [{ id: 'call-one', kind: 'tool', output: '[工具返回图片]' }] }] }
  assert.equal(await recoverToolImages(thread, dataDir, store), true)
  const id = thread.turns[0].events[0].images[0].id
  assert.deepEqual(await store.bytes(id), png)
  assert.equal(await recoverToolImages(thread, dataDir, store), false)
  assert.equal(thread.turns[0].events[0].images[0].id, id)
})

test('工作台重启恢复历史图片，接口返回图片且禁止移除历史工具附件', async t => {
  const { root, dataDir, png } = await fixture(t)
  const sessionFile = join(dataDir, 'pi', 'session.jsonl')
  await mkdir(join(dataDir, 'pi'), { recursive: true })
  await writeFile(sessionFile, JSON.stringify({ message: { role: 'toolResult', toolCallId: 'read', content: [{ type: 'image', data: png.toString('base64') }] } }) + '\n')
  const conversations = await openConversationStore(dataDir)
  conversations.mark({ id: 'image-thread', revision: 1, messages: [], sessionFile, turns: [{ id: 'turn', status: 'done', events: [{ id: 'read', kind: 'tool', output: '[工具返回图片]' }] }] })
  await conversations.flush()
  const app = await createWorkbench({ root, dataDir, port: 0, appPort: 0, autoStart: false })
  try {
    const base = 'http://127.0.0.1:' + app.server.address().port
    const response = await fetch(base + '/api/workspace-image?path=' + encodeURIComponent('output/中文 图片.png'))
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png)
    const state = await (await fetch(base + '/api/threads/image-thread')).json()
    const image = state.turns[0].events[0].images[0]
    assert.deepEqual(Buffer.from(await (await fetch(base + '/api/images/' + image.id)).arrayBuffer()), png)
    assert.equal((await fetch(base + '/api/images/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: image.id }) })).status, 409)
    assert.equal((await fetch(base + '/api/workspace-image?path=config.json')).status, 400)
  } finally { await app.close() }
  const restored = await openConversationStore(dataDir)
  assert.equal(restored.conversations[0].turns[0].events[0].images.length, 1)
})
