const mib = value => Math.round(value / 1048576 * 10) / 10

export function diagnosticReportArgs(directory) {
  return [
    '--report-on-fatalerror',
    '--report-uncaught-exception',
    '--report-compact',
    '--report-exclude-env',
    '--report-exclude-network',
    ...(directory ? [`--report-directory=${directory}`] : []),
  ]
}

export function describeExit(code, signal) {
  if (Number.isInteger(code)) return `${code} (0x${(code >>> 0).toString(16).toUpperCase().padStart(8, '0')})`
  return signal ? `signal ${signal}` : 'unknown'
}

export function diagnosticSnapshot(scope) {
  const memory = process.memoryUsage(), cpu = process.cpuUsage(), resources = process.getActiveResourcesInfo()
  const resourceCounts = {}
  for (const resource of resources) resourceCounts[resource] = (resourceCounts[resource] || 0) + 1
  return {
    scope,
    at: new Date().toISOString(),
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    node: process.version,
    v8: process.versions.v8,
    memoryMB: {
      rss: mib(memory.rss),
      heapTotal: mib(memory.heapTotal),
      heapUsed: mib(memory.heapUsed),
      external: mib(memory.external),
      arrayBuffers: mib(memory.arrayBuffers),
    },
    cpuMilliseconds: { user: Math.round(cpu.user / 1000), system: Math.round(cpu.system / 1000) },
    activeResources: resourceCounts,
  }
}

export function startDiagnosticHeartbeat({ scope, send, intervalMs = 30000 }) {
  const publish = () => {
    try { send({ type: 'cordis-diagnostic', ...diagnosticSnapshot(scope) }) } catch {}
  }
  publish()
  const timer = setInterval(publish, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}

export function observeFatalDiagnostics(scope) {
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    console.error(`[diagnostics:${scope}] ${origin}\n${error?.stack || error}`)
  })
}
