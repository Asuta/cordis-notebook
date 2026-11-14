import { createDialoguePlayer } from './player.js'

function el(tag, className = '', text) {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export default function (ctx) {
  const engine = ctx.narrative, ui = ctx.narrativeUI, observers = new Set(), mounts = new Set()
  engine.observe(ctx, event => { for (const callback of [...observers]) callback(event) })
  function track(dispose) {
    let active = true
    const cleanup = () => { if (!active) return; active = false; mounts.delete(cleanup); dispose() }
    mounts.add(cleanup); return cleanup
  }
  ui.registerSurface(ctx, { id: 'dialogue', order: 20, mount(container) {
    const root = el('section', 'ne-dialogue')
    root.setAttribute('aria-label', '故事对白')
    const text = el('p', 'ne-dialogue-text'), speaker = el('div', 'ne-dialogue-speaker')
    const liveText = el('div', 'ne-dialogue-reading')
    liveText.setAttribute('aria-live', 'polite'); liveText.setAttribute('aria-atomic', 'true')
    liveText.append(speaker, text)
    const choices = el('div', 'ne-dialogue-choices'), footer = el('div', 'ne-dialogue-footer')
    root.append(liveText, choices, footer); container.append(root)
    const player = createDialoguePlayer(engine, render)
    const button = (label, data) => {
      const node = el('button', 'ne-dialogue-button', label)
      node.type = 'button'; Object.assign(node.dataset, data); return node
    }
    function render() {
      const state = player.view()
      root.hidden = !state
      if (!state) return
      root.classList.toggle('ne-dialogue-chat-skin', state.style === 'chat')
      const name = engine.project.characters.find(item => item.id === state.text?.speaker)?.name
      const speakerText = state.text?.speaker ? name || state.text.speaker : '旁白'
      if (speaker.textContent !== speakerText) speaker.textContent = speakerText
      const body = state.text?.text || (state.playing ? '' : '在右侧添加对白，为这一幕写下第一句话。')
      if (text.textContent !== body) text.textContent = body
      choices.replaceChildren(); footer.replaceChildren()
      for (const choice of state.choices) {
        const control = button(choice.text || '未命名选项', { choice: choice.id })
        control.disabled = !state.playing || state.busy || !choice.available
        control.title = choice.reason || ''
        if (!choice.available) control.append(el('small', '', choice.reason))
        choices.append(control)
      }
      const progress = state.node.lines.length ? (state.lineIndex + 1) + ' / ' + state.node.lines.length : ''
      footer.append(el('span', 'ne-dialogue-meta', state.playing ? (state.ended ? '故事已结束 · ' + state.node.title : progress) : '编辑预览' + (progress ? ' · ' + progress : '')))
      if (state.playing && !state.ended && !(state.atEnd && state.node.choices.length)) {
        const control = button(state.busy ? '请稍候…' : state.atEnd && !state.node.next ? '读完这一幕 ✓' : '继续 →', { advance: 'true' })
        control.classList.add('ne-dialogue-continue'); control.disabled = state.busy
        footer.append(control)
      }
    }
    const click = event => {
      const control = event.target.closest?.('button')
      if (!control || !root.contains(control) || control.disabled) return
      const task = control.dataset.choice ? () => player.choose(control.dataset.choice) : () => player.advance()
      Promise.resolve().then(task).catch(error => engine.error(error.message))
    }
    root.addEventListener('click', click); observers.add(render); render()
    return track(() => { observers.delete(render); root.removeEventListener('click', click); player.dispose(); root.remove() })
  } })
  ui.registerPanel(ctx, { id: 'dialogue', label: '对白外观', icon: 'MessageSquare', order: 45, render(container) {
    const root = el('fieldset', 'ne-dialogue-settings ne-stack'), label = el('label', 'ne-field', '对白显示风格')
    const select = el('select', 'ne-select')
    for (const [value, text] of [['novel', '视觉小说 · 通栏对白'], ['chat', '聊天气泡 · 轻盈圆角']]) { const option = el('option', '', text); option.value = value; select.append(option) }
    select.value = engine.project.settings.dialogueStyle
    const change = () => { try { engine.update(project => { project.settings.dialogueStyle = select.value }, { render: false }) } catch (error) { engine.error(error.message) } }
    select.addEventListener('change', change)
    label.append(select)
    root.append(label, el('p', 'ne-muted', '外观应用于固定剧情对白。自由聊天节点的界面由 AI 对话插件提供。'))
    const render = () => { root.disabled = engine.mode !== 'edit' || engine.held; select.value = engine.project.settings.dialogueStyle }
    observers.add(render); render(); container.append(root)
    return track(() => { observers.delete(render); select.removeEventListener('change', change); root.remove() })
  } })
  ctx.effect(() => () => { for (const cleanup of [...mounts]) cleanup(); observers.clear() })
}
