import * as pty from 'node-pty'

// Isolate native PTY handles and output workers from the long-lived workbench.
// Exiting this owner releases ConPTY resources even after a normal shell exit.
let terminal, finished = false
const done = (exitCode, error) => {
  if (finished) return
  finished = true
  if (process.connected) process.send({ type: 'exit', exitCode, error }, () => process.exit(0))
  else process.exit(0)
}
process.on('message', message => {
  try {
    if (message.type === 'start' && !terminal) {
      terminal = pty.spawn(message.file, message.args, { name: 'xterm-256color', cols: 120, rows: 30, cwd: message.cwd, env: process.env })
      process.send({ type: 'ready', pid: terminal.pid })
      terminal.onData(data => {
        if (!process.connected || finished) return
        const accepted = process.send({ type: 'data', data }, () => { if (!finished) terminal.resume() })
        if (!accepted) terminal.pause()
      })
      terminal.onExit(({ exitCode }) => done(exitCode))
    } else if (message.type === 'input') terminal?.write(message.data)
  } catch (error) { done(null, error.message) }
})
process.on('disconnect', () => { try { terminal?.kill() } finally { process.exit(0) } })
