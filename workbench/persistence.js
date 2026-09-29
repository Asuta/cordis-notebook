import { writeFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

// Windows may briefly deny replacing a file while another process reads it.
// Keep the old file intact; never fall back to unlinking it or writing in place.
export async function writeSnapshot(file, snapshot, { replace = rename, wait = delay } = {}) {
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, snapshot, { mode: 0o600, flag: 'wx' })
    const delays = [25, 50, 100, 200, 400, 800]
    for (let attempt = 0; ; attempt++) {
      try { await replace(temporary, file); return }
      catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= delays.length) throw error
        await wait(delays[attempt])
      }
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}
