import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { writeSnapshot } from '../shared/persistence.js'

// Restore only interrupted lifecycle state; never rerun old commands or tools.
export async function recoverConversations(conversations, { dataDir, mark }) {
  for (const item of conversations) {
    const interrupted = item.running || item.commands?.some(command => command.status === 'running')
    item.turns ||= []; item.revision ||= 0
    item.commands ||= []
    for (const command of item.commands) if (command.status === 'running') {
      command.status = 'interrupted'; command.endedAt = Date.now(); command.error = '工作台已重启，旧命令会话不可恢复。'
    }
    if (item.running) {
      item.running = false; item.messages.push({ role: 'system', text: '工作台曾中断；可以继续此会话。' })
      for (const turn of item.turns.filter(turn => turn.status === 'running')) {
        turn.status = 'stopped'; turn.endedAt = Date.now()
        if (turn.browserVerification && !turn.browserVerification.endedAt && !['disabled', 'not-run'].includes(turn.browserVerification.status)) {
          const report = turn.browserVerification
          report.status = 'stopped'; report.endedAt = turn.endedAt
          report.errors ||= []; report.errors.push('工作台中断，浏览器验收未完成。')
          if (/^[a-f0-9-]{36}$/.test(report.id || '')) await writeSnapshot(join(dataDir, 'browser', report.id, 'report.json'), JSON.stringify(report, null, 2)).catch(error => { if (error.code !== 'ENOENT') throw error })
        }
        for (const event of turn.events.filter(event => event.status === 'running')) { event.status = 'stopped'; event.endedAt = turn.endedAt }
      }
    }
    if (interrupted) { item.revision++; mark(item) }
  }
}

export function createTraceReporter({ redact, notify, persist }) {
  let traceTimer, persistTimer
  const updateTrace = (task, event) => {
    const turn = task.turn
    let record = turn.events.find(record => record.id === event.id)
    if (!record) { record = { id: event.id || randomUUID(), kind: event.kind || 'notice', startedAt: Date.now(), status: 'running' }; turn.events.push(record) }
    for (const key of ['kind', 'name', 'input', 'output', 'text', 'status', 'messageId']) if (event[key] !== undefined) record[key] = redact(event[key]).slice(0, key === 'output' || key === 'input' ? 64000 : 256000)
    for (const key of ['startedAt', 'endedAt']) if (Number.isFinite(event[key]) && event[key] >= 0) record[key] = event[key]
    if (record.kind === 'model' && event.timing) {
      record.timing ||= {}
      for (const key of ['invokedAt', 'requestStartedAt', 'responseAt', 'firstOutputAt', 'endedAt', 'preparationMs', 'responseWaitMs', 'waitMs', 'streamingMs', 'totalMs']) {
        if (Number.isFinite(event.timing[key]) && event.timing[key] >= 0) record.timing[key] = event.timing[key]
      }
    }
    if (event.delta) { const full = (record.text || '') + redact(event.delta); record.text = full.slice(0, 256000); record.truncated = full.length > 256000 || record.truncated }
    if (['done', 'error', 'stopped'].includes(record.status)) record.endedAt ||= Date.now()
    // Coalesce token events for the UI, while conversation snapshots are written
    // less often. Task completion still performs a final immediate persistence.
    if (!traceTimer) traceTimer = setTimeout(() => {
      traceTimer = null; task.thread.revision++
      notify({ type: 'turn', threadId: task.thread.id, revision: task.thread.revision, turn, contextUsage: task.thread.contextUsage })
    }, 500)
    if (!persistTimer) persistTimer = setTimeout(() => {
      persistTimer = null
      persist(task.thread)
    }, 1000)
  }
  return { updateTrace, clearTrace() { clearTimeout(traceTimer); clearTimeout(persistTimer); traceTimer = persistTimer = null } }
}
