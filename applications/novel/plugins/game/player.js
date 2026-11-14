import { passes } from './model.js'
import { initialState, advance, choose, previewState, restoreCheckpoint, prepareProject, clone } from './engine.js'
import { createStage } from './stage.js'
import { el, button, field, input } from './ui.js'

export function createPlayer(source, sdk, { startSceneId, startCommandId, previewValues, onExit, assetUrl, onPosition }) {
  const project = prepareProject(source), root = el('div', 'novel-player novel-cinema')
  const stage = createStage(project, assetUrl), top = el('div', 'novel-player-top'), story = el('div', 'novel-player-story')
  const choices = el('div', 'novel-player-choices'), toolbar = el('div', 'novel-reading-tools'), overlay = el('div', 'novel-player-overlay')
  const toast = el('div', 'novel-player-message'); toast.setAttribute('role', 'status'); overlay.hidden = true
  const music = el('audio'), sound = el('audio'); music.loop = true; music.preload = sound.preload = 'auto'
  const voice = el('audio'); voice.preload = 'auto'; stage.setSpeech(voice); let lastVoice = ''
  const key = 'novel-v2-' + project.id + '-'
  const read = (name, fallback) => { try { return JSON.parse(sdk.storage.local.getItem(key + name)) ?? fallback } catch { return fallback } }
  const write = (name, data) => { try { sdk.storage.local.setItem(key + name, JSON.stringify(data)); return true } catch { message('本机存储已满，未能保存进度'); return false } }
  const profile = { read: {}, endings: [], globals: {}, ...read('profile', {}) }
  const settings = { textSpeed: 28, autoDelay: 1800, musicVolume: .6, soundVolume: .7, ...read('settings', {}) }
  let state, startupError, resumed = false, history = [], backlog = [], disposed = false, textTimer, stepTimer, fadeTimer, messageTimer, auto = false, skip = false, complete = true, hidden = false, wasRead = false, lastSound = '', musicTarget = ''
  function message(value) { clearTimeout(messageTimer); toast.textContent = value; messageTimer = setTimeout(() => { toast.textContent = '' }, 4500) }
  function readingKey() { let hash = 2166136261; for (const char of state.current?.text || '') hash = Math.imul(hash ^ char.codePointAt(0), 16777619); return state.sceneId + ':' + state.current?.id + ':' + (hash >>> 0).toString(36) }
  function mergeGlobals() {
    for (const v of project.variables) if (v.scope === 'global' && typeof profile.globals[v.id] === typeof v.initial) state.values[v.id] = profile.globals[v.id]
  }
  function persistProfile() {
    for (const v of project.variables) if (v.scope === 'global') profile.globals[v.id] = state.values[v.id]
    write('profile', profile)
  }
  function payload() { return { revision: project.revision, state: clone(state), history: clone(history.slice(-60)), backlog: clone(backlog.slice(-250)), savedAt: new Date().toISOString(), sceneTitle: project.scenes.find(s => s.id === state.sceneId)?.title, excerpt: state.current?.text?.slice(0, 70) || (state.ended ? '故事结局' : '分支选择') } }
  const slotLabel = slot => slot === 'auto' ? '自动存档' : slot === 'quick' ? '快捷存档' : '存档 ' + slot
  function save(slot, announce = true) { const ok = write('slot-' + slot, payload()); if (announce && ok) message('已保存到' + slotLabel(slot)) }
  function load(slot) {
    try {
      const data = read('slot-' + slot, null)
      if (!data) return message('没有可读取的' + slotLabel(slot))
      const next = restoreCheckpoint(project, data)
      history = validHistory(data)
      state = next; backlog = data.backlog || []; mergeGlobals(); closePanel(); auto = skip = false; sound.pause(); render(true); message('已读取' + slotLabel(slot))
    } catch (error) { message(error.message || '无法读取存档') }
  }
  function clearTimers() { clearTimeout(textTimer); clearTimeout(stepTimer) }
  function syncAudio(instant) {
    const currentVoice = state.current?.type === 'say' ? state.current.voiceId || '' : '', voiceToken = currentVoice ? state.sceneId + ':' + state.current.id + ':' + currentVoice : ''
    if (instant || voiceToken !== lastVoice) { voice.pause(); voice.removeAttribute('src'); if (!instant && currentVoice) { voice.src = assetUrl(currentVoice); voice.volume = settings.soundVolume; voice.play().catch(() => {}) } }
    lastVoice = voiceToken
    clearInterval(fadeTimer)
    const m = state.stage.music, target = Math.max(0, Math.min(1, m.volume * settings.musicVolume)), changed = musicTarget !== m.assetId
    const fade = (to, done) => {
      const from = music.volume, began = Date.now(), duration = instant ? 0 : m.duration
      if (!duration) { music.volume = to; done?.(); return }
      fadeTimer = setInterval(() => { const f = Math.min(1, (Date.now() - began) / duration); music.volume = Math.max(0, Math.min(1, from + (to - from) * f)); if (f === 1) { clearInterval(fadeTimer); done?.() } }, 30)
    }
    if (!m.assetId) fade(0, () => { music.pause(); music.removeAttribute('src'); musicTarget = '' })
    else {
      if (changed) { music.src = assetUrl(m.assetId); musicTarget = m.assetId; music.volume = 0 }
      music.play().catch(() => {}); fade(target)
    }
    const effect = state.stage.sound, token = effect && effect.id + ':' + effect.nonce
    if (!instant && effect?.assetId && token !== lastSound) { sound.src = assetUrl(effect.assetId); sound.volume = effect.volume * settings.soundVolume; sound.play().catch(() => {}) }
    lastSound = token
  }
  function schedule() {
    clearTimeout(stepTimer)
    if (disposed || !overlay.hidden || hidden || !complete) return
    if (state.current?.type === 'wait') stepTimer = setTimeout(next, Math.max(16, state.current.duration))
    else if (state.current?.type === 'say' && (auto || skip && wasRead)) stepTimer = setTimeout(next, skip ? 70 : settings.autoDelay + Array.from(state.current.text).length * 25)
    else if (skip) { skip = false; updateTools() }
  }
  function reveal() {
    clearTimeout(textTimer); complete = true; stage.reveal()
    if (state.current?.type === 'say') { profile.read[readingKey()] = true; persistProfile() }
    schedule()
  }
  function render(instant = false) {
    if (disposed) return
    clearTimers(); stage.render(state, { instant }); syncAudio(instant)
    story.textContent = project.title + ' / ' + (project.scenes.find(s => s.id === state.sceneId)?.title || '')
    onPosition?.({ sceneId: state.sceneId, commandId: state.current?.id, values: clone(state.values) })
    choices.replaceChildren(); complete = true
    const current = state.current
    wasRead = !!profile.read[readingKey()]
    if (current?.type === 'say') {
      const chars = Array.from(current.text || '……'); let count = 0
      if (!settings.textSpeed || skip && wasRead || instant) reveal()
      else {
        complete = false; stage.reveal(0)
        const tick = () => { if (disposed) return; stage.reveal(++count); if (count < chars.length) textTimer = setTimeout(tick, settings.textSpeed); else reveal() }
        textTimer = setTimeout(tick, settings.textSpeed)
      }
    } else if (current?.type === 'choice') {
      const available = availableChoices()
      for (const c of available) choices.append(button(c.text, () => transition(() => choose(project, state, c.id)), 'novel-player-choice'))
      if (!available.length) choices.append(el('p', '', '没有可用选项，请返回编辑器检查分支条件。'))
    } else if (state.ended) {
      if (!profile.endings.includes(state.sceneId)) { profile.endings.push(state.sceneId); persistProfile() }
      choices.append(el('div', 'novel-ending-title', '故事暂告一段落'), el('p', 'novel-ending-subtitle', project.scenes.find(s => s.id === state.sceneId)?.title), button('重新开始', restart, 'novel-player-choice'))
    }
    save('auto', false); updateTools(); schedule()
  }
  function transition(action, strict = false) {
    if (disposed || !overlay.hidden) { if (strict) throw Error('播放器已关闭或面板尚未关闭'); return }
    try {
      const before = { state: clone(state), backlogLength: backlog.length }, result = action()
      history.push(before); if (history.length > 60) history.shift()
      state = result
      recordLine()
      if (backlog.length > 250) { const removed = backlog.length - 250; backlog = backlog.slice(-250); for (const h of history) h.backlogLength = Math.max(0, h.backlogLength - removed) }
      persistProfile(); render()
    } catch (error) { auto = skip = false; message(error.message); if (strict) throw error }
  }
  function next() {
    if (hidden) { hidden = false; root.classList.remove('dialogue-hidden'); schedule(); return }
    if (!complete) { reveal(); return }
    if (['say', 'wait'].includes(state.current?.type)) transition(() => advance(project, state))
  }
  function rollback(target = history.length - 1) {
    while (target >= 0 && history[target].state.current?.type === 'wait') target--
    if (target < 0) return message('已经到达本次游玩的起点')
    const entry = history[target]; state = clone(entry.state); backlog = backlog.slice(0, entry.backlogLength); history = history.slice(0, target)
    mergeGlobals(); auto = skip = false; sound.pause(); render(true)
  }
  function recordLine() {
    if (state.current?.type === 'say') backlog.push({ visit: crypto.randomUUID(), sceneId: state.sceneId, commandId: state.current.id, speakerId: state.current.speakerId, text: state.current.text })
  }
  function restart() { const next = advance(project, initialState(project, project.startSceneId, profile.globals)); history = []; backlog = []; auto = skip = false; state = next; recordLine(); persistProfile(); closePanel(); render() }
  function availableChoices() {
    return state.current?.type === 'choice' ? project.scenes.find(s => s.id === state.sceneId).choices.filter(c => passes(c.condition, state.values)) : []
  }
  function requireState() {
    if (disposed) throw Error('播放器已关闭，请重新启动试玩')
    if (startupError) throw startupError
    if (!state?.current) throw Error('试玩尚未就绪，请重新启动试玩')
  }
  function getStatus() {
    requireState()
    return { ...clone(state), projectId: project.id, revision: project.revision, sceneTitle: project.scenes.find(s => s.id === state.sceneId)?.title,
      speakerName: project.cast.find(c => c.id === state.current.speakerId)?.name || '旁白', textComplete: complete,
      choices: availableChoices().map(({ id, text, targetId }) => ({ id, text, targetId })), historyLength: history.length,
      canRollback: history.some(h => h.state.current?.type !== 'wait'), unlockedEndings: [...profile.endings],
      auto, skip, dialogueHidden: hidden, panelOpen: !overlay.hidden }
  }
  function takeControl() {
    requireState(); auto = skip = hidden = false; clearTimers(); updateTools()
    root.classList.remove('dialogue-hidden'); overlay.hidden = true; overlay.replaceChildren()
  }
  function advanceControlled() {
    requireState()
    if (state.ended) throw Error('故事已结束，请重新开始或退出试玩')
    if (state.current.type === 'choice') throw Error('当前需要选择选项，请使用 choose 和可用选项的 choiceId')
    if (!['say', 'wait'].includes(state.current.type)) throw Error('当前位置不能推进')
    takeControl()
    if (!complete) reveal()
    transition(() => advance(project, state), true)
    return getStatus()
  }
  function chooseControlled(choiceId) {
    requireState()
    if (state.current.type !== 'choice') throw Error('当前不在选择位置，请先推进对白')
    if (!availableChoices().some(c => c.id === choiceId)) throw Error('选项不存在或条件未满足，请读取当前可用选项')
    takeControl(); transition(() => choose(project, state, choiceId), true)
    return getStatus()
  }
  function rollbackControlled() {
    requireState()
    if (!history.some(h => h.state.current?.type !== 'wait')) throw Error('已经到达本次游玩的起点')
    takeControl(); rollback()
    return getStatus()
  }
  function restartControlled() { takeControl(); restart(); return getStatus() }
  function validHistory(data) {
    return (Array.isArray(data.history) ? data.history : []).map(h => ({ state: h.state, backlogLength: h.backlogLength ?? h.backlog?.length ?? 0 })).filter(h => {
      try { restoreCheckpoint(project, { revision: project.revision, state: h.state }); return Number.isInteger(h.backlogLength) && h.backlogLength >= 0 && h.backlogLength <= (data.backlog || []).length } catch { return false }
    }).slice(-60)
  }
  function closePanel() { overlay.hidden = true; overlay.replaceChildren(); schedule() }
  function openPanel(name) {
    clearTimers(); sound.pause(); if (!complete) reveal(); clearTimeout(stepTimer)
    overlay.hidden = false; overlay.replaceChildren()
    const box = el('section', 'novel-reader-panel', el('div', 'novel-section-heading', el('h2', '', name), button('关闭 ×', closePanel, 'novel-secondary')))
    if (name === '存读档') {
      const grid = el('div', 'novel-save-grid')
      for (const slot of ['auto', 'quick', 1, 2, 3, 4, 5, 6]) {
        const data = read('slot-' + slot, null), card = el('div', 'novel-save-card')
        card.append(el('strong', '', slotLabel(slot)), el('small', '', data ? new Date(data.savedAt).toLocaleString() : '空存档'), el('p', '', data ? data.sceneTitle + ' · ' + data.excerpt : '保存当前阅读位置'))
        const row = el('div', 'novel-control-row')
        if (slot !== 'auto') row.append(button('保存', () => { if (!data || confirm('覆盖这个存档？')) { save(slot); openPanel(name) } }, 'novel-secondary'))
        const loadButton = button('读取', () => load(slot), 'novel-accent'); loadButton.disabled = !data || data.revision !== project.revision; row.append(loadButton)
        if (data && data.revision !== project.revision) card.append(el('small', '', '作品已更新，此存档不可用'))
        card.append(row); grid.append(card)
      }
      box.append(grid)
    } else if (name === '历史记录') {
      if (!backlog.length) box.append(el('p', '', '还没有阅读记录'))
      for (const entry of backlog) {
        const row = el('div', 'novel-history-line', el('strong', '', project.cast.find(c => c.id === entry.speakerId)?.name || '旁白'), el('p', '', entry.text))
        // History captures the state before leaving this visit, including its backlog row.
        const at = history.findLastIndex(h => entry.visit && backlog[h.backlogLength - 1]?.visit === entry.visit && h.state.current?.type === 'say')
        if (at >= 0) row.append(button('回到这里', () => { closePanel(); rollback(at) }, 'novel-inline-action'))
        box.append(row)
      }
    } else if (name === '阅读设置') {
      const slider = (label, id, min, max, step) => {
        const control = input(settings[id], value => { settings[id] = Number(value); write('settings', settings); if (id.includes('Volume')) syncAudio(true) }); control.type = 'range'; control.min = min; control.max = max; control.step = step; control.value = String(settings[id])
        return field(label, control)
      }
      box.append(slider('文字速度（0 为立即显示）', 'textSpeed', 0, 100, 1), slider('自动翻页等待（毫秒）', 'autoDelay', 500, 6000, 100), slider('音乐音量', 'musicVolume', 0, 1, .05), slider('音效音量', 'soundVolume', 0, 1, .05))
    } else if (name === '状态与解锁') {
      for (const v of project.variables) box.append(el('p', 'novel-state-value', v.name + '：' + state.values[v.id] + (v.scope === 'global' ? ' · 跨周目保留' : '')))
      box.append(el('h3', '', '已解锁结局 · ' + profile.endings.length + ' / ' + project.scenes.filter(s => s.ending).length))
      for (const s of project.scenes.filter(s => s.ending)) box.append(el('p', '', profile.endings.includes(s.id) ? '◆ ' + s.title : '◇ 未解锁'))
    }
    overlay.append(box)
  }
  const autoButton = button('自动', () => { auto = !auto; skip = false; updateTools(); schedule() }, 'novel-player-tool')
  const skipButton = button('已读快进', () => { skip = !skip; auto = false; if (skip && wasRead && !complete) reveal(); updateTools(); schedule() }, 'novel-player-tool')
  function updateTools() { autoButton.classList.toggle('active', auto); skipButton.classList.toggle('active', skip) }
  toolbar.append(button('回退', () => rollback(), 'novel-player-tool'), button('历史', () => openPanel('历史记录'), 'novel-player-tool'), autoButton, skipButton, button('快存', () => save('quick'), 'novel-player-tool'), button('快读', () => load('quick'), 'novel-player-tool'), button('存读档', () => openPanel('存读档'), 'novel-player-tool'), button('隐藏', () => { hidden = true; root.classList.add('dialogue-hidden'); clearTimeout(stepTimer) }, 'novel-player-tool'), button('设置', () => openPanel('阅读设置'), 'novel-player-tool'))
  top.append(story, el('div', 'novel-player-actions', button('状态', () => openPanel('状态与解锁'), 'novel-player-tool'), button('重新开始', restart, 'novel-player-tool'), button('退出试玩', onExit, 'novel-player-tool')))
  stage.root.append(top, choices, toolbar, overlay, toast); root.append(stage.root, music, sound, voice)
  stage.dialogue.addEventListener('click', next)
  stage.root.addEventListener('click', event => { if (hidden && !event.target.closest('button')) next(); else if (music.paused && musicTarget) music.play().catch(() => {}) })
  const keydown = event => {
    if (disposed || event.target?.closest?.('input,textarea,select')) return
    if (event.target?.closest?.('button') && [' ', 'Enter'].includes(event.key)) return
    if (event.key === 'Escape') { event.preventDefault(); if (!overlay.hidden) closePanel(); else if (hidden) next(); else openPanel('阅读设置') }
    if (!overlay.hidden) return
    if ([' ', 'Enter', 'ArrowRight'].includes(event.key)) { event.preventDefault(); next() }
    if (['ArrowLeft', 'Backspace'].includes(event.key)) { event.preventDefault(); rollback() }
  }
  window.addEventListener('keydown', keydown)
  try {
    if (startCommandId) {
      state = previewState(project, startSceneId, startCommandId, previewValues)
      if (state.current?.type === 'jump') state.index--
      if (!['say', 'wait', 'choice'].includes(state.current?.type)) state = advance(project, state)
    }
    else if (!startSceneId) {
      const data = read('slot-auto', null)
      try { state = restoreCheckpoint(project, data); history = validHistory(data); backlog = data.backlog || []; mergeGlobals(); resumed = true } catch {
        state = advance(project, initialState(project, project.startSceneId, profile.globals))
        try {
          const old = JSON.parse(sdk.storage.local.getItem('play-' + project.id))
          if (old?.revision === project.revision && project.scenes.some(s => s.id === old.sceneId)) {
            const target = project.scenes.find(s => s.id === old.sceneId).commands.filter(c => c.type === 'say')[old.lineIndex]
            state = target ? previewState(project, old.sceneId, target.id, old.values) : advance(project, initialState(project, old.sceneId, profile.globals))
          }
        } catch { /* Incompatible legacy checkpoint starts at the beginning. */ }
      }
    } else {
      const initial = initialState(project, startSceneId, profile.globals)
      Object.assign(initial.values, previewValues || {}); state = advance(project, initial)
    }
    if (!backlog.length) recordLine()
    persistProfile(); render(resumed)
  } catch (error) { startupError = error; message(error.message) }
  return { root, getState: () => clone(state), getStatus, advance: advanceControlled, choose: chooseControlled, rollback: rollbackControlled, restart: restartControlled, dispose() { disposed = true; clearTimers(); clearInterval(fadeTimer); clearTimeout(messageTimer); window.removeEventListener('keydown', keydown); music.pause(); sound.pause(); voice.pause(); stage.dispose() } }
}
