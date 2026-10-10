import { writeFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
export async function atomic(file, value) {
  const temporary = file + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, file); break }
      catch (error) { if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 6) throw error; await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt)) }
    }
  } finally { await rm(temporary, { force: true }).catch(() => {}) }
}
