import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { discoverApplications } from '../server/application-discovery.js'
import { discoverBuiltins } from '../server/plugin-discovery.js'
import { testFiles } from './test-plugin.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const files = await testFiles(resolve(root, 'test'), resolve(root, 'test'))
for (const app of await discoverApplications(resolve(root, 'applications'))) {
  if (app.error) throw Error(app.error)
  for (const entry of await discoverBuiltins(app.pluginsDir)) files.push(...await testFiles(resolve(entry.sourceRoot, 'test'), entry.sourceRoot))
}
const child = spawn(process.execPath, ['--test', ...new Set(files)], { cwd: root, stdio: 'inherit', windowsHide: true })
child.once('error', error => { console.error(error.message); process.exitCode = 1 })
child.once('close', code => { process.exitCode = code ?? 1 })
