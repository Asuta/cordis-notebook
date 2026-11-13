export const EXPRESSIONS = ['neutral', 'happy', 'sad']
export const EXPRESSION_LABELS = { neutral: '平静', happy: '开心', sad: '难过' }

export function abortError() { return new DOMException('Live2D 加载已取消', 'AbortError') }
export function isAbort(error) { return error?.name === 'AbortError' }
export function checkAbort(signal) { if (signal.aborted) throw abortError() }

export function untilAborted(promise, signal) {
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const cancel = () => reject(abortError())
    signal.addEventListener('abort', cancel, { once: true })
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel))
  })
}

export function resourceURL(value, base) {
  const url = new URL(String(value).trim(), base)
  if (!['http:', 'https:'].includes(url.protocol)) throw Error('请填写 HTTP(S) URL 或站内相对路径')
  return url.href
}

export function configuration(character) {
  const value = character?.live2d || {}
  return {
    modelUrl: typeof value.modelUrl === 'string' ? value.modelUrl.trim() : '',
    coreUrl: typeof value.coreUrl === 'string' ? value.coreUrl.trim() : '',
    expressions: Object.fromEntries(EXPRESSIONS.map(key => [key, typeof value.expressions?.[key] === 'string' ? value.expressions[key].trim() : ''])),
    tapMotion: typeof value.tapMotion === 'string' ? { group: value.tapMotion } : value.tapMotion || { group: '' },
  }
}

export function missingConfiguration(config) {
  return [!config.modelUrl && '模型 URL（.model3.json）', !config.coreUrl && 'Cubism Core URL（SDK 的 live2dcubismcore.js）'].filter(Boolean)
}

export function motionRequest(value) {
  const group = typeof value?.group === 'string' ? value.group.trim() : ''
  if (!group) throw Error('Live2D 动作需要 group')
  const index = value.index
  if (index !== undefined && (!Number.isInteger(index) || index < 0)) throw Error('Live2D 动作 index 必须是从 0 开始的整数')
  return index === undefined ? { group } : { group, index }
}

export function catalog(model) {
  const settings = model.internalModel.settings
  const expressions = (settings.expressions || []).map((entry, index) => ({ name: entry.Name, index }))
  const motions = Object.entries(settings.motions || {}).flatMap(([group, entries]) => entries.map((entry, index) => ({ group, index, file: entry.File })))
  return { expressions, motions }
}

const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback

// The fallback matches the stage's bottom-centred portrait. A measured portrait
// box takes precedence so stage layout changes do not need cross-plugin imports.
export function modelPlacement({ width, height, modelWidth, modelHeight, stage = {}, portrait }) {
  if (!(width > 0 && height > 0 && modelWidth > 0 && modelHeight > 0)) return null
  if (portrait?.width > 0 && portrait?.height > 0) return {
    x: portrait.x + portrait.width / 2, y: portrait.y + portrait.height,
    scale: Math.min(portrait.width / modelWidth, portrait.height / modelHeight),
  }
  const scale = clamp(stage.scale, 30, 180, 100) / 100
  return { x: width * clamp(stage.position, 0, 100, 50) / 100, y: height, scale: Math.min(width * 0.70 / modelWidth, height * 0.92 / modelHeight) * scale }
}

// Persist only this optional extension; an empty editor never adds it to data.
export function patchConfiguration(character, patch) {
  const next = { ...character.live2d, ...patch }
  if (patch.expressions) next.expressions = { ...character.live2d?.expressions, ...patch.expressions }
  for (const key of ['modelUrl', 'coreUrl']) {
    if (typeof next[key] === 'string') next[key] = next[key].trim()
    if (!next[key]) delete next[key]
  }
  if (next.expressions) {
    next.expressions = Object.fromEntries(Object.entries(next.expressions).filter(([, value]) => typeof value === 'string' && value.trim()).map(([key, value]) => [key, value.trim()]))
    if (!Object.keys(next.expressions).length) delete next.expressions
  }
  if (!next.tapMotion || !next.tapMotion.group && typeof next.tapMotion !== 'string') delete next.tapMotion
  if (Object.keys(next).length) character.live2d = next
  else delete character.live2d
}
