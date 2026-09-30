import { spawn, spawnSync, fork } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { openSync, writeFileSync, closeSync, unlinkSync } from 'node:fs'
import { dirname, delimiter, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { rgPath } from '@vscode/ripgrep'
import { execWaitMs, stdinWaitMs } from './command-wait.js'

const BUFFER_LIMIT = 256 * 1024, INPUT_LIMIT = 256 * 1024, READ_LIMIT = 16000, DISPLAY_LIMIT = 12000
export function commandEnvironment(root) {
  const env = { ...process.env }
  const key = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH'
  env[key] = [dirname(rgPath), join(root, 'node_modules', '.bin'), env[key] || ''].join(delimiter)
  delete env.DEEPSEEK_API_KEY
  return env
}

// A command belongs to a chat and turn, not to the lifetime of a model tool call.
export class CommandSessions {
  constructor({ root, onChange = () => {} }) {
    this.root = root; this.onChange = onChange; this.sessions = new Map(); this.closed = false
    this.env = commandEnvironment(root)
    this.shell = process.platform === 'win32'
      ? (spawnSync('pwsh.exe', ['-NoLogo', '-NoProfile', '-Command', 'exit 0'], { windowsHide: true, stdio: 'ignore' }).error ? 'powershell.exe' : 'pwsh.exe')
      : '/bin/bash'
  }
  snapshot(s) {
    return { session_id: s.id, threadId: s.owner.threadId, turnId: s.owner.turnId, command: s.command, workdir: s.workdir,
      background: s.background, tty: s.tty, status: s.status, exit_code: s.exitCode, startedAt: s.startedAt, endedAt: s.endedAt,
      output: s.output.slice(-DISPLAY_LIMIT), truncated: s.total > DISPLAY_LIMIT, error: s.error }
  }
  publish(s, immediate = false) {
    if (s.timer && !immediate) return
    clearTimeout(s.timer)
    if (immediate) { s.timer = null; this.onChange(this.snapshot(s)); return }
    s.timer = setTimeout(() => { s.timer = null; this.onChange(this.snapshot(s)) }, 250)
  }
  append(s, text) {
    if (!text) return
    s.total += text.length; s.output = (s.output + text).slice(-BUFFER_LIMIT)
    this.publish(s)
    // Keep model-facing polling until its deadline. Live output is already
    // published to the UI above; waking here would turn every output chunk
    // into another write_stdin round trip.
  }
  finish(s, code, error) {
    if (s.status !== 'running') return
    s.status = s.stopping ? 'terminated' : 'exited'; s.exitCode = code ?? null; s.endedAt = Date.now(); s.error = error
    if (s.scriptFile) {
      try { unlinkSync(s.scriptFile) } catch (error) {
        if (error.code !== 'ENOENT') s.error = [s.error, `临时脚本清理失败：${error.message}`].filter(Boolean).join('\n')
      }
    }
    s.child = null; s.pty = null
    s.onExit?.(); s.resolveDone()
    for (const wake of s.waiters) wake()
    this.publish(s, true)
  }
  get(owner, id) {
    const s = this.sessions.get(id)
    if (!s || s.owner.threadId !== owner.threadId) throw Error('命令会话不存在、已释放或不属于当前聊天；工作台重启后的旧会话不能恢复')
    return s
  }
  list(owner) { return [...this.sessions.values()].filter(s => s.owner.threadId === owner.threadId).map(s => this.snapshot(s)) }
  async start(owner, args, executable) {
    const wait = execWaitMs(args.yield_time_ms)
    if (!owner.threadId || !owner.turnId) throw Error('命令缺少所属聊天或轮次')
    if (typeof args.command !== 'string' || !args.command.trim() || args.command.length > 64000) throw Error('命令不能为空或超过 64000 字符')
    const workdir = resolve(this.root, args.workdir || '.')
    if (!(await stat(workdir)).isDirectory()) throw Error('工作目录必须是目录')
    if (this.closed || owner.cancelled?.()) throw Error('任务已停止，不能启动命令')
    if ([...this.sessions.values()].filter(s => s.status === 'running').length >= 16) throw Error('运行命令已达 16 个，请先查询或停止现有命令')
    // Keep completed output bounded; persisted UI summaries remain available.
    const completed = [...this.sessions.values()].filter(s => s.status !== 'running' && !s.reading)
    for (const old of completed.slice(0, Math.max(0, completed.length - 39))) this.sessions.delete(old.id)
    const s = { id: randomUUID(), owner, command: args.command, workdir, background: args.background === true, tty: args.tty === true,
      status: 'running', startedAt: Date.now(), exitCode: null, output: '', total: 0, cursor: 0, stdinPendingBytes: 0, waiters: new Set(), onExit: executable?.onExit }
    s.done = new Promise(resolve => { s.resolveDone = resolve })
    this.sessions.set(s.id, s)
    executable?.onStart?.()
    this.publish(s, true)
    try {
      let file = executable?.file || this.shell, argv = executable?.args
      if (!argv) {
        if (process.platform === 'win32') {
          const script = `[Console]::InputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $OutputEncoding=[Console]::OutputEncoding\n${args.command}\n$cordisSucceeded=$?; if (-not $cordisSucceeded) { if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; exit 1 }; exit 0`
          const encoded = Buffer.from(script, 'utf16le').toString('base64')
          argv = ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', ...(s.tty ? [] : ['-NonInteractive'])]
          if (encoded.length < 24000) argv.push('-EncodedCommand', encoded)
          else {
            // Only oversized commands touch disk. Synchronous preparation prevents
            // a stop request from racing between file creation and process spawning.
            const scriptFile = join(tmpdir(), `cordis-command-${s.id}.ps1`)
            const fd = openSync(scriptFile, 'wx', 0o600)
            s.scriptFile = scriptFile
            try { writeFileSync(fd, '\uFEFF' + script, 'utf8') } finally { closeSync(fd) }
            argv.push('-File', scriptFile)
          }
        } else argv = ['--noprofile', '--norc', '-c', args.command]
      }
      if (s.tty) {
        const child = fork(new URL('./pty-worker.js', import.meta.url), [], { cwd: workdir, env: this.env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
        s.child = child; s.pid = child.pid
        s.pty = { write: data => { if (!child.connected) throw Error('终端已关闭'); child.send({ type: 'input', data }) }, kill: () => child.kill() }
        child.stdout.on('data', chunk => this.append(s, chunk.toString()))
        child.stderr.on('data', chunk => this.append(s, chunk.toString()))
        child.on('message', message => {
          if (message.type === 'ready') s.ptyPid = message.pid
          if (message.type === 'data') this.append(s, message.data)
          if (message.type === 'exit') { s.ptyExit = message.exitCode; s.spawnError = message.error }
        })
        child.on('error', error => { s.spawnError = error.message })
        child.on('close', code => this.finish(s, s.ptyExit === undefined ? code : s.ptyExit, s.spawnError))
        child.send({ type: 'start', file, args: argv, cwd: workdir })
      } else {
        const child = spawn(file, argv, { cwd: workdir, env: this.env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
        s.child = child; s.pid = child.pid
        for (const stream of [child.stdout, child.stderr]) {
          const decoder = new StringDecoder('utf8')
          stream.on('data', chunk => this.append(s, decoder.write(chunk)))
          stream.on('end', () => this.append(s, decoder.end()))
        }
        child.stdin.on('error', error => this.inputError(s, error))
        child.on('error', error => { s.spawnError = error.message })
        child.on('close', code => this.finish(s, code, s.spawnError))
      }
    } catch (error) { this.finish(s, null, error.message) }
    return this.collect(owner, { session_id: s.id }, wait)
  }
  inputError(s, error) {
    s.stdinError = error.message
    for (const wake of s.waiters) wake()
  }
  writeInput(s, chars, close) {
    const input = s.child?.stdin
    if (!input?.writable || input.destroyed || s.stdinError) throw Error('命令的标准输入已关闭')
    const bytes = Buffer.byteLength(chars || '', 'utf8')
    if (s.stdinPendingBytes + bytes > INPUT_LIMIT) throw Error('输入缓冲区已满，本次输入未接受；请先轮询等待已有输入写入')
    if (bytes) {
      s.stdinPendingBytes += bytes
      try {
        // Writable preserves order and queues EOF behind pending writes. Never
        // await its callback: a child may leave stdin unread indefinitely.
        input.write(chars, error => {
          s.stdinPendingBytes -= bytes
          if (error) this.inputError(s, error)
        })
      } catch (error) { s.stdinPendingBytes -= bytes; this.inputError(s, error); throw error }
    }
    if (close) input.end()
  }
  async read(owner, args) {
    return this.collect(owner, args, stdinWaitMs(args))
  }
  async collect(owner, args, wait) {
    const s = this.get(owner, args.session_id)
    if (s.reading) throw Error('该命令正在读取输出，请等待本次调用返回后再继续')
    if (args.chars !== undefined && (typeof args.chars !== 'string' || args.chars.length > 16000)) throw Error('输入必须是最多 16000 字符的文本')
    s.reading = true
    try {
      if (owner.signal?.aborted) throw Error('任务已停止')
      if (args.chars || args.close_stdin) {
        if (s.status !== 'running' || s.stopping) throw Error('命令已退出或正在停止，不能继续输入')
        if (s.pty) { if (args.close_stdin) throw Error('PTY 不支持 close_stdin；请向程序发送退出指令或使用 terminate_command'); s.pty.write(args.chars) }
        else this.writeInput(s, args.chars, args.close_stdin)
      }
      // Buffered output and successful writes do not shorten the model's wait.
      // Exit, stop and input errors can still release it immediately.
      if (wait && s.status === 'running' && !s.stopping && !owner.cancelled?.()) await new Promise(resolve => {
        const wake = () => { clearTimeout(timer); s.waiters.delete(wake); owner.signal?.removeEventListener('abort', wake); resolve() }
        const timer = setTimeout(wake, wait); s.waiters.add(wake)
        owner.signal?.addEventListener('abort', wake, { once: true })
      })
      if (owner.signal?.aborted) throw Error('任务已停止')
      const start = s.total - s.output.length, lost = Math.max(0, start - s.cursor), from = Math.max(start, s.cursor)
      const output = s.output.slice(from - start, from - start + READ_LIMIT)
      s.cursor = from + output.length
      return { session_id: s.id, status: s.status, exit_code: s.exitCode, background: s.background, output,
        has_more: s.cursor < s.total, dropped_chars: lost, stdin_pending_bytes: s.stdinPendingBytes,
        ...(s.stdinError ? { stdin_error: s.stdinError } : {}), ...(s.error ? { error: s.error } : {}) }
    } finally { s.reading = false }
  }
  async terminate(owner, id) {
    const s = this.get(owner, id)
    if (s.status !== 'running') return this.snapshot(s)
    if (s.termination) return s.termination
    s.stopping = true
    // Wake pending polls immediately; termination itself is still awaited separately.
    for (const wake of s.waiters) wake()
    s.termination = (async () => {
      if (s.pid) {
        if (process.platform === 'win32') {
          await new Promise((resolve, reject) => {
            const killer = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(s.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
            killer.on('error', reject); killer.on('exit', code => code === 0 || s.status !== 'running' ? resolve() : reject(Error('终止命令失败，请重试')))
          })
        } else {
          if (s.ptyPid) { try { process.kill(-s.ptyPid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error } }
          try { process.kill(-s.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
        }
        if (s.pty) s.pty.kill()
        await s.done
      } else this.finish(s, null)
      return this.snapshot(s)
    })().catch(error => { s.stopping = false; s.termination = null; throw error })
    return s.termination
  }
  async stopTurn(owner) {
    const results = await Promise.allSettled([...this.sessions.values()].filter(s => s.status === 'running' && s.owner.threadId === owner.threadId && s.owner.turnId === owner.turnId && !s.background).map(s => this.terminate(owner, s.id)))
    const error = results.find(result => result.status === 'rejected'); if (error) throw error.reason
  }
  async close() {
    this.closed = true
    const results = await Promise.allSettled([...this.sessions.values()].filter(s => s.status === 'running').map(s => this.terminate(s.owner, s.id)))
    for (const s of this.sessions.values()) clearTimeout(s.timer)
    const error = results.find(result => result.status === 'rejected'); if (error) throw error.reason
  }
}
