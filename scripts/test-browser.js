import { spawn } from 'node:child_process'
const child = spawn(process.execPath, ['--test', 'test/browser-verification.test.js', 'test/plugin-activation-browser.test.js', 'test/notebook-browser.test.js', 'test/notebook-notion-features-browser.test.js', 'test/workbench-history-browser.test.js'], {
  stdio: 'inherit', windowsHide: true, env: { ...process.env, CORDIS_BROWSER_TEST: '1' },
})
child.on('error', error => { console.error(error); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
