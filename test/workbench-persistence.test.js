import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rename, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeSnapshot } from '../workbench/persistence.js'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-persistence-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'conversations.json')
  await writeFile(file, 'old')
  return { dir, file }
}

test('会话文件短暂被占用时重试替换，重试期间旧文件保持完整', async t => {
  const { dir, file } = await fixture(t), waits = []
  let attempts = 0
  await writeSnapshot(file, 'new', {
    async replace(source, target) {
      assert.equal(await readFile(file, 'utf8'), 'old')
      assert.equal(await readFile(source, 'utf8'), 'new')
      if (++attempts < 4) throw Object.assign(Error('locked'), { code: ['EPERM', 'EACCES', 'EBUSY'][attempts - 1] })
      await rename(source, target)
    },
    wait: async ms => { waits.push(ms) },
  })
  assert.deepEqual(waits, [25, 50, 100])
  assert.equal(await readFile(file, 'utf8'), 'new')
  assert.deepEqual(await readdir(dir), ['conversations.json'])
})

test('持续拒绝替换时有限重试并保留旧文件，后续保存可以恢复', async t => {
  const { dir, file } = await fixture(t)
  let attempts = 0
  await assert.rejects(writeSnapshot(file, 'failed', {
    replace: async () => { attempts++; throw Object.assign(Error('locked'), { code: 'EPERM' }) },
    wait: async () => {},
  }), { code: 'EPERM' })
  assert.equal(attempts, 7)
  assert.equal(await readFile(file, 'utf8'), 'old')
  assert.deepEqual(await readdir(dir), ['conversations.json'])
  await writeSnapshot(file, 'recovered')
  assert.equal(await readFile(file, 'utf8'), 'recovered')
})

test('非占用类错误立即上报，不重试也不覆盖已有会话', async t => {
  const { file } = await fixture(t)
  await assert.rejects(writeSnapshot(file, 'failed', {
    replace: async () => { throw Object.assign(Error('disk error'), { code: 'EIO' }) },
    wait: async () => assert.fail('不应重试'),
  }), { code: 'EIO' })
  assert.equal(await readFile(file, 'utf8'), 'old')
})
