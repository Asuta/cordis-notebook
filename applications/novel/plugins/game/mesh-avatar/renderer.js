import { loadMeshAvatar, PARAMS } from './compiled/runtime.js'
import { sampleMotion } from '../live2d/document.js'

// Pose/expression transitions use the native engine and its original head geometry.
export function createMeshRenderer(canvas) {
  const defaults = Object.fromEntries(PARAMS.map(p => [p.id, p.def]))
  let avatar, disposed = false, generation = 0, lastTime, pendingTime = 0, expression = '', motion = '', start = 0, previous = {}, target = {}, transition = 0, stateKey = ''
  return {
    async setModel(model, archiveUrl) {
      const token = ++generation
      const instance = await loadMeshAvatar(canvas, archiveUrl, { manual: true })
      if (disposed || token !== generation) { instance.destroy(); return }
      avatar?.destroy(); avatar = instance; lastTime = undefined; pendingTime = 0
    },
    render(model, state = {}, elapsed = 0, speech = 0) {
      if (!avatar || disposed) return
      const seconds = elapsed / 1000, delta = lastTime === undefined ? 1 / 60 : Math.max(0, Math.min(.1, seconds - lastTime)); lastTime = seconds
      avatar.setAutoIdle(state.idle !== false); avatar.setAutoMotion(false)
      const key = JSON.stringify(state.parameters || {})
      if (key !== stateKey) { previous = { ...avatar.getParameters() }; target = { ...(state.parameters || {}) }; stateKey = key; transition = seconds }
      const t = Math.max(0, Math.min(1, (seconds - transition) / .45)), smooth = t * t * (3 - 2 * t), values = {}
      for (const id of new Set([...Object.keys(previous), ...Object.keys(target)])) {
        if (t < 1 || Object.hasOwn(target, id)) values[id] = (previous[id] ?? defaults[id] ?? 0) + ((target[id] ?? defaults[id] ?? 0) - (previous[id] ?? defaults[id] ?? 0)) * smooth
      }
      if (expression !== (state.expressionId || 'neutral')) { expression = state.expressionId || 'neutral'; avatar.setExpression(expression) }
      if (motion !== state.motionId) { motion = state.motionId; start = elapsed }
      const action = model.motions.find(m => m.id === motion)
      if (action && elapsed - start <= action.duration) Object.assign(values, sampleMotion(action, elapsed - start))
      avatar.setParameters(values); avatar.setVoiceLevel(speech); avatar.setSpeaking(speech > 0)
      // Native advance() rounds each call to whole 60 Hz steps. Carry fractions
      // across display frames so high-refresh displays do not discard time.
      pendingTime += delta
      const steps = Math.floor(pendingTime * 60 + 1e-9)
      if (steps) { avatar.advance(steps / 60); pendingTime = Math.max(0, pendingTime - steps / 60) }
    },
    reset() { lastTime = undefined; pendingTime = 0; motion = ''; stateKey = ''; previous = {}; target = {} },
    dispose() { disposed = true; generation++; avatar?.destroy(); avatar = undefined },
  }
}
