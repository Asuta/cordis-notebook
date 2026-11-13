import { characterImage, characterReferences, createCharacter, removeCharacter } from './model.js'
import { readImageFile } from './image.js'

const IMAGE_FIELDS = [
  ['portrait', '默认立绘', '未设置默认立绘'],
  ['neutral', '平静', '沿用默认立绘'],
  ['happy', '开心', '沿用平静形象或默认立绘'],
  ['sad', '难过', '沿用平静形象或默认立绘'],
]

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function picture(image, url) {
  if (!url) { image.hidden = true; image.removeAttribute('src'); return }
  if (image.getAttribute('src') === url) return
  image.hidden = false
  image.src = url
}

export default function charactersPlugin(ctx) {
  const engine = ctx.narrative, ui = ctx.narrativeUI
  const mounts = new Set()

  ui.registerPanel(ctx, {
    id: 'characters', label: '角色档案', icon: '◎', order: 20,
    render(container) {
      let disposed = false, pendingDelete = '', activeId = ''
      const cleanups = [], uploads = new Map()
      const root = element('section', 'ne-characters ne-stack')
      container.append(root)
      function dispose() {
        if (disposed) return
        disposed = true
        mounts.delete(dispose)
        for (const upload of uploads.values()) upload.abort()
        uploads.clear()
        for (const cleanup of cleanups.reverse()) cleanup()
        root.remove()
      }
      mounts.add(dispose)
      const listen = (target, event, handler) => {
        target.addEventListener(event, handler)
        cleanups.push(() => target.removeEventListener(event, handler))
      }
      const heading = element('div', 'ne-row ne-characters-heading')
      const count = element('span', 'ne-badge')
      const add = element('button', 'ne-button ne-primary', '添加角色')
      add.type = 'button'
      heading.append(element('h3', 'ne-section-title', '故事人物'), count, add)
      const list = element('div', 'ne-characters-list')
      list.setAttribute('role', 'group')
      list.setAttribute('aria-label', '作品角色')
      const empty = element('div', 'ne-empty', '故事还没有角色。添加一位，让相遇从这里开始。')
      const notice = element('p', 'ne-muted ne-characters-notice')
      const status = element('p', 'ne-characters-status')
      status.setAttribute('role', 'status')
      status.setAttribute('aria-live', 'polite')
      const editor = element('fieldset', 'ne-characters-editor ne-stack')
      editor.append(element('legend', 'ne-characters-legend', '编辑角色档案'))
      const profile = element('div', 'ne-character-profile ne-card')
      const portraitWrap = element('div', 'ne-character-portrait-wrap')
      const portrait = element('img', 'ne-character-portrait')
      const initial = element('span', 'ne-character-initial')
      portrait.hidden = true; portrait.draggable = false
      portraitWrap.append(initial, portrait)
      const profileText = element('div', 'ne-character-profile-text')
      const profileName = element('strong', 'ne-character-profile-name')
      const profileDescription = element('p', 'ne-muted')
      profileText.append(profileName, profileDescription)
      profile.append(portraitWrap, profileText)
      editor.append(profile)
      listen(portrait, 'error', () => { portrait.hidden = true })
      const inputs = {}
      const field = (label, control, hint) => {
        const wrap = element('label', 'ne-field')
        wrap.append(element('span', '', label), control)
        if (hint) wrap.append(element('small', 'ne-muted', hint))
        editor.append(wrap)
        return wrap
      }
      for (const [key, label, multiline, placeholder, limit] of [
        ['name', '角色姓名', false, '故事里如何称呼这位角色', 80],
        ['description', '人物简介', true, '身份、经历，以及与故事的联系', 8000],
        ['personality', '性格与说话方式', true, '性格、习惯与语气，让每次对话保持人物本色', 8000],
      ]) {
        const input = element(multiline ? 'textarea' : 'input', multiline ? 'ne-textarea' : 'ne-input')
        if (multiline) input.rows = 3
        else input.type = 'text'
        input.placeholder = placeholder; input.maxLength = limit
        if (key === 'name') input.required = true
        inputs[key] = input
        field(label, input)
        listen(input, 'input', () => {
          if (key === 'name' && !input.value.trim()) {
            input.setCustomValidity('请填写角色姓名。')
            return
          }
          input.setCustomValidity('')
          edit(character => { character[key] = key === 'name' ? input.value.trim() : input.value })
        })
        if (key === 'name') listen(input, 'blur', () => {
          input.setCustomValidity('')
          input.value = current()?.name || ''
        })
      }
      const color = element('input', 'ne-character-color')
      color.type = 'color'
      inputs.color = color
      field('角色标识色', color, '用于区分角色的档案与对话。')
      listen(color, 'input', () => edit(character => { character.color = color.value }))

      const images = new Map()
      const imageHeading = element('div', 'ne-character-image-heading')
      imageHeading.append(element('h3', 'ne-section-title', '立绘与表情'), element('p', 'ne-muted', '选择作品中的图片，或上传 PNG、JPEG、WebP 图片，每张最多 5 MB。'))
      editor.append(imageHeading)
      const imageGrid = element('div', 'ne-character-images')
      editor.append(imageGrid)
      for (const [key, label, fallback] of IMAGE_FIELDS) {
        const card = element('div', 'ne-character-image-card ne-card')
        const preview = element('img', 'ne-character-image-preview')
        preview.alt = `${label}预览`; preview.draggable = false; preview.hidden = true
        const select = element('select', 'ne-select')
        const selectLabel = element('label', 'ne-field')
        selectLabel.append(element('span', '', label), select)
        const uploadLabel = element('label', 'ne-field ne-character-upload')
        const file = element('input', 'ne-character-file')
        file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp'
        uploadLabel.append(element('span', '', `上传${label}图片`), file)
        card.append(preview, selectLabel, uploadLabel)
        imageGrid.append(card)
        images.set(key, { preview, select, file, fallback })
        listen(preview, 'error', () => { preview.hidden = true })
        listen(select, 'change', () => {
          uploads.get(key)?.abort()
          uploads.delete(key)
          edit(character => setImage(character, key, select.value))
        })
        listen(file, 'change', () => uploadImage(key, file))
      }
      const references = element('p', 'ne-muted')
      const remove = element('button', 'ne-button ne-danger', '删除角色')
      remove.type = 'button'
      const deletion = element('div', 'ne-character-deletion ne-card')
      deletion.hidden = true
      const deleteMessage = element('p', '', '删除后会清空舞台和聊天中的角色引用，原台词改为旁白，已上传图片仍保留在作品中。')
      const deleteActions = element('div', 'ne-row')
      const cancel = element('button', 'ne-button', '保留角色')
      const confirm = element('button', 'ne-button ne-danger', '确认删除')
      cancel.type = confirm.type = 'button'
      deleteActions.append(cancel, confirm)
      deletion.append(deleteMessage, deleteActions)
      editor.append(references, remove, deletion)
      root.append(heading, list, empty, notice, editor, status)

      const editable = () => !disposed && engine.mode === 'edit' && !engine.held
      const current = () => engine.project?.characters.find(character => character.id === activeId)
      function report(error) { if (!disposed) status.textContent = error?.message || '操作未完成，请重试。' }
      function edit(mutator) {
        if (!editable() || !current()) return
        const id = activeId
        try {
          engine.update(project => {
            const character = project.characters.find(item => item.id === id)
            if (character) mutator(character)
          }, { render: false })
        } catch (error) { report(error); sync() }
      }
      function setImage(character, key, value) {
        if (key === 'portrait') character.portrait = value
        else character.expressions[key] = value
      }
      async function uploadImage(key, input) {
        const file = input.files?.[0]
        if (!file || !editable() || !current()) { input.value = ''; return }
        uploads.get(key)?.abort()
        const controller = new AbortController()
        uploads.set(key, controller)
        const projectId = engine.project.id, characterId = activeId
        status.textContent = '正在读取图片…'
        sync()
        try {
          const url = await readImageFile(file, { signal: controller.signal })
          if (controller.signal.aborted || !editable() || engine.project.id !== projectId || activeId !== characterId) return
          if (!engine.project.characters.some(character => character.id === characterId)) return
          engine.update(project => {
            const character = project.characters.find(item => item.id === characterId)
            const asset = { id: `image-${crypto.randomUUID()}`, name: file.name.slice(0, 160), kind: 'image', url, mime: file.type, size: file.size }
            project.assets.push(asset)
            setImage(character, key, asset.id)
          }, { render: false })
          status.textContent = '图片已加入作品，导出作品时会一起保存。'
        } catch (error) { if (error.name !== 'AbortError') report(error) }
        finally {
          if (uploads.get(key) === controller) uploads.delete(key)
          input.value = ''
          if (!disposed) sync()
        }
      }
      listen(add, 'click', () => {
        if (!editable()) return
        try {
          const character = createCharacter(engine.project)
          engine.update(project => { project.characters.push(character) }, { render: false })
          engine.select({ characterId: character.id })
        } catch (error) { report(error) }
      })
      listen(list, 'click', event => {
        const button = event.target.closest('button[data-character-id]')
        if (button && list.contains(button)) engine.select({ characterId: button.dataset.characterId })
      })
      listen(remove, 'click', () => {
        if (!editable() || !current()) return
        pendingDelete = activeId
        deletion.hidden = false
        deleteMessage.textContent = `删除“${current().name}”后会清空舞台和聊天中的角色引用，原台词改为旁白。图片仍保留在作品中。`
        cancel.focus()
      })
      listen(cancel, 'click', () => { pendingDelete = ''; deletion.hidden = true })
      listen(confirm, 'click', () => {
        if (!editable() || pendingDelete !== activeId || !current()) return
        try {
          const id = activeId
          const remaining = engine.project.characters.filter(character => character.id !== id)
          const next = remaining[0]?.id || ''
          engine.update(project => removeCharacter(project, id), { render: false })
          engine.select({ characterId: next })
        } catch (error) { report(error) }
      })

      function sync() {
        if (disposed) return
        const project = engine.project
        const characters = project?.characters || []
        const chosen = characters.find(character => character.id === engine.selection?.characterId) || characters[0]
        if (activeId !== (chosen?.id || '')) {
          for (const controller of uploads.values()) controller.abort()
          uploads.clear()
          pendingDelete = ''; deletion.hidden = true; status.textContent = ''
          for (const input of Object.values(inputs)) input.setCustomValidity('')
        }
        activeId = chosen?.id || ''
        count.textContent = `${characters.length} 位`
        list.replaceChildren(...characters.map(character => {
          const button = element('button', 'ne-character-item')
          button.type = 'button'; button.dataset.characterId = character.id
          button.setAttribute('aria-pressed', String(character.id === activeId))
          const dot = element('span', 'ne-character-dot')
          dot.style.backgroundColor = character.color
          dot.setAttribute('aria-hidden', 'true')
          const name = element('span', 'ne-character-item-name', character.name)
          button.append(dot, name)
          return button
        }))
        empty.hidden = characters.length > 0
        editor.hidden = !chosen
        editor.disabled = add.disabled = !editable()
        notice.textContent = engine.mode === 'play' ? '正在试玩，返回编辑后可修改角色档案。' : engine.held ? '正在保存作品，请稍候。' : ''
        notice.hidden = !notice.textContent
        if (!chosen) return
        profileName.textContent = chosen.name
        profileDescription.textContent = chosen.description || '从一句介绍开始，让角色走进你的故事。'
        initial.textContent = Array.from(chosen.name)[0] || '角'
        portrait.alt = `${chosen.name}的立绘`
        profile.style.setProperty('--ne-character-color', chosen.color)
        const portraitId = chosen.portrait || chosen.expressions.neutral
        picture(portrait, portraitId ? engine.asset(portraitId) : '')
        for (const [key, input] of Object.entries(inputs)) {
          if (document.activeElement !== input) input.value = chosen[key] || (key === 'color' ? '#b59475' : '')
        }
        const assets = (project.assets || []).filter(asset => asset.kind === 'image')
        for (const [key, { select, preview, file, fallback }] of images) {
          const value = key === 'portrait' ? chosen.portrait : chosen.expressions[key]
          select.replaceChildren(...[['', fallback], ...assets.map(asset => [asset.id, asset.name])].map(([id, label]) => {
            const option = element('option', '', label); option.value = id; return option
          }))
          select.value = value || ''
          file.disabled = uploads.has(key)
          const imageId = characterImage(chosen, key)
          picture(preview, imageId ? engine.asset(imageId) : '')
        }
        const referenceCount = characterReferences(project, chosen.id)
        references.textContent = referenceCount ? `在剧情中被引用 ${referenceCount} 处。删除时会保留台词，并自动清理角色引用。` : '这位角色还没有出场。可以在“舞台布景”中安排相遇。'
      }
      const unobserve = engine.observe(ctx, event => {
        if (!disposed && (!event || ['project', 'selection', 'mode', 'status'].includes(event.type))) sync()
      })
      if (typeof unobserve === 'function') cleanups.push(unobserve)
      sync()
      return dispose
    },
  })
  ctx.effect(() => () => { for (const dispose of [...mounts]) dispose() })
}
