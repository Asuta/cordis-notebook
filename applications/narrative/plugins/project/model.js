import { validateComposition, defaultComposition, expandScene } from './composition.js'
const object = v => v && typeof v === 'object' && !Array.isArray(v)
const text = (v, max = 4000) => typeof v === 'string' && v.length <= max
const idOK = v => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(v)
const fail = message => { throw Object.assign(Error(message), { status: 400 }) }
const list = (v, max) => Array.isArray(v) && v.length <= max
const unique = rows => new Set(rows.map(row => row?.id)).size === rows.length && rows.every(row => object(row) && idOK(row.id))
const finite = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1000000
const safeUrl = value => {
  if (!text(value, 8 * 1024 * 1024)) return false
  if (/^\/builtin\/project\/assets\/[a-z]+\.png$/.test(value) || value === '/builtin/project/assets/rain-theme.wav') return true
  if (/^data:(image\/(png|jpeg|webp)|audio\/(mpeg|wav|ogg));base64,[a-zA-Z0-9+/]+=*$/.test(value)) return true
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password } catch { return false }
}
export function validateProject(p) {
  if (!object(p) || p.schemaVersion !== 1 || !idOK(p.id) || !Number.isSafeInteger(p.revision) || p.revision < 0 || !text(p.title, 120) || !p.title.trim() || !text(p.description, 2000) || !text(p.template, 40)) fail('作品基本信息无效')
  for (const [key, max] of [['characters',40],['assets',100]]) if (!list(p[key], max) || !unique(p[key])) fail('作品的' + key + '列表或标识无效')
  if (JSON.stringify(p).length > 24 * 1024 * 1024) fail('作品总大小不能超过 24 MB')
  for (const a of p.assets) if (!text(a.name, 160) || !['image','audio'].includes(a.kind) || !safeUrl(a.url)) fail('素材名称、类型或地址无效')
  for (const c of p.characters) {
    if (!text(c.name, 80) || !text(c.description, 8000) || !text(c.personality, 8000) || !text(c.portrait, 80) || !object(c.expressions) || !/^#[a-f0-9]{6}$/i.test(c.color)) fail('角色配置无效')
    for (const [key,value] of Object.entries(c.expressions)) if (!text(key, 80) || !text(value, 80)) fail('角色表情配置无效')
    if (c.live2d != null && (!object(c.live2d) || JSON.stringify(c.live2d).length > 16000)) fail('Live2D 配置无效')
    if (c.meshAvatar != null && (!object(c.meshAvatar) || !/^[a-f0-9]{64}$/.test(c.meshAvatar.archiveId || '') || !text(c.meshAvatar.name,120) || !Number.isSafeInteger(c.meshAvatar.size) || c.meshAvatar.size < 1 || c.meshAvatar.size > 64*1024*1024)) fail('动态立绘配置无效')
  }
  if (!object(p.settings) || !['novel','chat'].includes(p.settings.dialogueStyle) || !/^#[a-f0-9]{6}$/i.test(p.settings.accent) || !text(p.settings.worldInfo,16000)) fail('作品设置无效')
  if (p.settings.volume !== undefined && (!finite(p.settings.volume) || p.settings.volume < 0 || p.settings.volume > 1) || p.settings.bgm !== undefined && !text(p.settings.bgm,80)) fail('背景音乐配置无效')
  if (p.composition !== undefined) validateComposition(p.composition)
  return p
}
function validateObjectSnapshot(s,project){
  if (s !== undefined) {
    const doc=project.composition||defaultComposition(project)
    if (!object(s)||s.schemaVersion!==1||!doc.scenes.some(scene=>scene.id===s.sceneId)||!object(s.states)||!object(s.flags)) fail('对象存档无效')
    if (JSON.stringify(s).length>2000000) fail('存档超过大小上限，原存档已保留')
    const ids=new Set(doc.scenes.flatMap(scene=>expandScene(doc,scene.id).objects.map(o=>scene.id+'/'+o.id)))
    for(const [id,state]of Object.entries(s.states))if(!ids.has(id)||!object(state))fail('存档引用了不存在的对象')
    for(const [id,flags]of Object.entries(s.flags))if(!ids.has(id)||!object(flags)||Object.entries(flags).some(([key,v])=>!['visible','enabled','paused'].includes(key)||typeof v!=='boolean'))fail('对象存档状态无效')
  }
}

export const compositionTools={defaultComposition,expandScene}

export function validateRuntime(value, project, formats = []) {
  if (!object(value) || typeof value.busy !== 'boolean' || !text(value.error || '',16000)) fail('存档数据无效')
  validateObjectSnapshot(value.objects,project)
  let next = structuredClone(value)
  for (const format of formats) next = format.restore?.(next,project,compositionTools) ?? next
  if (Object.keys(next).some(key => !['objects','busy','error'].includes(key))) fail('无法识别存档格式，请先启用对应插件')
  validateObjectSnapshot(next.objects,project)
  return {...next,busy:false,error:''}
}

export function projectFormats() {
  const formats = new Map()
  return {
    get(id) { return formats.get(id) },
    all() { return [...formats.values()] },
    register(owner,format) {
      if (!format.id || formats.has(format.id)) throw Error('作品格式重复登记：'+format.id)
      formats.set(format.id,format)
      owner.effect(()=>()=>formats.delete(format.id))
    },
    normalize(project) {
      validateProject(project)
      for (const format of formats.values()) { format.validate(project); format.migrate?.(project,compositionTools) }
      return validateProject(project)
    },
    issues(project) { return [...formats.values()].flatMap(f=>f.diagnose?.(project) || []) },
  }
}
