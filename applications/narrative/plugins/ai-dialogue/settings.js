import { mkdir, readFile, stat, chmod, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { exactKeys, fail, normalizeBaseUrl } from './provider.js'

const DEFAULTS = Object.freeze({ schemaVersion: 1, revision: 0, model: '', baseUrl: '', protocol: 'chat', apiKey: '' })
export const publicSettings = settings => ({
  model: settings.model, baseUrl: settings.baseUrl, protocol: settings.protocol,
  hasApiKey: !!settings.apiKey, revision: settings.revision,
})
function validate(value) {
  if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0) fail(400, '模型设置版本无效')
  if (!['chat', 'responses'].includes(value.protocol)) fail(400, '协议必须是 chat 或 responses')
  if (typeof value.model !== 'string' || value.model.length > 200 || /[\u0000-\u001f\u007f]/.test(value.model)) fail(400, '模型名称无效')
  if (typeof value.apiKey !== 'string' || value.apiKey.length > 4096 || /[^\x20-\x7e]/.test(value.apiKey)) fail(400, 'API Key 无效')
  return { schemaVersion: 1, revision: value.revision, model: value.model.trim(), baseUrl: normalizeBaseUrl(value.baseUrl), protocol: value.protocol, apiKey: value.apiKey.trim() }
}

export async function createSettingsStore(dataDir) {
  const path = join(dataDir, 'settings-private.json')
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  const persist = async value => {
    const temp = join(dataDir, '.settings-private-' + randomUUID() + '.tmp')
    try {
      await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await rename(temp, path)
      await chmod(path, 0o600)
    } finally { await rm(temp, { force: true }).catch(() => {}) }
  }
  let settings
  try {
    if ((await stat(path)).size > 16384) throw Error('size')
    const stored = JSON.parse(await readFile(path, 'utf8'))
    exactKeys(stored, Object.keys(DEFAULTS), ['schemaVersion', 'model', 'baseUrl', 'protocol', 'apiKey'])
    settings = validate({ ...DEFAULTS, ...stored })
    await chmod(path, 0o600)
  } catch (error) {
    if (error.code !== 'ENOENT') fail(500, 'AI 私有设置无法读取，原文件已保留，请检查设置文件')
    settings = { ...DEFAULTS }
    try { await persist(settings) } catch { fail(500, 'AI 私有设置无法保存，请检查数据目录权限') }
  }
  let queue = Promise.resolve()
  return {
    snapshot: () => ({ ...settings }),
    update(input) {
      const run = queue.then(async () => {
        exactKeys(input, ['model', 'baseUrl', 'protocol', 'apiKey', 'clearApiKey', 'revision'])
        if (input.revision !== undefined && (!Number.isSafeInteger(input.revision) || input.revision < 0)) fail(400, '设置版本无效')
        if (input.revision !== undefined && input.revision !== settings.revision) fail(409, '连接设置已在其他页面修改，请重新载入')
        if (input.clearApiKey !== undefined && typeof input.clearApiKey !== 'boolean') fail(400, '清除密钥选项必须是布尔值')
        if (input.apiKey !== undefined && (typeof input.apiKey !== 'string' || input.apiKey.length > 4096 || Array.from(input.apiKey).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) > 126))) fail(400, 'API Key 无效')
        if (input.clearApiKey && input.apiKey?.trim()) fail(400, '不能同时设置和清除 API Key')
        const { clearApiKey, revision, ...patch } = input
        const next = validate({ ...settings, ...patch, revision: settings.revision + 1,
          apiKey: clearApiKey ? '' : input.apiKey?.trim() || settings.apiKey })
        try { await persist(next) } catch { fail(500, 'AI 私有设置无法保存，请检查数据目录权限') }
        settings = next
        return publicSettings(settings)
      })
      queue = run.catch(() => {})
      return run
    },
  }
}
