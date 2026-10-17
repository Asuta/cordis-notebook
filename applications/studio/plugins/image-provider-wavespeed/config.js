import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
const invalid = message => { throw Object.assign(Error(message), { status: 400 }) }
export const accountId = config => createHash('sha256').update(config.baseUrl + '\n' + config.apiKey).digest('hex')
export function normalizeConfig(input) {
  const baseUrl = String(input.baseUrl || 'https://api.wavespeed.ai').replace(/\/+$/, '').replace(/\/api\/v3$/, '')
  let url; try { url = new URL(baseUrl) } catch { invalid('WaveSpeed 接口地址无效') }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) invalid('WaveSpeed 接口地址需为 HTTPS 服务地址')
  if (typeof input.apiKey !== 'string' || input.apiKey.length > 4096 || /[\r\n]/.test(input.apiKey)) invalid('WaveSpeed API Key 无效')
  return { baseUrl, apiKey: input.apiKey.trim() }
}
export async function createConfig(directory, { writeSnapshot, env = process.env } = {}) {
  await mkdir(directory, { recursive: true })
  const file = join(directory, 'wavespeed-private.json')
  let value
  try { value = normalizeConfig(JSON.parse(await readFile(file, 'utf8'))) }
  catch (error) {
    if (error.code !== 'ENOENT') throw Error('WaveSpeed 私有配置无法读取；原文件已保留，请检查配置文件')
    value = normalizeConfig({ baseUrl: env.WAVESPEED_BASE_URL, apiKey: env.WAVESPEED_API_KEY || '' })
    await writeSnapshot(file, JSON.stringify(value, null, 2))
  }
  let queue = Promise.resolve()
  const publicValue = () => ({ baseUrl: value.baseUrl, hasKey: !!value.apiKey, catalogVersion: accountId(value).slice(0, 16), modelCatalog: true, resumable: true, referenceImages: true, referenceVideos: true })
  return {
    public: publicValue, private: () => ({ ...value }),
    save(input) {
      const task = queue.then(async () => {
        const next = normalizeConfig({ ...value, ...input, apiKey: input.apiKey?.trim() || value.apiKey })
        await writeSnapshot(file, JSON.stringify(next, null, 2)); value = next; return publicValue()
      }); queue = task.catch(() => {}); return task
    },
  }
}
