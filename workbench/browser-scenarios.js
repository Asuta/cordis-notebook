import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { readDevelopmentAsset, developmentParameters } from './development-assets.js'
import { validateBrowserInput, usageError } from './browser-contract.js'

export async function loadBrowserScenario(root, appId, id, parameters) {
  try {
    if (!/^[a-z][a-z0-9-]{1,49}$/.test(appId)) throw Error('应用 ID 无效')
    const app = join(root, 'applications', appId)
    const profile = JSON.parse(await readDevelopmentAsset(root, `applications/${appId}/development.json`))
    const entry = profile.verification?.[id]
    if (!entry?.file) throw Error('当前应用没有此公共验收场景：' + id)
    const text = await readDevelopmentAsset(app, entry.file), scenario = JSON.parse(text)
    const nonce = randomUUID().slice(0, 8)
    const values = developmentParameters(scenario.parameters, parameters, { firstTitle: '验收一-' + nonce, secondTitle: '验收二-' + nonce })
    const render = value => typeof value === 'string' ? value.replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g, (_, key) => {
      if (!Object.hasOwn(values, key)) throw Error('场景缺少参数：' + key)
      return values[key]
    }) : Array.isArray(value) ? value.map(render) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, render(item)])) : value
    const steps = render(scenario.steps)
    if (!Array.isArray(steps) || !steps.length || steps.length > 80) throw Error('公共场景需要 1–80 个步骤')
    for (const step of steps) validateBrowserInput('browser_action', step)
    return { steps, metadata: { scenarioId: id, scenarioHash: createHash('sha256').update(text).digest('hex') },
      coverage: scenario.coverage || [] }
  } catch (error) { throw usageError(error.message) }
}
