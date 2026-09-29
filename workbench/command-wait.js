const boundedWait = (value, fallback, min, max) => {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 0) throw Error('yield_time_ms 必须是非负安全整数')
  return Math.max(min, Math.min(value, max))
}

export function execWaitMs(value, platform = process.platform) {
  return boundedWait(value, 10000, platform === 'win32' ? 10000 : 0, 30000)
}

export function stdinWaitMs({ yield_time_ms, chars, close_stdin } = {}) {
  // EOF is this project's pipe-input extension and uses the input wait window.
  const input = (typeof chars === 'string' && chars.length > 0) || close_stdin === true
  return input
    ? boundedWait(yield_time_ms, 250, 0, 30000)
    : boundedWait(yield_time_ms, 5000, 5000, 300000)
}
