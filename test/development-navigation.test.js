import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pluginInventory } from '../scripts/plugin-inventory.js'
import { discoverApplications } from '../server/application-discovery.js'
import { developmentInfo, developmentNavigation } from '../workbench/development-tools.js'

test('维护文档中的插件清单与当前 manifest 一致', async () => {
  const actual = (await readFile('docs/应用插件清单.md', 'utf8')).replace(/\r\n/g, '\n')
  assert.equal(actual, await pluginInventory(), '清单已变化，请运行 pnpm docs:inventory')
})
test('每个应用的所有开发任务和模板都能解析真实文件、源码选段和服务', async () => {
  for (const app of await discoverApplications(resolve('applications'))) {
    const profile = JSON.parse(await readFile(join(app.root, 'development.json'), 'utf8'))
    const requests = [...(profile.tasks || []).map(task => ({ task: task.id })), ...(profile.templates || []).map(template => ({ template: template.id }))]
    for (const request of requests) {
      const info = await developmentInfo(resolve('.'), app.id, request)
      assert.deepEqual(info.warnings, [], app.id + ' ' + JSON.stringify(request))
      assert.ok(info.contracts.every(source => source.content.length > 0))
      for (const source of info.presentation?.sources || []) assert.ok(source.content.trim(), source.path)
    }
  }
})

test('启动目录按绑定应用生成，所有可选参数都能取回完整资料', async () => {
  for (const app of await discoverApplications(resolve('applications'))) {
    const navigation = await developmentNavigation(resolve('.'), app.id)
    const entries = [...navigation.matchAll(/^- (\{.*?\})：/gm)].map(match => JSON.parse(match[1]))
    for (const request of entries) {
      const info = await developmentInfo(resolve('.'), app.id, request)
      assert.equal(info.appId, app.id)
      assert.deepEqual(info.relatedSources, { contracts: [], examples: [] })
      assert.deepEqual(info.warnings, [])
    }
    if (app.id === 'notebook') assert.match(navigation, /"task":"note-editor"/)
    else assert.doesNotMatch(navigation, /note-editor|note-action|notebook-footer/)
  }
})

test('按钮和编辑器任务首批资料覆盖各自扩展机制，不再返回统计示例', async () => {
  const action = await developmentInfo(resolve('.'), 'notebook', { task: 'note-action' })
  assert.ok(action.examples.some(file => file.path.endsWith(join('pin', 'client.js'))))
  assert.deepEqual(action.selectedCapabilities.map(capability => capability.key).sort(), ['client:notebook', 'client:shell'])
  const editor = await developmentInfo(resolve('.'), 'notebook', { task: 'note-editor' })
  for (const key of ['client:editorHost', 'client:noteFormats', 'server:noteFormats', 'client:notebook']) {
    assert.ok(editor.selectedCapabilities.some(capability => capability.key === key), key)
  }
  for (const name of ['format-plain/format.js', 'format-plain/client.js', 'format-plain/server.js', 'format-plain/package.json', 'editor/client.js', 'editor/view.jsx', 'editor/package.json']) {
    const source = editor.examples.find(file => file.path.endsWith(join(...name.split('/'))))
    assert.ok(source, name); assert.equal(source.truncated, false, name)
  }
  assert.ok(editor.contracts.some(file => file.path.endsWith(join('editor-host', 'types', 'client.d.ts'))))
  for (const info of [action, editor]) assert.ok(info.examples.every(file => !file.path.includes(join('plugins', 'stats'))))
})

test('无专项配置的应用保留通用入口，重复或无效路径声明不能进入目录', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cordis-navigation-')), app = join(root, 'applications/sample')
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(app, { recursive: true })
  await writeFile(join(app, 'package.json'), JSON.stringify({ cordisApp: { id: 'sample', name: '示例' } }))
  assert.match(await developmentNavigation(root, 'sample'), /"template":"client"/)
  for (const profile of [
    { tasks: [{ id: 'same', description: 'a' }, { id: 'same', description: 'b' }] },
    { tasks: [{ id: 'invalid', description: '', focus: 'ui' }] },
    { tasks: [{ id: 'invalid', description: 'a', focus: 'typo' }] },
    { templates: [{ id: 'client', description: '覆盖通用模板' }] },
  ]) {
    await writeFile(join(app, 'development.json'), JSON.stringify(profile))
    await assert.rejects(developmentNavigation(root, 'sample'), /开发路径声明无效/)
  }
  await assert.rejects(developmentNavigation(root, '../sample'), /应用 ID 无效/)
})
