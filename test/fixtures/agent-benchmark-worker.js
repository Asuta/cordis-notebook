import { referencePlugin } from './agent-benchmark-reference.js'
import { join } from 'node:path'
let runs = 0
process.on('message', async message => {
  if (message.type !== 'run') return
  try {
    const path = join(message.root, 'applications/notebook/plugins/note-summary/server.js')
    process.send({ type: 'trace', event: { id: 'write-' + ++runs, kind: 'tool', name: 'write', input: JSON.stringify({ path }), status: 'running' } })
    await referencePlugin(message.root, { id: 'backend', appId: 'notebook', pluginId: 'note-summary', name: '统计' }, runs === 1)
    process.send({ type: 'trace', event: { id: 'write-' + runs, status: 'done' } })
    process.send({ type: 'done' })
  } catch (error) { process.send({ type: 'error', error: error.message }); process.send({ type: 'done' }) }
})
process.send({ type: 'ready' })
