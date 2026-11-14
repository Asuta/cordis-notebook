import { loadMeshAvatar, PARAMS, LIVE_EXPRESSIONS } from './compiled/runtime.js'

const defaults = Object.fromEntries(PARAMS.map(p => [p.id, p.def]))
export function createSurface(engine, container) {
  const workspace = container.closest('.ne-app'), canvas = document.createElement('canvas'), status = document.createElement('p')
  canvas.className = 'ne-mesh-canvas'; canvas.hidden = true; canvas.setAttribute('aria-label', '动态角色舞台'); status.className = 'ne-mesh-stage-status'; status.setAttribute('role', 'status')
  container.append(canvas, status)
  let avatar, key = '', loading, generation = 0, disposed = false, frameId, last, pending = 0, lastText = '', speakingUntil = 0, poseKey = '', previous = {}, target = {}, transition = 0, motion
  const scene = () => engine.mode === 'play' ? engine.runtime?.stage : engine.scene()?.stage
  function stop() { generation++; avatar?.destroy(); avatar = null; key = ''; last = undefined; pending = 0; workspace?.classList.remove('ne-mesh-active'); canvas.hidden = true }
  function sync() {
    const stage = scene() || {}, character = engine.project.characters.find(c => c.id === stage.characterId), model = character?.meshAvatar
    canvas.style.left = (stage.position ?? 50) + '%'; canvas.style.height = (stage.scale ?? 100) + '%'
    const nextKey = model ? engine.project.id + ':' + character.id + ':' + model.archiveId : ''
    if (nextKey === key) return
    stop(); if (!nextKey || disposed) { status.textContent = ''; return }
    key = nextKey; const token = generation
    status.textContent = '动态角色加载中…'
    loading = loadMeshAvatar(canvas, '/api/narrative/mesh/archives/' + model.archiveId + '.mavatar', { manual: true }).then(instance => {
      if (disposed || token !== generation) { instance.destroy(); return }
      avatar = instance; canvas.style.aspectRatio = instance.package.rig.image.width + ' / ' + instance.package.rig.image.height; avatar.setAutoMotion(false); poseKey = ''; previous = {}; target = {}; lastText = ''; motion = null
      canvas.hidden = false; workspace?.classList.add('ne-mesh-active'); status.textContent = ''
    }).catch(error => { if (!disposed && token === generation) { stop(); status.textContent = '动态角色加载失败：' + error.message + '；保留静态立绘' } })
  }
  function tick(now) {
    if (disposed) return
    frameId = requestAnimationFrame(tick)
    if (!avatar) { last = now; return }
    const stage = scene() || {}, parameters = stage.meshParameters || {}, nextPose = JSON.stringify(parameters)
    if (poseKey !== nextPose) { previous = { ...avatar.getParameters() }; target = { ...parameters }; transition = now; poseKey = nextPose }
    const t = Math.max(0, Math.min(1, (now - transition) / 450)), blend = t * t * (3 - 2 * t), values = {}
    for (const id of new Set([...Object.keys(previous), ...Object.keys(target)])) if (t < 1 || Object.hasOwn(target, id)) values[id] = (previous[id] ?? defaults[id] ?? 0) + ((target[id] ?? defaults[id] ?? 0) - (previous[id] ?? defaults[id] ?? 0)) * blend
    const expression = ({ happy: 'smile' })[stage.expression] || stage.expression || 'neutral'
    avatar.setExpression(LIVE_EXPRESSIONS.includes(expression) ? expression : 'neutral')
    if (stage.meshMotion && stage.meshMotion !== motion) { motion = stage.meshMotion; avatar.play(stage.meshMotion.id) }
    avatar.setAutoIdle(stage.meshIdle !== false); avatar.setParameters(values)
    const text = engine.mode === 'play' ? engine.runtime?.text : null
    const signature = text?.speaker === stage.characterId ? JSON.stringify([engine.runtime?.nodeId, engine.runtime?.lineIndex, text]) : ''
    if (signature !== lastText) { lastText = signature; speakingUntil = signature ? now + Math.min(8000, Math.max(800, (text?.text?.length || 0) * 110)) : 0 }
    const speaking = now < speakingUntil; avatar.setSpeaking(speaking); avatar.setVoiceLevel(speaking ? .3 + .35 * Math.abs(Math.sin(now / 100)) : 0)
    pending += last == null ? 1 / 60 : Math.max(0, Math.min(.1, (now - last) / 1000)); last = now
    const steps = Math.floor(pending * 60 + 1e-9)
    if (steps) { avatar.advance(steps / 60); pending = Math.max(0, pending - steps / 60) }
  }
  sync(); frameId = requestAnimationFrame(tick)
  return { sync, async ready() { sync(); await loading; if (!avatar) throw Error('当前角色没有可播放的动态立绘'); return avatar }, dispose() { disposed = true; cancelAnimationFrame(frameId); stop(); canvas.remove(); status.remove() } }
}
