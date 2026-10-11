import { writeFile, rename, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

/** @type {Map<string, Promise<void>>} */
const writes = new Map()
/** @param {object} event */
const report = event => console.warn('状态文件写入：' + JSON.stringify(event))

/** Node-only atomic snapshots. Serialize owners of the same path in this process.
 * @param {string} file @param {string} snapshot
 * @param {{replace?:(source:string,target:string)=>Promise<void>, wait?:(ms:number)=>Promise<unknown>, onEvent?:(event:object)=>void}} options
 */
export function writeSnapshot(file, snapshot, { replace = rename, wait = delay, onEvent = report } = {}) {
  file = resolve(file)
  const previous = writes.get(file) || Promise.resolve()
  const task = previous.catch(() => {}).then(async () => {
    const temporary = `${file}.${randomUUID()}.tmp`, started = Date.now()
    let stage = 'write', attempts = 0
    /** @param {string} type @param {unknown} error */
    const emit = (type, error = undefined) => {
      const detail = /** @type {NodeJS.ErrnoException | undefined} */ (error)
      try { onEvent({ type, file, pid: process.pid, stage, attempts, elapsedMs: Date.now() - started, ...(detail ? { code: detail.code, message: detail.message } : {}) }) } catch {}
    }
    try {
      await writeFile(temporary, snapshot, { mode: 0o600, flag: 'wx' })
      stage = 'replace'
      const delays = [25, 50, 100, 200, 400, 800]
      for (;;) {
        attempts++
        try { await replace(temporary, file); if (attempts > 1) emit('recovered'); return }
        catch (error) {
          if (!['EPERM', 'EACCES', 'EBUSY'].includes(/** @type {NodeJS.ErrnoException} */ (error).code || '') || attempts > delays.length) throw error
          emit('retry', error); await wait(delays[attempts - 1])
        }
      }
    } catch (error) { emit('failed', error); throw error }
    finally {
      await rm(temporary, { force: true }).catch(error => { stage = 'cleanup'; emit('cleanup-failed', error) })
    }
  })
  writes.set(file, task)
  const done = () => { if (writes.get(file) === task) writes.delete(file) }
  void task.then(done, done)
  return task
}
