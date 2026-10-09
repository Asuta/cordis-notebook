import { spawn } from 'node:child_process'
const child = spawn(process.execPath, ['--test', 'test/browser-verification.test.js'], {
  stdio: 'inherit', windowsHide: true, env: { ...process.env, CORDIS_BROWSER_TEST: '1' },
})
child.on('error', error => { console.error(error); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
