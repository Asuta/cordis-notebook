import { Service } from 'cordis'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

class Storage extends Service {
  constructor(ctx, { file, writeSnapshot }) { super(ctx, 'storage'); this.file = file; this.writeSnapshot = writeSnapshot }
  async read() {
    await mkdir(dirname(this.file), { recursive: true })
    try { return JSON.parse(await readFile(this.file, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
  }
  async write(items) { await this.writeSnapshot(this.file, JSON.stringify(items, null, 2)) }
}
export const storage = { apply: (ctx, config, runtime) => {
  // Legacy notebooks keep their existing file; new plugins own their dataDir.
  new Storage(ctx, { file: config.file ?? runtime?.legacyFile ?? join(runtime.appDataDir, 'notes.json'), writeSnapshot: runtime.writeSnapshot })
} }
