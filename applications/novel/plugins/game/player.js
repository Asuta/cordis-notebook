import { passes, followChoice } from './model.js'
import { el, button } from './ui.js'

export function createPlayer(project, sdk, { startSceneId, onExit, assetUrl }) {
  const key = 'play-' + project.id
  const initial = () => ({ sceneId: startSceneId || project.startSceneId, lineIndex: 0, values: Object.fromEntries(project.variables.map(v => [v.id, v.initial])) })
  let state = initial(), sound = true, lastMusic = null
  if (!startSceneId || startSceneId === project.startSceneId) {
    try {
      const saved = JSON.parse(sdk.storage.local.getItem(key))
      if (saved?.revision === project.revision && project.scenes.some(s => s.id === saved.sceneId) && saved.values && typeof saved.values === 'object') state = { sceneId: saved.sceneId, lineIndex: Math.max(0, saved.lineIndex | 0), values: saved.values }
    } catch { /* an invalid local checkpoint starts a new game */ }
  }
  const root = el('div', 'novel-player'), stage = el('div', 'novel-stage'), bg = el('div', 'novel-stage-bg')
  const left = el('img', 'novel-portrait left'), right = el('img', 'novel-portrait right'), shade = el('div', 'novel-stage-shade')
  const top = el('div', 'novel-player-top'), story = el('div', 'novel-player-story'), vars = el('div', 'novel-player-vars')
  const dialogue = el('div', 'novel-dialogue'), speaker = el('div', 'novel-dialogue-speaker'), text = el('div', 'novel-dialogue-text'), cue = el('span', 'novel-next-cue', '点击继续 →')
  const choices = el('div', 'novel-player-choices'), audio = el('audio'); audio.loop = true; audio.preload = 'auto'
  const save = () => { try { sdk.storage.local.setItem(key, JSON.stringify({ ...state, revision: project.revision })) } catch {} }
  const setPortrait = (element, id) => { const character = project.cast.find(c => c.id === id); element.hidden = !character?.portraitId; if (character?.portraitId) { element.src = assetUrl(character.portraitId); element.alt = character.name } }
  const scene = () => project.scenes.find(s => s.id === state.sceneId)
  function render() {
    const current = scene()
    if (!current) { text.textContent = '场景已被删除，请返回编辑器检查剧情。'; return }
    const image = current.backgroundId ? assetUrl(current.backgroundId) : ''
    bg.style.backgroundImage = image ? 'url("' + image + '")' : ''
    setPortrait(left, current.leftCharacterId); setPortrait(right, current.rightCharacterId)
    story.textContent = project.title + '  /  ' + current.title
    vars.replaceChildren(...project.variables.filter(v => v.kind === 'affinity').map(v => el('span', '', v.name + ' ' + (state.values[v.id] ?? 0))))
    if (lastMusic !== current.musicId) {
      lastMusic = current.musicId; audio.pause(); audio.removeAttribute('src')
      if (lastMusic) { audio.src = assetUrl(lastMusic); if (sound) audio.play().catch(() => {}) }
    }
    choices.replaceChildren()
    const line = current.lines[state.lineIndex]
    dialogue.hidden = !line
    if (line) {
      const character = project.cast.find(c => c.id === line.speakerId)
      speaker.textContent = character?.name || '旁白'; speaker.style.color = character?.color || '#e7cb9a'
      text.textContent = line.text || '……'; cue.textContent = state.lineIndex === current.lines.length - 1 ? '查看选项 →' : '点击继续 →'
    } else if (current.ending) {
      choices.append(el('div', 'novel-ending-title', '故事暂告一段落'), button('从头再玩', restart, 'novel-player-choice'))
    } else {
      const visible = current.choices.filter(c => passes(c.condition, state.values))
      for (const c of visible) choices.append(button(c.text, () => {
        if (!project.scenes.some(s => s.id === c.targetId)) return alert('这个选项尚未连接到有效场景')
        state.values = followChoice(c, state.values, project.variables); state.sceneId = c.targetId; state.lineIndex = 0; save(); render()
      }, 'novel-player-choice'))
      if (!visible.length) choices.append(el('p', '', '这里还没有可用选项，请在编辑器中检查分支条件。'))
    }
    save()
  }
  function restart() { state = initial(); lastMusic = null; save(); render() }
  const musicButton = button('♫ 音乐开启', () => { sound = !sound; musicButton.textContent = sound ? '♫ 音乐开启' : '♫ 音乐关闭'; if (sound) audio.play().catch(() => {}); else audio.pause() }, 'novel-player-tool')
  top.append(story, el('div', 'novel-player-actions', musicButton, button('↻ 重来', restart, 'novel-player-tool'), button('退出试玩', () => { audio.pause(); onExit() }, 'novel-player-tool')))
  dialogue.append(speaker, text, cue)
  dialogue.addEventListener('click', () => { if (sound && lastMusic && audio.paused) audio.play().catch(() => {}); const current = scene(); if (current && state.lineIndex < current.lines.length) { state.lineIndex++; render() } })
  stage.append(bg, left, right, shade, top, vars, choices, dialogue)
  root.append(stage, el('p', 'novel-player-hint', '阅读进度自动保存在这台设备上。音乐需要点击播放后才会响起。'), audio)
  render()
  return { root, dispose: () => audio.pause() }
}
