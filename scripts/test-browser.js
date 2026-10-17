import { spawn } from 'node:child_process'
// These suites launch cold Vite/browser instances. Run serially, as benchmarks do,
// so concurrent dependency optimization does not perturb another suite's startup.
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', 'test/browser-verification.test.js', 'test/development-assets.test.js', 'test/note-action-template.test.js', 'test/plugin-activation-browser.test.js', 'test/notebook-browser.test.js', 'test/notebook-notion-features-browser.test.js', 'test/workbench-history-browser.test.js', 'test/studio-wavespeed-browser.test.js'], {
  stdio: 'inherit', windowsHide: true, env: { ...process.env, CORDIS_BROWSER_TEST: '1' },
})
child.on('error', error => { console.error(error); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
