import { Service } from 'cordis'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'

class Storage extends Service {
  constructor(ctx, { file }) { super(ctx, 'storage'); this.file = file }
  async read() {
    await mkdir(dirname(this.file), { recursive: true })
    try { return JSON.parse(await readFile(this.file, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
  }
  async write(items) { await writeFile(this.file + '.tmp', JSON.stringify(items, null, 2)); await rename(this.file + '.tmp', this.file) }
}
export const storage = { apply: (ctx, config) => { new Storage(ctx, config) } }
