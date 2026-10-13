import { spawn } from 'node:child_process'
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', 'test/agent-benchmark.test.js'], {
  stdio: 'inherit', windowsHide: true, env: { ...process.env, CORDIS_BENCHMARK_TEST: '1' },
})
child.once('error', error => { console.error(error.message); process.exitCode = 1 })
child.once('close', code => { process.exitCode = code ?? 1 })
