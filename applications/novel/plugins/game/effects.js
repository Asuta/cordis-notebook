// Shared by validation, the director, the engine and the renderer. No DOM state here.
export const easings = { linear: '匀速', 'ease-in': '渐入', 'ease-out': '渐出', 'ease-in-out': '缓入缓出' }
export const weatherNames = { none: '关闭天气', rain: '雨', snow: '雪', sakura: '樱花' }
export const dialogueModes = { dialogue: '普通对白', monologue: '全屏独白', subtitle: '电影字幕' }
export const cameraDefaults = () => ({ x: 0, y: 0, scale: 1, rotation: 0, duration: 800, easing: 'ease-in-out' })
export const filterDefaults = () => ({ brightness: 1, contrast: 1, saturation: 1, grayscale: 0, sepia: 0, blur: 0, hue: 0, duration: 800 })
export const filterPresets = {
  clear: { name: '原色 / 清除滤镜', values: {} },
  memory: { name: '旧日回忆', values: { saturation: .25, sepia: .65, contrast: .9 } },
  dream: { name: '朦胧梦境', values: { brightness: 1.15, saturation: .65, blur: 2 } },
  night: { name: '冷色夜景', values: { brightness: .75, saturation: .7, hue: 18 } },
  warm: { name: '温暖晨光', values: { brightness: 1.08, saturation: 1.15, sepia: .2 } },
  monochrome: { name: '黑白', values: { grayscale: 1, contrast: 1.1 } },
}
export const frameDefaults = () => ({ at: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, easing: 'ease-in-out' })
const frames = values => values.map(([at, patch]) => ({ ...frameDefaults(), at, ...patch }))
export const animationPresets = [
  { id: 'breath', name: '轻轻呼吸', duration: 3200, iterations: 0, keyframes: frames([[0, {}], [.5, { scale: 1.025 }], [1, {}]]) },
  { id: 'float', name: '悬浮', duration: 4000, iterations: 0, keyframes: frames([[0, {}], [.5, { y: -2 }], [1, {}]]) },
  { id: 'push', name: '缓慢推进', duration: 6000, iterations: 1, keyframes: frames([[0, {}], [1, { scale: 1.14 }]]) },
  { id: 'sway', name: '轻轻摇摆', duration: 2800, iterations: 0, keyframes: frames([[0, { rotation: -1 }], [.5, { rotation: 1 }], [1, { rotation: -1 }]]) },
  { id: 'nod', name: '点头', duration: 900, iterations: 1, keyframes: frames([[0, {}], [.5, { y: 1.5, rotation: 2 }], [1, {}]]) },
]
export const numeric = (v, min, max) => Number.isFinite(v) && v >= min && v <= max
export const colorOK = value => typeof value === 'string' && /^#[a-f0-9]{3}(?:[a-f0-9]{3})?$/i.test(value)
export function animationOK(a) {
  return a && typeof a === 'object' && numeric(a.duration, 16, 30000) && Number.isInteger(a.iterations) && numeric(a.iterations, 0, 20)
    && Array.isArray(a.keyframes) && a.keyframes.length >= 2 && a.keyframes.length <= 32
    && a.keyframes[0]?.at === 0 && a.keyframes.at(-1)?.at === 1
    && a.keyframes.every((f, i) => f && numeric(f.at, 0, 1) && (!i || f.at > a.keyframes[i - 1].at) && numeric(f.x, -100, 100) && numeric(f.y, -100, 100) && numeric(f.scale, .1, 3) && numeric(f.rotation, -360, 360) && numeric(f.opacity, 0, 1) && Object.hasOwn(easings, f.easing))
}
export function presentationOK(c) {
  if (c.type === 'camera') return numeric(c.x, -50, 50) && numeric(c.y, -50, 50) && numeric(c.scale, .5, 3) && numeric(c.rotation, -180, 180) && numeric(c.duration, 0, 30000) && Object.hasOwn(easings, c.easing)
  if (c.type === 'shake') return numeric(c.strength, 0, 5) && numeric(c.duration, 0, 10000) && numeric(c.frequency, 1, 30)
  if (c.type === 'weather') return Object.hasOwn(weatherNames, c.effect) && numeric(c.intensity, 0, 1) && numeric(c.speed, .1, 3)
  if (c.type === 'filter') return numeric(c.brightness, 0, 3) && numeric(c.contrast, 0, 3) && numeric(c.saturation, 0, 3) && numeric(c.grayscale, 0, 1) && numeric(c.sepia, 0, 1) && numeric(c.blur, 0, 20) && numeric(c.hue, -180, 180) && numeric(c.duration, 0, 30000)
  if (c.type === 'animate') return ['background', 'stage', 'character'].includes(c.target) && typeof c.characterId === 'string' && c.characterId.length <= 80 && typeof c.animationId === 'string' && c.animationId.length <= 80
  if (c.type === 'say') {
    if (c.mode !== undefined && !Object.hasOwn(dialogueModes, c.mode)) return false
    const s = c.textStyle
    if (s !== undefined && (!s || !colorOK(s.color) || !numeric(s.size, 70, 180) || !['left', 'center', 'right'].includes(s.align) || typeof s.bold !== 'boolean' || typeof s.italic !== 'boolean')) return false
    if (c.segments !== undefined && (!Array.isArray(c.segments) || c.segments.length > 60 || c.segments.some(s => !s || typeof s.text !== 'string' || !colorOK(s.color) || typeof s.bold !== 'boolean' || typeof s.italic !== 'boolean' || typeof s.ruby !== 'string' || s.ruby.length > 100) || c.segments.map(s => s.text).join('') !== c.text)) return false
  }
  return true
}
export const animationKey = c => c.target === 'character' ? 'character:' + c.characterId : c.target
export const frameTransform = f => `translate(${f.x}%, ${f.y}%) rotate(${f.rotation}deg) scale(${f.scale})`
