import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { ApplicationProcess } from '../workbench/processes.js'

test('诊断日志达到上限后轮转，每个文件体量有界并保留有限备份', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'cordis-diagnostics-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const applicationProcess = new ApplicationProcess({ root: process.cwd(), commands: {}, diagnosticDir: directory, diagnosticMaxBytes: 1024, diagnosticBackups: 2 })
  await applicationProcess.openDiagnostic('12345678-test')
  for (let index = 0; index < 30; index++) applicationProcess.writeDiagnostic('test', `第 ${index} 条 ${'x'.repeat(90)}`)
  await applicationProcess.flushDiagnostic()
  await applicationProcess.closeDiagnostic()
  const files = (await readdir(directory)).filter(name => /^application-.*\.log(?:\.\d+)?$/.test(name))
  assert.equal(files.length, 3)
  for (const name of files) assert.ok((await stat(join(directory, name))).size <= 1024, name)
})

test('诊断写入串行等待背压，不并发堆积到同一输出流', async t => {
  const applicationProcess = new ApplicationProcess({ root: process.cwd(), commands: {}, diagnosticMaxBytes: 1024 * 1024, diagnosticMaxPendingBytes: 256 * 1024 })
  let active = 0, maximum = 0, writes = 0
  applicationProcess.diagnosticStream = new Writable({
    highWaterMark: 1,
    write(chunk, encoding, callback) {
      active++; writes++; maximum = Math.max(maximum, active)
      setTimeout(() => { active--; callback() }, 5)
    },
  })
  t.after(() => applicationProcess.closeDiagnostic())
  for (let index = 0; index < 8; index++) applicationProcess.writeDiagnostic('test', `${index}${'x'.repeat(80_000)}`)
  await applicationProcess.flushDiagnostic()
  assert.equal(writes > 0, true)
  assert.equal(maximum, 1)
  assert.ok(writes < 8)
  assert.ok(applicationProcess.diagnosticDroppedChunks > 0)
  assert.ok(applicationProcess.diagnosticQueuedBytes <= applicationProcess.diagnosticMaxPendingBytes)
})
