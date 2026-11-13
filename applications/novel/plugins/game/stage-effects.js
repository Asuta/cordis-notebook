import { el } from './ui.js'
import { cameraDefaults, filterDefaults, frameTransform } from './effects.js'

export function createStageEffects({ visual, world, sceneMotion, camera, backgroundMotion, weather, actorLayers }) {
  const tracks = new Map()
  const transitions = new Map()
  let weatherKey = '', lastShake = '', shakeHandle
  const stop = entry => { entry.handle?.cancel(); entry.node.style.transform = ''; entry.node.style.opacity = '' }
  const cameraTransform = c => `translate(${c.x}%, ${c.y}%) rotate(${c.rotation}deg) scale(${c.scale})`
  const filterValue = f => `brightness(${f.brightness}) contrast(${f.contrast}) saturate(${f.saturation}) grayscale(${f.grayscale}) sepia(${f.sepia}) blur(${f.blur}px) hue-rotate(${f.hue}deg)`
  function transition(key, node, property, effect, format, instant) {
    const signature = JSON.stringify(effect), old = transitions.get(key)
    node.style[property] = format(effect)
    if (old?.signature === signature && !instant) return
    old?.handle?.cancel()
    let handle
    if (!instant && effect.from && effect.duration && node.animate) {
      handle = node.animate([{[property]:format(effect.from)},{[property]:format(effect)}], {duration:effect.duration,easing:effect.easing || 'ease-in-out'})
      handle.finished?.catch(() => {})
    }
    transitions.set(key,{signature,handle})
  }
  function render(stage, instant) {
    const c = stage.camera || cameraDefaults(), f = stage.filter || filterDefaults()
    transition('camera',camera,'transform',c,cameraTransform,instant)
    transition('filter',visual,'filter',f,filterValue,instant)
    const w = stage.weather || { effect: 'none', intensity: .5, speed: 1 }, nextWeather = JSON.stringify(w)
    if (weatherKey !== nextWeather) {
      weatherKey = nextWeather; weather.replaceChildren(); weather.dataset.effect = w.effect
      if (w.effect !== 'none') for (let i = 0; i < Math.ceil(w.intensity * 90); i++) {
        const particle = el('i', 'novel-particle'), r = ((i * 47 + 13) % 101) / 100
        particle.style.left = ((i * 61 + 7) % 110 - 5) + '%'
        particle.style.setProperty('--fall-duration', ((w.effect === 'rain' ? .65 : 6) + r * (w.effect === 'rain' ? .4 : 6)) / w.speed + 's')
        particle.style.setProperty('--fall-delay', -r * 12 / w.speed + 's')
        particle.style.setProperty('--drift', (w.effect === 'rain' ? -5 : 5 + r * 15) + 'cqw')
        particle.style.opacity = .25 + r * .6
        particle.style.setProperty('--particle-scale', .5 + r)
        weather.append(particle)
      }
    }
    weather.classList.toggle('paused', instant)
    const wanted = new Set()
    for (const [key, track] of Object.entries(stage.animations || {})) {
      const node = track.target === 'background' ? backgroundMotion : track.target === 'stage' ? sceneMotion : actorLayers.get(track.characterId)
      if (!node || track.target === 'character' && !stage.portraits[track.characterId]?.visible) continue
      wanted.add(key)
      const signature = JSON.stringify(track), old = tracks.get(key), a = track.animation
      if (old?.signature === signature && old.node === node && (old.instant === instant || old.instant && !instant && a.iterations > 0)) continue
      if (old) stop(old)
      const frames = a.keyframes.map(f => ({ offset: f.at, transform: frameTransform(f), opacity: f.opacity, easing: f.easing }))
      let handle
      if (!instant && node.animate) handle = node.animate(frames, { duration: a.duration, iterations: a.iterations || Infinity, fill: 'both' })
      else { const frame = a.keyframes[a.iterations ? a.keyframes.length - 1 : 0]; node.style.transform = frameTransform(frame); node.style.opacity = frame.opacity }
      handle?.finished?.catch(() => {})
      tracks.set(key, { signature, node, handle, instant })
    }
    for (const [key, entry] of tracks) if (!wanted.has(key)) { stop(entry); tracks.delete(key) }
    const token = stage.shake && stage.shake.id + ':' + stage.shake.nonce
    if (instant || token !== lastShake) {
      shakeHandle?.cancel(); shakeHandle = null
      if (!instant && stage.shake?.strength && world.animate) {
        const s = stage.shake, count = Math.max(2, Math.ceil(s.duration / 1000 * s.frequency))
        const frames = Array.from({ length: count + 1 }, (_, i) => ({ transform: i === 0 || i === count ? 'translate(0,0)' : `translate(${(i % 2 ? 1 : -1) * s.strength}%, ${Math.sin(i * 2.4) * s.strength * .5}%)` }))
        shakeHandle = world.animate(frames, { duration: s.duration, easing: 'linear' })
        shakeHandle.finished?.catch(() => {})
      }
      lastShake = token
    }
  }
  return { render, dispose() { shakeHandle?.cancel(); for (const t of tracks.values()) stop(t); for (const t of transitions.values()) t.handle?.cancel(); tracks.clear(); transitions.clear(); weather.replaceChildren() } }
}
