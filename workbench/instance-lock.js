import { open, readFile, unlink, writeFile } from 'node:fs/promises'

function alive(pid) {
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}

/**
 * Claim one workbench data directory. Two servers sharing the same conversation
 * store would overwrite each other's thread files, so the second one stops here.
 * A crashed process leaves a stale pid, which the next start reclaims.
 */
export async function acquireInstanceLock(file, { port = 0 } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let handle
    try {
      handle = await open(file, 'wx')
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const owner = await readFile(file, 'utf8').then(value => JSON.parse(value)).catch(() => null)
      if (owner && Number.isInteger(owner.pid) && alive(owner.pid)) {
        const address = Number.isInteger(owner.port) && owner.port > 0 ? `http://127.0.0.1:${owner.port}` : '端口未知'
        throw Error(`当前数据目录已有工作台运行（PID ${owner.pid}，${address}）。请直接打开该地址；若确认没有运行，删除 ${file} 后重试，或用 WORKBENCH_DATA_DIR 指定独立目录。`)
      }
      await unlink(file).catch(() => {})
      continue
    }
    try { await handle.writeFile(JSON.stringify({ pid: process.pid, port, startedAt: new Date().toISOString() })) }
    finally { await handle.close() }
    let released = false
    return {
      async update(nextPort) {
        if (released) return
        await writeFile(file, JSON.stringify({ pid: process.pid, port: nextPort, startedAt: new Date().toISOString() })).catch(() => {})
      },
      async release() {
        if (released) return
        released = true
        await unlink(file).catch(() => {})
      },
    }
  }
  throw Error(`无法获取工作台锁文件 ${file}；请删除该文件后重试`)
}
