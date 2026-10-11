import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pluginInventory } from '../scripts/plugin-inventory.js'
import { discoverApplications } from '../server/application-discovery.js'
import { developmentInfo } from '../workbench/development-tools.js'

test('维护文档中的插件清单与当前 manifest 一致', async () => {
  assert.equal(await readFile('docs/应用插件清单.md', 'utf8'), await pluginInventory(), '清单已变化，请运行 pnpm docs:inventory')
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
