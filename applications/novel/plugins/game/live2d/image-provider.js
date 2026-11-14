import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

// Secrets stay on the server. Read only the explicitly named image skill section.
export async function imageProviderConfig(saved = {}) {
  const env = {}
  for (const file of [join(homedir(),'.dsh','config.toml'),join(homedir(),'.codex','config.toml')]) {
    const text = await readFile(file,'utf8').catch(() => ''); let active = false
    for (const row of text.split(/\r?\n/)) { const section=row.match(/^\s*\[([^\]]+)\]/); if(section){active=section[1]==='skills.funtoken-image2.env';continue} if(active){const pair=row.match(/^\s*([A-Z_]+)\s*=\s*"([^"\r\n]*)"/);if(pair)env[pair[1]]=pair[2]} }
  }
  return { baseUrl: saved.baseUrl || process.env.FUN_TOKEN_API_BASE_URL || env.FUN_TOKEN_API_BASE_URL || 'https://token.fun.tv', model: saved.model || process.env.FUN_TOKEN_IMAGE_MODEL || env.FUN_TOKEN_IMAGE_MODEL || 'gpt-image-2.5-sunburst', apiKey: saved.apiKey || process.env.FUN_TOKEN_API_KEY || process.env.FUN_API_KEY || env.FUN_TOKEN_API_KEY || env.FUN_API_KEY || '' }
}
export async function editImage(config, source, mime, prompt, signal) {
  if (!config.apiKey) throw Error('请先在角色工作室配置图像服务密钥，或配置 FUN Token 技能')
  const url = new URL(config.baseUrl), base = url.href.replace(/\/$/,'').replace(/\/v1$/,'')
  if (!['https:','http:'].includes(url.protocol)) throw Error('图像服务地址无效')
  const meta = await sharp(source).metadata(), width = meta.width || 1024, height = meta.height || 1024
  const form = new FormData(); form.append('model',config.model); form.append('prompt',prompt + ' Output canvas MUST be ' + width + ' by ' + height + ' pixels, identical to the reference aspect ratio.'); form.append('image',new Blob([source],{type:mime}),'source.png');form.append('size',width+'x'+height);form.append('n','1')
  const response = await fetch(base+'/v1/images/edits',{method:'POST',headers:{Authorization:'Bearer '+config.apiKey},body:form,signal:AbortSignal.any([signal,AbortSignal.timeout(600000)])})
  if (!response.ok) { await response.body?.cancel(); throw Error('图像服务请求失败（HTTP '+response.status+'），请检查服务配置后重试') }
  const result = await response.json(), item = result.data?.[0]
  if (item?.b64_json) { const bytes=Buffer.from(item.b64_json,'base64');if(bytes.length>24*1024*1024)throw Error('图像服务返回的图片过大');return bytes }
  if (typeof item?.url === 'string') {
    if (item.url.startsWith('data:image/')) return Buffer.from(item.url.split(',')[1],'base64')
    const remote = new URL(item.url); if(remote.protocol!=='https:')throw Error('图像服务返回了无效的图片地址')
    const downloaded=await fetch(remote,{signal});if(!downloaded.ok)throw Error('无法下载生成图片');const bytes=Buffer.from(await downloaded.arrayBuffer());if(bytes.length>24*1024*1024)throw Error('生成图片过大');return bytes
  }
  throw Error('图像服务没有返回图片')
}
