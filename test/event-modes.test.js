import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

// A deliberately small source check for this project's literal event names.
// publish() is the notebook's parallel notification wrapper, checked below.
function violations(source, modes) {
  const issues = []
  const calls = /(?:\b[\w.]+\.(emit|parallel|serial|bail|waterfall)|\b(publish))\s*\(\s*(['"])([^'"]+)\3/g
  for (const match of source.matchAll(calls)) {
    const [, direct, wrapper, , event] = match
    if (!modes.has(event)) continue
    const mode = wrapper ? 'parallel' : direct
    if (mode !== modes.get(event)) issues.push(`${event}: ${mode}, expected ${modes.get(event)}`)
  }
  return issues
}

test('业务事件声明分发模式，源码调用与契约一致', async () => {
  const declarations = await readFile('client/contracts/index.d.ts', 'utf8')
  const modes = new Map([...declarations.matchAll(/@mode\s+(\w+)\s*\*\/\s*'([^']+)'/g)].map(([, mode, event]) => [event, mode]))
  const events = [...declarations.matchAll(/'((?:notebook|plugins)\/[^']+)'\s*\(/g)].map(([, event]) => event)
  assert.equal(events.length, 4)
  assert.deepEqual([...modes.keys()].sort(), events.sort())
  for (const mode of modes.values()) assert.ok(['parallel', 'serial'].includes(mode))
  const files = await readdir('client', { recursive: true })
  for (const file of files.filter(file => file.endsWith('.js'))) {
    const source = await readFile(`client/${file}`, 'utf8')
    assert.deepEqual(violations(source, modes), [], file)
  }
  const model = await readFile('plugins/notebook/model.js', 'utf8')
  assert.match(model, /const publish = \(name, value\) => \{ void ctx\.parallel\(name, value\)/)
  assert.deepEqual(violations(await readFile('test/contracts.types.ts', 'utf8'), modes), [])
  // Prove the check catches loss of awaiting for validation and notification drift.
  assert.equal(violations("ctx.emit('notebook/before-save', note)", modes).length, 1)
  assert.equal(violations("ctx.serial('notebook/saved', note)", modes).length, 1)
})
