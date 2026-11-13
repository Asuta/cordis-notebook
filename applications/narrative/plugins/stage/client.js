const EXPRESSIONS = [['neutral', '平静'], ['happy', '开心'], ['sad', '难过']]
const clamp = (value, min, max, fallback) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function options(select, entries, value) {
  select.replaceChildren(...entries.map(([id, label]) => {
    const option = element('option', '', label)
    option.value = id
    return option
  }))
  select.value = value || ''
}

function picture(image, url, alt = '') {
  image.alt = alt
  if (!url) { image.hidden = true; image.removeAttribute('src'); return }
  if (image.getAttribute('src') === url) return
  image.hidden = false
  image.src = url
}

/** 舞台与缩略预览共用同一构图，所有素材都经由业务服务解析。 */
function createStage(engine, getStage) {
  const root = element('div', 'ne-stage')
  root.setAttribute('role', 'img')
  const background = element('img', 'ne-stage-picture ne-stage-background')
  const atmosphere = element('div', 'ne-stage-atmosphere')
  const portrait = element('img', 'ne-stage-picture ne-stage-portrait')
  const shade = element('div', 'ne-stage-shade')
  const empty = element('div', 'ne-stage-empty', '为故事布置一幕风景')
  for (const node of [background, portrait]) {
    node.draggable = false
    node.setAttribute('aria-hidden', 'true')
    node.onerror = () => { node.hidden = true }
  }
  root.append(background, atmosphere, portrait, shade, empty)
  function render() {
    const stage = getStage() || {}
    const project = engine.project
    const character = project?.characters.find(item => item.id === stage.characterId)
    const expression = stage.expression || 'neutral'
    const portraitId = character?.expressions?.[expression] || character?.expressions?.neutral || character?.portrait
    const backgroundURL = stage.background ? engine.asset(stage.background) : ''
    const portraitURL = portraitId ? engine.asset(portraitId) : ''
    picture(background, backgroundURL)
    picture(portrait, portraitURL)
    root.style.setProperty('--ne-stage-position', `${clamp(stage.position, 0, 100, 50)}%`)
    root.style.setProperty('--ne-stage-scale', String(clamp(stage.scale, 30, 180, 100) / 100))
    root.dataset.character = character ? 'true' : 'false'
    empty.hidden = Boolean(backgroundURL || portraitURL) || engine.mode === 'play'
    const backdrop = project?.assets.find(item => item.id === stage.background)?.name || '留白背景'
    const mood = EXPRESSIONS.find(([id]) => id === expression)?.[1] || '平静'
    root.setAttribute('aria-label', `${backdrop}${character ? `，${character.name}，${mood}` : '，无出场角色'}`)
  }
  return { root, render, dispose() { background.onerror = portrait.onerror = null; root.remove() } }
}

export default function stagePlugin(ctx) {
  const engine = ctx.narrative, ui = ctx.narrativeUI
  const mounts = new Set()

  function scope() {
    const cleanups = []
    let disposed = false
    const dispose = () => {
      if (disposed) return
      disposed = true
      mounts.delete(dispose)
      for (const cleanup of cleanups.reverse()) cleanup()
    }
    mounts.add(dispose)
    return {
      dispose,
      add(cleanup) { if (typeof cleanup === 'function') cleanups.push(cleanup) },
      listen(target, event, handler) {
        target.addEventListener(event, handler)
        cleanups.push(() => target.removeEventListener(event, handler))
      },
      observe(render) {
        this.add(engine.observe(ctx, event => {
          if (!disposed && (!event || ['project', 'selection', 'runtime', 'mode', 'status'].includes(event.type))) render()
        }))
      },
    }
  }

  ui.registerSurface(ctx, {
    id: 'stage', order: 0,
    mount(container) {
      const lifetime = scope()
      const view = createStage(engine, () => engine.mode === 'play' ? engine.runtime?.stage : engine.scene()?.stage)
      container.append(view.root)
      lifetime.add(view.dispose)
      view.render()
      lifetime.observe(view.render)
      return lifetime.dispose
    },
  })

  ui.registerPanel(ctx, {
    id: 'stage', label: '舞台布景', icon: '▧', order: 30,
    render(container) {
      const lifetime = scope()
      const root = element('section', 'ne-stage-editor ne-stack')
      container.append(root)
      lifetime.add(() => root.remove())
      const nodeId = engine.selection?.nodeId || engine.scene()?.id
      const current = () => engine.project?.nodes.find(node => node.id === nodeId)
      if (!current()) {
        root.append(element('p', 'ne-empty', '先选择一个剧情节点，再布置它的舞台。'))
        return lifetime.dispose
      }

      const heading = element('div', 'ne-stage-heading ne-row')
      heading.append(element('h3', 'ne-section-title', '场景构图'))
      const sceneName = element('span', 'ne-badge')
      heading.append(sceneName)
      const preview = element('div', 'ne-stage-preview')
      const view = createStage(engine, () => current()?.stage)
      preview.append(view.root)
      lifetime.add(view.dispose)
      const notice = element('p', 'ne-muted ne-stage-editor-notice')
      const fields = element('fieldset', 'ne-stage-fields ne-stack')
      const legend = element('legend', 'ne-stage-legend', '当前场景的布景')
      fields.append(legend)

      function field(title, control, hint) {
        const label = element('label', 'ne-field')
        label.append(element('span', '', title), control)
        fields.append(label)
        if (hint) label.append(element('small', 'ne-muted', hint))
      }
      const background = element('select', 'ne-select')
      const character = element('select', 'ne-select')
      const expression = element('select', 'ne-select')
      field('场景背景', background)
      field('出场角色', character)
      field('角色表情', expression, '未配置的表情沿用平静形象或默认立绘。')

      const sliders = {}
      for (const [key, label, min, max] of [['position', '水平位置', 0, 100], ['scale', '立绘大小', 30, 180]]) {
        const range = element('input', 'ne-stage-range')
        range.type = 'range'; range.min = String(min); range.max = String(max); range.step = '1'
        range.setAttribute('aria-label', label)
        const output = element('output', 'ne-stage-value')
        const wrap = element('label', 'ne-field ne-stage-slider')
        const caption = element('span', 'ne-stage-slider-caption')
        caption.append(element('span', '', label), output)
        wrap.append(caption, range)
        fields.append(wrap)
        sliders[key] = { range, output }
        lifetime.listen(range, 'input', () => change({ [key]: Number(range.value) }))
      }
      const reset = element('button', 'ne-button', '恢复居中与原始大小')
      reset.type = 'button'
      fields.append(reset)
      root.append(heading, preview, element('p', 'ne-muted', '调整会立即保存到当前节点，并同步到舞台。'), notice, fields)

      function change(patch) {
        if (engine.mode !== 'edit' || engine.held || !current()) return
        try {
          engine.update(project => {
            const node = project.nodes.find(item => item.id === nodeId)
            if (node) Object.assign(node.stage, patch)
          }, { render: false })
        } catch (error) { engine.error(error.message); sync() }
      }
      lifetime.listen(background, 'change', () => change({ background: background.value }))
      lifetime.listen(character, 'change', () => change({ characterId: character.value }))
      lifetime.listen(expression, 'change', () => change({ expression: expression.value }))
      lifetime.listen(reset, 'click', () => change({ position: 50, scale: 100 }))

      function sync() {
        const node = current(), stage = node?.stage || {}
        sceneName.textContent = node?.title || '未命名场景'
        fields.disabled = !node || engine.mode !== 'edit' || Boolean(engine.held)
        notice.textContent = engine.mode === 'play' ? '正在试玩，返回编辑后可调整布景。' : engine.held ? '正在保存作品，请稍候。' : ''
        notice.hidden = !notice.textContent
        options(background, [['', '留白背景'], ...(engine.project?.assets || []).filter(asset => asset.kind === 'image').map(asset => [asset.id, asset.name])], stage.background)
        options(character, [['', '不显示角色'], ...(engine.project?.characters || []).map(item => [item.id, item.name])], stage.characterId)
        options(expression, EXPRESSIONS, stage.expression || 'neutral')
        expression.disabled = !stage.characterId
        for (const [key, min, max, fallback] of [['position', 0, 100, 50], ['scale', 30, 180, 100]]) {
          const value = clamp(stage[key], min, max, fallback)
          sliders[key].range.value = String(value)
          sliders[key].output.value = `${value}%`
          sliders[key].range.disabled = !stage.characterId
        }
        reset.disabled = !stage.characterId
        view.render()
      }
      sync()
      lifetime.observe(sync)
      return lifetime.dispose
    },
  })
  ctx.effect(() => () => { for (const dispose of [...mounts]) dispose() })
}
