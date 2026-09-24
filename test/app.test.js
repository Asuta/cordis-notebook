import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/server.js'

test('Cordis 笔记服务：增改查删、并发写入、持久化与生命周期', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-notes-'))
  let app
  try {
    const file = join(dir, 'notes.json')
    app = await createApp({ port: 0, file })
    let base = `http://127.0.0.1:${app.server.address().port}`
    const request = (path = '', method = 'GET', body) => fetch(base + '/api/notes' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const first = await (await request('', 'POST')).json()
    await request('/' + first.id, 'PATCH', { title: '测试笔记', content: '刷新后依然存在', pinned: true })
    await Promise.all(Array.from({ length: 6 }, () => request('', 'POST')))
    assert.equal((await (await request()).json()).length, 7)
    assert.equal((await request('/' + first.id, 'PATCH', { title: 42 })).status, 400)
    assert.equal((await request('/missing', 'DELETE')).status, 404)
    assert.equal((await fetch(base + '/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' } })).status, 403)
    assert.equal((await fetch(base + '/')).status, 200)
    const module = await fetch(base + '/builtin/notebook-model.js')
    const source = await module.text()
    assert.match(source, /from '\.\.\/\.\.\/shared\/note-format\.js'/)
    const shared = await fetch(new URL('../../shared/note-format.js', module.url))
    assert.equal(shared.status, 200)
    assert.match(shared.headers.get('content-type'), /javascript/)
    assert.equal(await (await fetch(base + '/builtin/note-format.js')).text(), await shared.text())
    assert.equal((await fetch(base + '/shared/config-schema.js')).status, 404)
    assert.equal((await fetch(base + '/shared/formats/plain.js')).status, 200)
    assert.equal((await fetch(base + '/shared/format-registry.js')).status, 200)
    assert.equal((await fetch(base + '/src/host/worker.js')).status, 404)
    await app.close(); assert.equal(app.server.listening, false)
    app = await createApp({ port: 0, file }); base = `http://127.0.0.1:${app.server.address().port}`
    const saved = await (await request()).json()
    assert.equal(saved.length, 7); assert.equal(saved[0].title, '测试笔记'); assert.equal(saved[0].content, '刷新后依然存在')
    await request('/' + first.id, 'DELETE'); assert.equal((await (await request()).json()).length, 6)
  } finally { if (app?.server.listening) await app.close(); await rm(dir, { recursive: true, force: true }) }
})
