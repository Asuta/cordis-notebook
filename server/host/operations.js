import { randomUUID } from 'node:crypto'
import { errorDetail, operationError, restoreError } from '../../shared/errors.js'
import { operationResult } from '../../shared/operation-result.js'

const terminal = operation => ['succeeded', 'failed'].includes(operation.status)
// Deterministic keys prevent object field order from changing request identity.
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)

/** Session-scoped bounded journal. It stores no configuration payload in public records. */
export class Operations {
  constructor(snapshot, changed = () => {}, limit = 128) { this.snapshot = snapshot; this.changed = changed; this.limit = limit; this.records = new Map() }
  get(id) {
    const entry = this.records.get(id)
    if (!entry) throw operationError('OPERATION_UNKNOWN', '操作记录不存在或已过期，请读取当前应用状态；不要自动重放写操作', { status: 404 })
    return structuredClone(entry.operation)
  }
  update(id, status, phase, error) {
    const entry = this.records.get(id)
    if (!entry || terminal(entry.operation)) return
    Object.assign(entry.operation, { status, phase, updatedAt: Date.now(), ...(error ? { error: errorDetail(error) } : {}) })
    this.changed()
  }
  waiting(id) { this.update(id, 'awaiting-client', 'awaiting-client') }
  succeed(id) { this.update(id, 'succeeded', 'completed') }
  fail(id, error) { this.update(id, 'failed', 'completed', error) }
  async run(kind, targets, input, id = randomUUID(), action) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw operationError('INVALID_OPERATION_ID', '操作编号无效', { status: 400 })
    const signature = canonical({ kind, targets, input })
    let entry = this.records.get(id)
    if (entry) {
      if (entry.signature !== signature) throw operationError('OPERATION_ID_REUSED', '同一操作编号不能用于不同请求', { status: 409, operationId: id })
      await entry.task.catch(() => {})
      if (entry.operation.status === 'failed') throw restoreError(entry.operation.error)
      // A completed confirmation must never replay an obsolete configuration preview.
      return operationResult({ ...this.snapshot(), preview: entry.result?.preview }, this.get(id))
    }
    for (const [key, record] of this.records) { if (this.records.size < this.limit) break; if (terminal(record.operation)) this.records.delete(key) }
    if (this.records.size >= this.limit) throw operationError('OPERATIONS_BUSY', '未完成操作过多，请等待当前操作结束', { status: 409, retryable: true })
    const now = Date.now()
    entry = { signature, operation: { id, kind, targets: [...targets], status: 'running', phase: 'applying', startedAt: now, updatedAt: now } }
    this.records.set(id, entry)
    entry.task = Promise.resolve().then(async () => {
      try {
        entry.result = await action(id)
        if (entry.operation.status === 'running') this.succeed(id)
        return operationResult(entry.result, this.get(id))
      } catch (cause) {
        const error = Object.assign(restoreError(errorDetail(cause)), { operationId: id })
        this.fail(id, error)
        throw restoreError(entry.operation.error)
      }
    })
    this.changed()
    return entry.task
  }
}
