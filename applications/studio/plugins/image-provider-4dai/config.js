import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const invalid = message => { throw Object.assign(Error(message), { status: 400 }) }
export const models = Object.freeze([
  { id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst' },
  { id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare' },
])
const defaultModel = models[0].id

export function normalizeConfig(input) {
  const baseUrl = String(input.baseUrl || 'https://api.4dai.cc').replace(/\/+$/, '').replace(/\/v1(?:\/images\/(?:generations|edits))?$/, '')
  let url
  try { url = new URL(baseUrl) } catch { invalid('4dai 接口地址无效') }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) invalid('4dai 接口地址需为 HTTPS 服务地址')
  const model = input.model || defaultModel
  if (!models.some(item => item.id === model)) invalid('请选择支持的 GPT Image 模型')
  if (typeof input.apiKey !== 'string' || input.apiKey.length > 4096 || /[\r\n]/.test(input.apiKey)) invalid('4dai API Key 无效')
  return { baseUrl, model, apiKey: input.apiKey.trim() }
}

export async function createConfig(directory, { writeSnapshot, env = process.env } = {}) {
  await mkdir(directory, { recursive: true })
  const file = join(directory, '4dai-private.json')
  let value
  try { value = normalizeConfig(JSON.parse(await readFile(file, 'utf8'))) }
  catch (error) {
    if (error.code !== 'ENOENT') throw Error('4dai 私有配置无法读取；原文件已保留，请检查配置文件')
    value = normalizeConfig({ baseUrl: env.FOURDAI_BASE_URL, model: env.FOURDAI_IMAGE_MODEL, apiKey: env.FOURDAI_API_KEY || '' })
    await writeSnapshot(file, JSON.stringify(value, null, 2))
  }
  let queue = Promise.resolve()
  const publicValue = () => ({ baseUrl: value.baseUrl, model: value.model, hasKey: !!value.apiKey, models: models.map(item => ({ ...item })), ratios: ['auto', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'], resolutions: ['1k', '2k', '4k'], referenceImages: true })
  return {
    public: publicValue,
    private: () => ({ ...value }),
    save(input) {
      const task = queue.then(async () => {
        const next = normalizeConfig({ ...value, ...input, apiKey: input.apiKey?.trim() || value.apiKey })
        await writeSnapshot(file, JSON.stringify(next, null, 2)); value = next
        return publicValue()
      })
      queue = task.catch(() => {})
      return task
    },
  }
}

export function imageSize(ratio, resolution) {
  const long = { '1k': 1024, '2k': 2048, '4k': 4096 }[resolution]
  const [w, h] = ratio.split(':').map(Number)
  return Math.round(long * w / Math.max(w, h) / 64) * 64 + 'x' + Math.round(long * h / Math.max(w, h) / 64) * 64
}
