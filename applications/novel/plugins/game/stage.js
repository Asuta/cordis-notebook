import { el } from './ui.js'
import { createStageEffects } from './stage-effects.js'
import { renderText } from './text.js'
import { createAvatarRenderer, actorParameters, audioLevel } from './live2d/renderer.js'
import { createMeshRenderer } from './mesh-avatar/renderer.js'

// Both the editor preview and player use this renderer.
export function createStage(project, assetUrl) {
  const root = el('div', 'novel-stage'), backgrounds = el('div', 'novel-backgrounds'), actors = el('div', 'novel-actors')
  const visual = el('div', 'novel-visual'), world = el('div', 'novel-world'), sceneMotion = el('div', 'novel-scene-motion')
  const camera = el('div', 'novel-background-camera'), backgroundMotion = el('div', 'novel-background-motion'), weather = el('div', 'novel-weather')
  const bars = el('div', 'novel-film-bars'); weather.setAttribute('aria-hidden', 'true'); bars.setAttribute('aria-hidden', 'true')
  const shade = el('div', 'novel-stage-shade'), dialogue = el('div', 'novel-dialogue')
  const speaker = el('div', 'novel-dialogue-speaker'), text = el('div', 'novel-dialogue-text'), cue = el('span', 'novel-next-cue')
  dialogue.append(speaker, text, cue); backgroundMotion.append(backgrounds); camera.append(backgroundMotion); sceneMotion.append(camera, actors); world.append(sceneMotion, weather); visual.append(world); root.append(visual, shade, bars, dialogue)
  let lastBackground, disposed = false, currentLine = null, frame, speaking = false, speechAudio = null, speechLevel = () => 0
  const avatars = new Map(), modelRequests = new Map(), abort = new AbortController()
  function removeAvatar(id) { const avatar = avatars.get(id); avatar?.renderer?.dispose(); avatars.delete(id) }
  function loadModel(actor) {
    const key = actor.modelId + ':' + actor.modelRevision
    if (!modelRequests.has(key)) modelRequests.set(key, fetch('/api/novel/projects/' + encodeURIComponent(project.id) + '/models/' + encodeURIComponent(actor.modelId) + '?revision=' + actor.modelRevision, { signal: abort.signal }).then(async r => { if (!r.ok) throw Error('模型加载失败'); return r.json() }))
    return modelRequests.get(key)
  }
  function tick(now) {
    frame = undefined; if (disposed) return
    for (const [id, a] of avatars) { if (!a.model || !a.actor.visible) continue; const voiced = currentLine?.voiceId, talking = currentLine?.speakerId === id && (voiced ? speechAudio && !speechAudio.paused : speaking); const speech = talking ? voiced ? speechLevel() : .15 + .55 * Math.abs(Math.sin(now / 95)) : 0; if (a.model.engine === 'mesh-avatar') a.renderer.render(a.model, a.actor.modelState, now - a.started, speech); else a.renderer.render(actorParameters(a.model, a.actor.modelState, now - a.started, speech)) }
    if (avatars.size) frame = window.requestAnimationFrame(tick)
  }
  const nodes = new Map(), animations = new Set()
  const actorLayers = new Map(), effects = createStageEffects({ visual, world, sceneMotion, camera, backgroundMotion, weather, actorLayers })
  function animate(node, frames, duration) {
    if (!duration || !node.animate) return
    const a = node.animate(frames, { duration, easing: 'ease-out', fill: 'backwards' })
    animations.add(a); a.finished.catch(() => {}).finally(() => animations.delete(a))
    return a
  }
  function render(state, { instant = false, showLastSay = false } = {}) {
    if (disposed) return
    const stage = state.stage
    if (stage.backgroundId !== lastBackground) {
      lastBackground = stage.backgroundId
      const bg = el('div', 'novel-stage-bg')
      if (lastBackground) bg.style.backgroundImage = 'url("' + assetUrl(lastBackground) + '")'
      const previous = [...backgrounds.children]
      backgrounds.append(bg)
      const transition = animate(bg, [{ opacity: 0 }, { opacity: 1 }], instant ? 0 : stage.backgroundDuration)
      const removePrevious = () => previous.forEach(node => node.remove())
      if (transition) transition.finished.then(removePrevious, removePrevious)
      else removePrevious()
    }
    for (const [id] of nodes) if (!stage.portraits[id]) { removeAvatar(id); actorLayers.get(id).remove(); actorLayers.delete(id); nodes.delete(id) }
    for (const [id, actor] of Object.entries(stage.portraits)) {
      let node = nodes.get(id), fresh = !node
      if (node && !!avatars.get(id) !== !!actor.modelId) { removeAvatar(id); actorLayers.get(id).remove(); actorLayers.delete(id); nodes.delete(id); node = null; fresh = true }
      if (fresh) {
        node = el(actor.modelId ? 'canvas' : 'img', 'novel-actor' + (actor.modelId ? ' novel-avatar' : '')); node.alt = project.cast.find(c => c.id === id)?.name || '角色'; node.draggable = false; node.dataset.characterId = id
        const layer = el('div', 'novel-actor-motion'); layer.append(node); actorLayers.set(id, layer); nodes.set(id, node); actors.append(layer)
      }
      if (actor.modelId) {
        let a = avatars.get(id)
        const key = actor.modelId + ':' + actor.modelRevision
        if (!a || a.key !== key) {
          removeAvatar(id); a = { key, renderer: null, actor, started: performance.now(), model: null, nonce: actor.modelState?.nonce }; avatars.set(id, a)
          const active = a; void loadModel(actor).then(async m => { if (disposed || avatars.get(id) !== active) return; active.renderer = m.engine === 'mesh-avatar' ? createMeshRenderer(node) : createAvatarRenderer(node, assetUrl); const archive = '/api/novel/projects/' + encodeURIComponent(project.id) + '/models/' + encodeURIComponent(m.id) + '/archive.mavatar?revision=' + m.revision; await active.renderer.setModel(m, archive); if (disposed || avatars.get(id) !== active) return; active.model = m; node.dataset.modelEngine = m.engine || 'standrig'; node.style.aspectRatio = m.rig.stage.width + '/' + m.rig.stage.height; if (m.engine === 'mesh-avatar') active.renderer.render(m, actor.modelState); else active.renderer.render(actorParameters(m, actor.modelState)); }).catch(e => { if (!disposed && e.name !== 'AbortError') { node.dataset.modelError = e.message; node.setAttribute('aria-label', e.message); if (actor.portraitId) { node.style.backgroundImage = 'url(' + assetUrl(actor.portraitId) + ')'; node.style.backgroundSize = 'contain' } } })
        }
        a.actor = actor; if (a.nonce !== actor.modelState?.nonce || instant) { a.started = performance.now(); a.nonce = actor.modelState?.nonce; a.renderer?.reset() }
        if (frame === undefined) frame = window.requestAnimationFrame(tick)
      }
      const src = actor.portraitId ? assetUrl(actor.portraitId) : ''
      if (!actor.modelId && node.getAttribute('src') !== src) { if (src) node.src = src; else node.removeAttribute('src') }
      node.style.transition = instant ? 'none' : 'left ' + actor.duration + 'ms ease, bottom ' + actor.duration + 'ms ease, transform ' + actor.duration + 'ms ease, opacity ' + actor.duration + 'ms ease'
      node.style.left = actor.x + '%'; node.style.bottom = actor.y + '%'
      node.style.transform = 'translateX(-50%) scale(' + actor.scale + ')'
      node.style.opacity = actor.visible && (src || actor.modelId) ? actor.opacity : 0
      actorLayers.get(id).style.transformOrigin = actor.x + '% ' + (100 - actor.y) + '%'
      if (fresh && !instant) animate(node, [{ opacity: 0 }, { opacity: actor.opacity }], actor.duration)
    }
    const line = state.current?.type === 'say' ? state.current : showLastSay ? state.lastSay : null
    currentLine = line; root.dataset.dialogueMode = line?.mode || 'dialogue'
    dialogue.hidden = !line
    if (line) {
      const character = project.cast.find(c => c.id === line.speakerId)
      speaker.textContent = character?.name || '旁白'; speaker.style.color = character?.color || '#e7cb9a'
      const style = line.textStyle
      const ratio = (style?.size || 100) / 100, large = line.mode === 'monologue'
      text.style.color = style?.color || ''; text.style.fontSize = `clamp(${(large ? 18 : 13) * ratio}px,${(large ? 2.2 : 1.7) * ratio}cqw,${(large ? 32 : 25) * ratio}px)`
      text.style.textAlign = style?.align || ''; text.style.fontWeight = style?.bold ? '700' : ''; text.style.fontStyle = style?.italic ? 'italic' : ''
      renderText(text, line); cue.textContent = '点击继续 ▸'
    }
    effects.render(stage, instant)
  }
  return { root, render, dialogue, text, cue, setSpeech(audio) { speechLevel.dispose?.(); speechAudio = audio; speechLevel = audio ? audioLevel(audio) : () => 0 }, reveal(count = Infinity) { speaking = Number.isFinite(count); if (currentLine) renderText(text, currentLine, count) }, dispose() { disposed = true; abort.abort(); window.cancelAnimationFrame(frame); for (const id of avatars.keys()) removeAvatar(id); speechLevel.dispose?.(); effects.dispose(); for (const a of animations) a.cancel() } }
}
