import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createApp } from '../server/server.js'

test('图片独立于笔记存储运行，新文件归属插件且两种旧目录保持可读', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cordis-assets-'))
  const dataDir = join(root,'data'), oldNoteDir = join(root,'old-notes'), file = join(oldNoteDir,'notes.json')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6SAAAAABJRU5ErkJggg==','base64')
  const nameOf = bytes => createHash('sha256').update(bytes).digest('hex') + '.png'
  const oldFiles = [join(oldNoteDir,'note-assets'), join(dataDir,'note-assets')]
  const legacy = oldFiles.map((dir, i) => ({dir, bytes:Buffer.concat([png, Buffer.from(`legacy-${i}`)])}))
  for (const item of legacy) {await mkdir(item.dir,{recursive:true}); await writeFile(join(item.dir,nameOf(item.bytes)),item.bytes)}
  let app
  const get = path => fetch(`http://127.0.0.1:${app.server.address().port}${path}`)
  const verifyLegacy = async () => {
    for (const item of legacy) {
      const response = await get('/api/note-assets/' + nameOf(item.bytes))
      assert.equal(response.status, 200)
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), item.bytes)
      assert.deepEqual(await readFile(join(item.dir,nameOf(item.bytes))),item.bytes)
    }
  }
  try {
    app = await createApp({port:0,dataDir,file})
    const primary = join(dataDir,'plugin-data/note-assets')
    assert.equal(app.ctx.noteAssets.directory, primary)
    await verifyLegacy()
    // Simulate a disappearing note storage implementation. Images only require HTTP.
    await app.manager.records.get('storage').fiber.dispose()
    assert.equal(app.ctx.storage, undefined)
    assert.equal(app.manager.records.get('note-assets').state, 'enabled')
    const upload = await fetch(`http://127.0.0.1:${app.server.address().port}/api/note-assets`, {
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:png.toString('base64')}),
    })
    assert.equal(upload.status, 200)
    const {src} = await upload.json()
    assert.deepEqual(await readFile(join(primary,nameOf(png))),png)
    for (const dir of oldFiles) await assert.rejects(readFile(join(dir,nameOf(png))),{code:'ENOENT'})
    await verifyLegacy()
    assert.equal((await get('/api/note-assets/' + '0'.repeat(64) + '.png')).status, 404)
    await app.close(); app = await createApp({port:0,dataDir,file})
    assert.deepEqual(Buffer.from(await (await get(src)).arrayBuffer()),png)
    await verifyLegacy()
  } finally { if(app) await app.close(); await rm(root,{recursive:true,force:true}) }
})
