import { createServer } from 'node:net'

const defaultLimit = 1000

function validPort(port) {
  const value = Number(port)
  if (!Number.isInteger(value) || value < 0 || value > 65535) throw Error('端口无效：' + port)
  return value
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = error => { server.off('listening', onListening); reject(error) }
    const onListening = () => { server.off('error', onError); resolve() }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

async function closeQuietly(server) {
  if (!server.listening) return
  await new Promise(resolve => server.close(resolve))
}

/** Probe one port by briefly binding it, so a stale listener is detected before starting a child. */
export async function isPortAvailable(port, host = '127.0.0.1') {
  const value = validPort(port)
  if (value === 0) return true
  const server = createServer()
  try {
    await listen(server, value, host)
    return true
  } catch (error) {
    if (error.code === 'EADDRINUSE' || error.code === 'EACCES') return false
    throw error
  } finally {
    await closeQuietly(server)
  }
}

/**
 * Return the first free port at or after `startPort`.
 * Port 0 keeps the system-assigned behavior instead of scanning upwards.
 */
export async function findAvailablePort(startPort, { host = '127.0.0.1', limit = defaultLimit } = {}) {
  const start = validPort(startPort)
  if (start === 0) {
    const server = createServer()
    try {
      await listen(server, 0, host)
      return server.address().port
    } finally {
      await closeQuietly(server)
    }
  }
  for (let offset = 0; offset <= limit; offset++) {
    const port = start + offset
    if (port > 65535) break
    if (await isPortAvailable(port, host)) return port
  }
  throw Error(`从端口 ${start} 起连续 ${limit + 1} 个端口都被占用`)
}

/**
 * Listen on the first free port at or after `startPort`.
 * The same server instance is reused, so callers keep their handlers.
 */
export async function listenOnAvailablePort(server, startPort, host = '127.0.0.1', { limit = defaultLimit } = {}) {
  const start = validPort(startPort)
  if (start === 0) {
    await listen(server, 0, host)
    return server.address().port
  }
  for (let offset = 0; offset <= limit; offset++) {
    const port = start + offset
    if (port > 65535) break
    try {
      await listen(server, port, host)
      return port
    } catch (error) {
      // A failed listen never leaves the server running; retry on the next port.
      if (error.code !== 'EADDRINUSE' && error.code !== 'EACCES') throw error
    }
  }
  throw Error(`从端口 ${start} 起连续 ${limit + 1} 个端口都被占用`)
}
