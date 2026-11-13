import { passes, followChoice, upgradeProject } from './model.js'
import { cameraDefaults, filterDefaults, animationKey } from './effects.js'

export const clone = value => structuredClone(value)
export const initialValues = (p, globals = {}) => Object.fromEntries(p.variables.map(v => [v.id, v.scope === 'global' && typeof globals[v.id] === typeof v.initial ? globals[v.id] : v.initial]))
const emptyStage = () => ({ backgroundId: '', backgroundDuration: 0, portraits: {}, music: { assetId: '', volume: .6, duration: 0 }, sound: null, camera: cameraDefaults(), filter: filterDefaults(), weather: { effect: 'none', intensity: .5, speed: 1 }, animations: {}, animationNonce: 0, shake: null })
export function initialState(p, sceneId = p.startSceneId, globals = {}) {
  return { sceneId, index: 0, values: initialValues(p, globals), stage: emptyStage(), current: null, ended: false }
}
function enter(p, state, id) {
  if (!p.scenes.some(s => s.id === id)) throw Error('跳转的场景不存在，请检查分支')
  state.sceneId = id; state.index = 0; state.stage.portraits = {}; state.ended = false
  for (const key of Object.keys(state.stage.animations || {})) if (key.startsWith('character:')) delete state.stage.animations[key]
}
export function execute(p, state, c) {
  if (!passes(c.condition, state.values)) return false
  const st = state.stage
  if (c.type === 'background') { st.backgroundId = c.assetId; st.backgroundDuration = c.duration }
  if (c.type === 'show') {
    const character = p.cast.find(x => x.id === c.characterId)
    const portraitId = character?.expressions?.find(e => e.id === c.expressionId)?.portraitId || character?.portraitId || ''
    const model = p.models?.find(m => m.id === character?.modelId)
    st.portraits[c.characterId] = { ...c, portraitId, visible: true, ...(model ? { modelId: model.id, modelRevision: model.revision, modelState: { expressionId: '', motionId: '', parameters: {}, idle: true, nonce: 0 } } : {}) }
  }
  if (c.type === 'hide' && st.portraits[c.characterId]) Object.assign(st.portraits[c.characterId], { visible: false, duration: c.duration })
  if (c.type === 'transform' && st.portraits[c.characterId]) Object.assign(st.portraits[c.characterId], { x: c.x, y: c.y, scale: c.scale, opacity: c.opacity, duration: c.duration })
  if (c.type === 'model' && st.portraits[c.characterId]?.modelId) st.portraits[c.characterId].modelState = { expressionId: c.expressionId, motionId: c.motionId, parameters: clone(c.parameters), idle: c.idle, nonce: (st.portraits[c.characterId].modelState?.nonce || 0) + 1 }
  if (c.type === 'music') st.music = { assetId: c.assetId, volume: c.volume, duration: c.duration }
  if (c.type === 'camera') { const { x, y, scale, rotation } = st.camera || cameraDefaults(); st.camera = { ...clone(c), from: { x, y, scale, rotation }, nonce: (st.camera?.nonce || 0) + 1 } }
  if (c.type === 'filter') { const { brightness, contrast, saturation, grayscale, sepia, blur, hue } = st.filter || filterDefaults(); st.filter = { ...clone(c), from: { brightness, contrast, saturation, grayscale, sepia, blur, hue }, nonce: (st.filter?.nonce || 0) + 1 } }
  if (c.type === 'weather') st.weather = clone(c)
  if (c.type === 'shake') st.shake = { ...c, nonce: (st.shake?.nonce || 0) + 1 }
  if (c.type === 'animate') {
    st.animations ||= {}
    const key = animationKey(c), definition = p.animations?.find(a => a.id === c.animationId)
    if (!c.animationId) delete st.animations[key]
    else if (definition) { st.animationNonce = (st.animationNonce || 0) + 1; st.animations[key] = { target: c.target, characterId: c.characterId, animation: clone(definition), nonce: st.animationNonce } }
  }
  if (c.type === 'sound') st.sound = { ...c, nonce: (st.sound?.nonce || 0) + 1 }
  if (c.type === 'set') state.values = followChoice({ effects: [c] }, state.values, p.variables)
  if (c.type === 'jump') enter(p, state, c.targetId)
  if (c.type === 'say') state.lastSay = clone(c)
  if (['say', 'wait', 'choice'].includes(c.type)) { state.current = clone(c); return true }
  return false
}

// Each returned state is a complete interaction checkpoint, independent of the UI.
export function advance(p, previous) {
  const state = clone(previous)
  if (state.ended) return state
  state.current = null
  for (let count = 0; count < 2000; count++) {
    const s = p.scenes.find(s => s.id === state.sceneId)
    if (!s) throw Error('当前场景不存在')
    if (state.index >= s.commands.length) {
      state.ended = s.ending
      state.current = { id: 'end-' + s.id, type: s.ending ? 'end' : 'choice' }
      return state
    }
    const c = s.commands[state.index++]
    if (execute(p, state, c)) return state
  }
  throw Error('连续执行指令过多，可能存在没有对白或等待的跳转循环')
}

export function choose(p, previous, choiceId) {
  if (previous.current?.type !== 'choice') throw Error('当前不在选择位置')
  const s = p.scenes.find(s => s.id === previous.sceneId), choice = s?.choices.find(c => c.id === choiceId)
  if (!choice) throw Error('选项不存在')
  const state = clone(previous)
  state.values = followChoice(choice, state.values, p.variables)
  enter(p, state, choice.targetId)
  return advance(p, state)
}

// Preview deliberately starts at this scene's initial values; it never writes player progress.
export function previewState(p, sceneId, commandId, values = {}) {
  const state = initialState(p, sceneId)
  Object.assign(state.values, values)
  const s = p.scenes.find(s => s.id === sceneId)
  if (!s) return state
  const at = Math.max(0, s.commands.findIndex(c => c.id === commandId))
  for (let i = 0; i <= at && i < s.commands.length; i++) {
    const c = s.commands[i]; state.index = i + 1
    const enabled = passes(c.condition, state.values)
    if (c.type !== 'jump') execute(p, state, c)
    if (c.id === commandId) state.current = enabled ? clone(c) : null
  }
  state.stage.sound = null
  return state
}

export function restoreCheckpoint(p, payload) {
  if (!payload || payload.revision !== p.revision || !payload.state) throw Error('存档与当前作品版本不匹配')
  const state = clone(payload.state), scene = p.scenes.find(s => s.id === state.sceneId)
  if (!scene || !Number.isInteger(state.index) || state.index < 0 || state.index > scene.commands.length || !state.stage?.portraits || !state.values || !state.current) throw Error('存档状态无效')
  for (const v of p.variables) if (typeof state.values[v.id] !== typeof v.initial || typeof state.values[v.id] === 'number' && !Number.isFinite(state.values[v.id])) throw Error('存档变量无效')
  return state
}

export function prepareProject(source) { return source.schemaVersion === 2 ? source : upgradeProject(source) }
