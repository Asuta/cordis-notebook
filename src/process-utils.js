import { execFile } from 'node:child_process'
export async function killTree(pid) {
  if (!pid) return
  if (process.platform === 'win32') await new Promise(resolve => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve()))
  else { try { process.kill(-pid, 'SIGKILL') } catch { try { process.kill(pid, 'SIGKILL') } catch {} } }
}
