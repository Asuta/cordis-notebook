import { createHistory } from './history.js'
import { createViewport } from './viewport.js'
import { mountControls } from './view.jsx'
import { writingOrigin } from './positioning.js'
import { pageAppearance } from './appearance.js'

export default function (ctx, sdk) {
  const session = sdk.storage?.session || sessionStorage
  if (sdk.application?.legacyBrowserStorage && sdk.storage) {
    try {
      if (!session.getItem('legacy-imported')) {
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i)
          if (/^cordis-page-(view|scroll)-/.test(key) && session.getItem(key) === null) session.setItem(key, sessionStorage.getItem(key))
        }
        session.setItem('legacy-imported', '1')
      }
    } catch {}
  }
  const model = ctx.notebook,
    rich = ctx.richText,
    states = new Map(),
    nodes = new Map(),
    selection = new Set(),
    uploading = new Map()
  let noteId = null,
    active = null,
    tool = 'type',
    gesture = null,
    frame = 0,
    applying = false,
    disposed = false,
    formatBrush = null,
    lastInput = 0,
    refresh = () => {}
  const root = sdk.el('section', { class: 'free-page', 'aria-label': '自由页面编辑器' })
  const controls = sdk.el('div', { class: 'free-page-controls' })
  const viewport = sdk.el('div', { class: 'free-page-viewport', tabIndex: 0, 'aria-label': '自由页面纸张' })
  const stage = sdk.el('div', { class: 'free-page-stage' }),
    paper = sdk.el('div', { class: 'free-page-paper' })
  // Keep persisted block coordinates relative to the writing area, below the heading.
  const contentTop = 144,
    headingTarget = sdk.el('div', { class: 'free-page-heading' }),
    writing = sdk.el('div', { class: 'free-page-writing' })
  writing.style.top = contentTop + 'px'
  const marquee = sdk.el('div', { class: 'free-page-marquee', hidden: true }),
    guide = sdk.el('div', { class: 'free-page-space-guide', hidden: true })
  const footer = sdk.el('div', { class: 'free-page-status' })
  writing.append(marquee, guide)
  paper.append(headingTarget, writing)
  stage.append(paper)
  viewport.append(stage)
  root.append(controls, viewport, footer)
  ctx.editorHost.register(ctx, 'freeform', root, { headingTarget })
  const current = () => model.current(),
    blocks = () => current()?.blocks || [],
    page = () => current()?.page || { color: '#ffffff', rule: 'none' }
  const editable = () => !!noteId && !model.busy && model.editable
  const paint = () => {
    const dark = document.documentElement.dataset.themeMode === 'dark'
    const appearance = pageAppearance(page().color, dark)
    root.dataset.paperMode = dark ? 'dark' : 'light'
    paper.style.backgroundColor = appearance.background
    paper.style.color = appearance.foreground
    paper.style.caretColor = appearance.foreground
    for (const item of nodes.values()) item.editor.setAppearance(appearance)
  }
  const data = () => ({ blocks: structuredClone(blocks()), page: structuredClone(page()), version: 2 })
  const outline = (block) => block.outline || rich.plain(block.text || '', block.id)
  const state = () => {
    if (!states.has(noteId)) {
      let view = { left: 0, top: 0, zoom: 1 }
      try {
        const v = JSON.parse(
          session.getItem('cordis-page-view-' + noteId) ||
            session.getItem('cordis-page-scroll-' + noteId),
        )
        if (Array.isArray(v)) view = { left: v[0], top: v[1], zoom: 1 }
        else if (v) view = v
      } catch {}
      states.set(noteId, { history: createHistory(), view })
    }
    return states.get(noteId)
  }
  const saveView = (value) => {
    if (!noteId) return
    state().view = value
    try {
      session.setItem('cordis-page-view-' + noteId, JSON.stringify(value))
    } catch {}
  }
  const camera = createViewport(
    viewport,
    stage,
    paper,
    () => {
      let width = 0,
        height = 0
      for (const block of blocks()) {
        const item = nodes.get(block.id)
        width = Math.max(width, block.x + block.width + 220)
        height = Math.max(height, block.y + (item?.node.offsetHeight || 100) + 260)
      }
      return { width, height: height + contentTop }
    },
    (value) => { saveView(value); if (!disposed) update() },
    contentTop,
  )
  const update = () => {
    for (const [id, item] of nodes) {
      item.node.classList.toggle('selected', selection.has(id))
      item.node.dataset.selected = String(selection.has(id))
      item.handle.setAttribute('aria-pressed', String(selection.has(id)))
    }
    root.dataset.tool = tool
    footer.textContent = `${blocks().length} 个容器${selection.size ? ' · 已选 ' + selection.size + ' 个' : ''} · ${Math.round(camera.zoom * 100)}% · Shift 拖动合并 · 中键平移`
    refresh()
  }
  const select = (id, extend = false) => {
    if (!extend) selection.clear()
    if (id) {
      if (extend && selection.has(id)) selection.delete(id)
      else selection.add(id)
    }
    active = id
    update()
    viewport.focus({ preventScroll: true })
  }
  const commit = (next, key = null) => {
    if (!editable()) return false
    const before = data()
    if (JSON.stringify(before) === JSON.stringify(next)) return true
    try {
      applying = true
      model.edit(next)
      state().history.record(before, key)
      return true
    } catch (e) {
      sdk.toast(e.message)
      return false
    } finally {
      applying = false
      render()
    }
  }
  const changeBlocks = (next, key) => commit({ ...data(), blocks: next }, key)
  const removeEmpty = (id) => {
    const item = nodes.get(id), block = blocks().find(b => b.id === id)
    if (!editable() || current()?.id !== noteId || !block || item?.editor.composing || uploading.has(item)) return
    // Images, tables, lists and tags are content even if their plain-text summary is empty.
    const empty = outline(block).elements.every(n =>
      ['paragraph', 'heading', 'code'].includes(n.kind) && !n.tag && n.runs.every(r => !r.text.trim()))
    if (empty) changeBlocks(blocks().filter(b => b.id !== id))
  }
  const cleanupAfterBlur = (id) => {
    const expected = noteId
    queueMicrotask(() => {
      if (disposed || expected !== noteId || selection.has(id)) return
      const focus = document.activeElement
      if (nodes.get(id)?.node.contains(focus) || controls.contains(focus) || focus?.closest('[role=dialog]')) return
      removeEmpty(id)
    })
  }
  const travel = (direction) => {
    if (!editable() || [...nodes.values()].some((n) => n.editor.composing)) return
    cancelGesture()
    const next = state().history[direction](data())
    if (!next) return
    try {
      model.edit(next)
    } catch (e) {
      state().history[direction === 'undo' ? 'redo' : 'undo'](data())
      sdk.toast(e.message)
    }
    update()
  }
  const renew = (doc) => {
    const value = structuredClone(doc)
    const visit = (items) => {
      for (const n of items) {
        n.id = crypto.randomUUID()
        if (n.children) visit(n.children)
      }
    }
    visit(value.elements)
    return value
  }
  const add = (x = viewport.scrollLeft / camera.zoom + 40, y = Math.max(0, viewport.scrollTop / camera.zoom - contentTop) + 40, doc) => {
    const id = crypto.randomUUID(),
      block = {
        id,
        x: Math.min(10000000, x),
        y: Math.min(10000000, y),
        width: 420,
        text: '',
        outline: doc || rich.plain('', id),
      }
    if (changeBlocks([...blocks(), block])) {
      select(id)
      nodes.get(id)?.editor.focus('end')
    }
    return id
  }
  const removeSelected = () => {
    if (selection.size && changeBlocks(blocks().filter((b) => !selection.has(b.id)))) {
      selection.clear()
      active = null
      update()
    }
  }
  const run = (name, value) => {
    if (!editable()) return
    const item = nodes.get(active)
    if (!item) {
      sdk.toast('先点击一个容器中的文字。')
      return
    }
    try {
      item.editor.exec(name, value)
      state().history.breakGroup()
      update()
    } catch (e) {
      sdk.toast(e.message)
    }
  }
  const upload = async (files, id = active) => {
    const expected = noteId
    if (!editable()) return
    if (!id) id = add()
    const item = nodes.get(id)
    if (!item) return
    const pos = item.editor.editor?.state.selection.from
    uploading.set(item, (uploading.get(item) || 0) + 1)
    try {
      for (const file of files) {
        const src = await ctx.noteAssets.upload(file)
        if (disposed || noteId !== expected || !editable() || nodes.get(id) !== item) {
          sdk.toast('图片已保存，页面已切换，请回到原页重新插入。')
          return
        }
        if (pos != null)
          item.editor.editor.commands.setTextSelection(Math.min(pos, item.editor.editor.state.doc.content.size))
        item.editor.exec('image', { src, alt: file.name || '粘贴的图片', width: 320 })
      }
    } catch (e) {
      sdk.toast(e.message)
    } finally {
      const count = uploading.get(item) - 1
      if (count) uploading.set(item, count)
      else uploading.delete(item)
      if (!disposed && noteId === expected) cleanupAfterBlur(id)
    }
  }
  const file = sdk.el('input', {
    type: 'file',
    accept: 'image/png,image/jpeg,image/gif,image/webp',
    multiple: true,
    hidden: true,
  })
  root.append(file)
  sdk.listen(file, 'change', () => {
    void upload([...file.files])
    file.value = ''
  })
  function cancelGesture() {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    if (gesture?.kind === 'marquee') {
      selection.clear()
      for (const id of gesture.selected) if (nodes.has(id)) selection.add(id)
    }
    const previous = gesture
    gesture = null
    if (previous?.target.hasPointerCapture?.(previous.pointerId)) previous.target.releasePointerCapture(previous.pointerId)
    marquee.hidden = true
    guide.hidden = true
    for (const item of nodes.values()) item.node.classList.remove('merge-target')
    render()
  }
  function begin(event, kind, id) {
    if (gesture || (event.button !== 0 && event.button !== 1) || !noteId) return
    if (event.button === 1 || tool === 'pan') {
      kind = 'pan'
      id = null
    }
    if (['move', 'resize', 'space'].includes(kind) && !editable()) return
    event.preventDefault()
    camera.finishZoom()
    if (id && (!selection.has(id) || event.ctrlKey || event.metaKey)) select(id, event.ctrlKey || event.metaKey)
    if (kind !== 'pan') viewport.focus({ preventScroll: true })
    const point = camera.point(event)
    gesture = {
      kind,
      pointerId: event.pointerId,
      target: event.currentTarget,
      extend: event.shiftKey || event.ctrlKey || event.metaKey,
      id,
      start: point,
      point,
      clientX: event.clientX,
      clientY: event.clientY,
      startClientX: event.clientX,
      startClientY: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
      before: data(),
      selected: new Set(selection),
      shift: event.shiftKey,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    if (kind === 'marquee') {
      active = null
      if (!gesture.extend) selection.clear()
      update()
    }
    if (kind === 'space') {
      guide.hidden = false
      guide.style.top = point.y + 'px'
    }
    frame = requestAnimationFrame(tick)
  }
  function tick() {
    if (!gesture) return
    const g = gesture,
      r = viewport.getBoundingClientRect()
    // Measure in screen pixels so click-vs-drag is stable at every zoom level.
    if (Math.hypot(g.clientX - g.startClientX, g.clientY - g.startClientY) > 4) g.moved = true
    if (g.kind === 'marquee' && !g.moved) {
      frame = requestAnimationFrame(tick)
      return
    }
    if (g.kind === 'pan') {
      const left = Math.max(0, g.left + g.startClientX - g.clientX),
        top = Math.max(0, g.top + g.startClientY - g.clientY)
      stage.style.width = Math.max(stage.offsetWidth, left + viewport.clientWidth + 100) + 'px'
      stage.style.height = Math.max(stage.offsetHeight, top + viewport.clientHeight + 100) + 'px'
      viewport.scrollTo(left, top)
    } else {
      const speed = (v, lo, hi) => (v < lo + 28 ? -12 : v > hi - 28 ? 12 : 0),
        dx = speed(g.clientX, r.left, r.right),
        dy = speed(g.clientY, r.top, r.bottom)
      if (dx > 0) stage.style.width = stage.offsetWidth + 50 + 'px'
      if (dy > 0) stage.style.height = stage.offsetHeight + 50 + 'px'
      if (dx || dy) viewport.scrollBy(dx, dy)
      g.point = camera.point(g)
      const dxw = g.point.x - g.start.x,
        dyw = g.point.y - g.start.y
      if (g.kind === 'move')
        for (const b of g.before.blocks)
          if (g.selected.has(b.id)) {
            const n = nodes.get(b.id)?.node
            if (n) {
              n.style.left = Math.max(0, b.x + dxw) + 'px'
              n.style.top = Math.max(0, b.y + dyw) + 'px'
            }
          }
      if (g.kind === 'resize') {
        const b = g.before.blocks.find((b) => b.id === g.id)
        const node = nodes.get(g.id)?.node
        if (node) node.style.width = Math.max(160, Math.min(4000, b.width + dxw)) + 'px'
      }
      if (g.kind === 'marquee') {
        marquee.hidden = false
        const box = {
          x: Math.min(g.start.x, g.point.x),
          y: Math.min(g.start.y, g.point.y),
          width: Math.abs(dxw),
          height: Math.abs(dyw),
        }
        Object.assign(marquee.style, {
          left: box.x + 'px',
          top: box.y + 'px',
          width: box.width + 'px',
          height: box.height + 'px',
        })
        selection.clear()
        if (g.extend) for (const id of g.selected) if (nodes.has(id)) selection.add(id)
        for (const b of blocks())
          if (
            b.x < box.x + box.width &&
            b.x + b.width > box.x &&
            b.y < box.y + box.height &&
            b.y + (nodes.get(b.id)?.node.offsetHeight || 60) > box.y
          )
            selection.add(b.id)
        update()
      }
      if (g.kind === 'space') guide.style.height = Math.max(2, dyw) + 'px'
      for (const [id, item] of nodes)
        item.node.classList.toggle(
          'merge-target',
          g.kind === 'move' && g.shift && !g.selected.has(id) && hit(g.point, id),
        )
    }
    frame = requestAnimationFrame(tick)
  }
  const hit = (p, id) => {
    const b = blocks().find((b) => b.id === id)
    return (
      b && p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + (nodes.get(id)?.node.offsetHeight || 60)
    )
  }
  function finish(event) {
    if (!gesture || (event && event.pointerId !== gesture.pointerId)) return
    cancelAnimationFrame(frame)
    if (event) {
      gesture.clientX = event.clientX
      gesture.clientY = event.clientY
      gesture.shift = event.shiftKey
    }
    tick()
    const g = gesture
    cancelAnimationFrame(frame)
    frame = 0
    gesture = null
    if (g.target.hasPointerCapture?.(g.pointerId)) g.target.releasePointerCapture(g.pointerId)
    marquee.hidden = true
    guide.hidden = true
    const dx = g.point.x - g.start.x,
      dy = g.point.y - g.start.y
    // Gestures own geometry only. Uploads and edits may have changed content
    // since pointerdown; preserve current blocks, including additions/removals.
    const before = new Map(g.before.blocks.map((b) => [b.id, b]))
    if (g.kind === 'marquee' && !g.moved && !g.extend && editable()) {
      const origin = writingOrigin(writing, g.start, camera.zoom)
      add(origin.x, origin.y)
    } else if (g.moved && g.kind === 'move') {
      const target = g.shift && blocks().find((b) => !g.selected.has(b.id) && hit(g.point, b.id))
      if (target) {
        const merged = {
          version: 1,
          elements: [
            ...outline(target).elements,
            ...blocks().filter((b) => g.selected.has(b.id)).flatMap((b) => outline(b).elements),
          ],
        }
        changeBlocks(
          blocks()
            .filter((b) => !g.selected.has(b.id))
            .map((b) => (b.id === target.id ? { ...b, outline: merged } : b)),
        )
        select(target.id)
      } else
        changeBlocks(
          blocks().map((b) => {
            const original = before.get(b.id)
            return original && g.selected.has(b.id)
              ? { ...b, x: Math.max(0, Math.min(10000000, original.x + dx)), y: Math.max(0, Math.min(10000000, original.y + dy)) }
              : b
          }),
        )
    } else if (g.kind === 'resize' && g.moved)
      changeBlocks(
        blocks().map((b) => (b.id === g.id ? { ...b, width: Math.max(160, Math.min(4000, before.get(b.id).width + dx)) } : b)),
      )
    else if (g.kind === 'space' && dy > 0)
      changeBlocks(blocks().map((b) => {
        const original = before.get(b.id)
        return original && original.y >= g.start.y ? { ...b, y: Math.min(10000000, original.y + dy) } : b
      }))
    for (const item of nodes.values()) item.node.classList.remove('merge-target')
    render()
    camera.scrolled()
  }
  const observer = new ResizeObserver(() => {
    if (!gesture) camera.layout()
  })
  observer.observe(viewport)
  function render() {
    if (applying || disposed) return
    const note = current(),
      next = note && ctx.noteFormats.typeOf(note) === 'freeform' ? note.id : null,
      changed = next !== noteId
    if (changed) {
      if (noteId) saveView(camera.snapshot())
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      gesture = null
      for (const item of nodes.values()) {
        observer.unobserve(item.node)
        item.editor.destroy()
        item.node.remove()
      }
      nodes.clear()
      selection.clear()
      active = null
      noteId = next
    }
    if (!noteId) {
      update()
      return
    }
    const ids = new Set(blocks().map((b) => b.id))
    for (const [id, item] of nodes)
      if (!ids.has(id)) {
        observer.unobserve(item.node)
        item.editor.destroy()
        item.node.remove()
        nodes.delete(id)
        selection.delete(id)
        if (active === id) active = null
      }
    for (const block of blocks()) {
      let item = nodes.get(block.id)
      if (!item) {
        const node = sdk.el('div', { class: 'free-block', 'data-block-id': block.id }),
          handle = sdk.el(
            'button',
            {
              class: 'free-block-handle',
              'aria-label': '移动容器',
              title: '拖动移动 · Shift 拖到其他容器合并',
              tabIndex: 0,
            },
            '⠿',
          )
        const grip = sdk.el(
            'button',
            { class: 'free-block-resize', 'aria-label': '调整容器宽度', title: '拖动调整宽度' },
            '↔',
          ),
          body = sdk.el('div', { class: 'free-block-body' })
        node.append(handle, grip, body)
        writing.append(node)
        item = { node, body, handle, grip, doc: null }
        nodes.set(block.id, item)
        item.editor = rich.mount(ctx, body, {
          document: outline(block),
          editable: editable(),
          change: (doc, reason) => {
            if (!editable()) return
            const now = Date.now()
            if (now - lastInput > 800 || reason !== 'text') state().history.breakGroup()
            lastInput = now
            item.doc = JSON.stringify(doc)
            if (
              !changeBlocks(
                blocks().map((b) => (b.id === block.id ? { ...b, outline: doc } : b)),
                'text:' + block.id,
              )
            ) {
              item.doc = null
              render()
            }
          },
          focus: () => {
            active = block.id
            selection.clear()
            update()
            state().history.breakGroup()
          },
          blur: () => {
            if (noteId) state().history.breakGroup()
            cleanupAfterBlur(block.id)
          },
          boundary: () => state().history.breakGroup(),
          selection: update,
          undo: () => travel('undo'),
          redo: () => travel('redo'),
          selectContainer: () => {
            select(block.id)
            viewport.focus()
          },
          link: () => {
            active = block.id
            controller.link()
          },
          images: (files) => upload(files, block.id),
          error: (e) => sdk.toast(e.message),
        })
        item.doc = JSON.stringify(outline(block))
        sdk.agent?.selection(body, () => {
          const snapshot = item.editor.captureSelection(), capturedNote = noteId, capturedOutline = JSON.stringify(outline(blocks().find(b => b.id === block.id)))
          if (!snapshot?.text || !editable()) return null
          const apply = value => {
            if (capturedNote !== noteId || nodes.get(block.id) !== item || !editable() || JSON.stringify(outline(blocks().find(b => b.id === block.id))) !== capturedOutline) throw Error('页面或文本框已变化，请重新添加选区')
            if (!item.editor.replaceSelection(snapshot, value)) throw Error('选区替换失败')
            state().history.breakGroup()
            return model.flush().then(() => ({ updated: true }))
          }
          return { text: snapshot.text, label: current()?.title || '自由页面选区', noteId: capturedNote, blockId: block.id,
            formats: ['text', 'richtext'], richText: snapshot.content,
            replacementHint: 'richtext 的 content 使用 {version:1,elements:[...]}，沿用 richText 的结构。段落 kind:"paragraph"，runs:[{text:"文字",format:{bold:true,italic:true,underline:true,color:"#ff0000",size:16}}]；标题 kind:"heading",level:1；列表 kind:"list",ordered:false,children:[{kind:"item",children:[段落]}]。id 可省略。仅替换当前选区，不提供容器坐标；图片只能引用已上传的本地资源地址。',
            apply, applyContent: ({ content }) => apply(content) }
        })
        observer.observe(node)
        handle.onpointerdown = (e) => begin(e, 'move', block.id)
        grip.onpointerdown = (e) => begin(e, 'resize', block.id)
        for (const control of [handle, grip])
          control.onkeydown = (e) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) || !editable()) return
            e.preventDefault()
            select(block.id)
            const amount = e.shiftKey ? 10 : 1
            changeBlocks(
              blocks().map((b) =>
                b.id === block.id
                  ? {
                      ...b,
                      ...(control === grip
                        ? { width: Math.max(160, Math.min(4000, b.width + (e.key === 'ArrowLeft' ? -amount : amount))) }
                        : {
                            x: Math.max(
                              0,
                              Math.min(
                                10000000,
                                b.x + (e.key === 'ArrowLeft' ? -amount : e.key === 'ArrowRight' ? amount : 0),
                              ),
                            ),
                            y: Math.max(
                              0,
                              Math.min(
                                10000000,
                                b.y + (e.key === 'ArrowUp' ? -amount : e.key === 'ArrowDown' ? amount : 0),
                              ),
                            ),
                          }),
                    }
                  : b,
              ),
            )
          }
      }
      const doc = JSON.stringify(outline(block))
      if (doc !== item.doc && !item.editor.composing) {
        item.doc = doc
        item.editor.setDocument(outline(block))
      }
      item.editor.setEditable(editable())
      item.handle.disabled = item.grip.disabled = !editable()
      if (!gesture) {
        item.node.style.left = block.x + 'px'
        item.node.style.top = block.y + 'px'
        item.node.style.width = block.width + 'px'
      }
    }
    paint()
    paper.dataset.rule = page().rule
    if (changed) camera.restore(state().view)
    else if (!gesture) camera.layout()
    update()
  }
  const controller = {
    status: () => ({
      editable: editable(),
      active: !!nodes.get(active)?.editor,
      tool,
      zoom: Math.round(camera.zoom * 100),
      page: page(),
      selected: selection.size,
      undo: !!noteId && state().history.canUndo,
      redo: !!noteId && state().history.canRedo,
      ...(nodes.get(active)?.editor?.status() || {}),
    }),
    add: () => add(),
    remove: removeSelected,
    undo: () => travel('undo'),
    redo: () => travel('redo'),
    run,
    setTool: (value) => {
      if (gesture) cancelGesture()
      tool = value
      update()
      viewport.focus()
    },
    zoom: (value) => {
      camera.setZoom(value / 100)
      update()
    },
    setPage: (patch) => commit({ ...data(), page: { ...page(), ...patch } }),
    image: () => file.click(),
    link: () => {},
    copyFormat: () => {
      formatBrush = nodes
        .get(active)
        ?.editor.format()
        .map((m) => ({ type: m.type.name, attrs: { ...m.attrs } }))
      sdk.toast('已复制文字格式，选择目标文字后点“应用格式”。')
    },
    pasteFormat: () => {
      if (formatBrush) run('format', formatBrush)
    },
    split: () => {
      const b = blocks().find((b) => b.id === active),
        part = nodes.get(active)?.editor.paragraph()
      if (!b || !part) return
      const doc = outline(b)
      if (doc.elements.length < 2) {
        sdk.toast('容器至少需要两个段落才能拆分。')
        return
      }
      const id = crypto.randomUUID(),
        elements = doc.elements.filter((e, i) => i !== part.index)
      if (
        changeBlocks([
          ...blocks().map((v) => (v.id === b.id ? { ...v, outline: { version: 1, elements } } : v)),
          {
            id,
            x: b.x + b.width + 40,
            y: b.y,
            width: b.width,
            text: '',
            outline: { version: 1, elements: [doc.elements[part.index]] },
          },
        ])
      )
        select(id)
    },
  }
  refresh = mountControls(ctx, controls, controller, sdk)
  ctx.effect(() => {
    // Run before a different note/element takes focus so cleanup saves to the old note.
    const leave = (event) => {
      if (disposed || !active || gesture || nodes.get(active)?.node.contains(event.target) ||
          controls.contains(event.target) || event.target.closest?.('[role=dialog]') ||
          ((event.ctrlKey || event.metaKey || event.shiftKey) && root.contains(event.target))) return
      const id = active
      removeEmpty(id)
      if (!root.contains(event.target)) { selection.clear(); active = null; update() }
    }
    document.addEventListener('pointerdown', leave, true)
    return () => document.removeEventListener('pointerdown', leave, true)
  })
  sdk.listen(paper, 'pointerdown', (event) => {
    if (event.defaultPrevented) return
    if (headingTarget.contains(event.target)) return
    if (event.button === 1 || tool === 'pan') return begin(event, 'pan')
    if (event.target !== paper && event.target !== stage && event.target !== writing) return
    if (tool === 'space') begin(event, 'space')
    else if (event.button === 0) begin(event, 'marquee')
  })
  sdk.listen(root, 'pointermove', (event) => {
    if (gesture && event.pointerId === gesture.pointerId) {
      gesture.clientX = event.clientX
      gesture.clientY = event.clientY
      gesture.shift = event.shiftKey
      if (Math.hypot(event.clientX - gesture.startClientX, event.clientY - gesture.startClientY) > 4)
        gesture.moved = true
    }
  })
  sdk.listen(root, 'pointerup', finish)
  sdk.listen(root, 'pointercancel', cancelGesture)
  sdk.listen(root, 'lostpointercapture', () => {
    if (gesture) cancelGesture()
  })
  sdk.listen(window, 'blur', () => { if (gesture) cancelGesture() })
  sdk.listen(viewport, 'scroll', () => camera.scrolled())
  const wheel = (event) => {
    if (event.ctrlKey) {
      event.preventDefault()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1)
      camera.setZoom(camera.targetZoom * Math.exp(-Math.max(-240, Math.min(240, delta)) * 0.002),
        { x: event.clientX, y: event.clientY }, true)
      update()
    }
  }
  ctx.effect(() => {
    viewport.addEventListener('wheel', wheel, { passive: false })
    return () => viewport.removeEventListener('wheel', wheel)
  })
  sdk.listen(root, 'keydown', (event) => {
    if (event.isComposing || event.defaultPrevented) return
    const editing = event.target.closest('[contenteditable=true],input,select,textarea')
    if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey &&
        (event.code === 'KeyI' || event.key.toLowerCase() === 'i')) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if ((event.ctrlKey || event.metaKey) && ['+', '=', '-', '0'].includes(event.key)) {
      event.preventDefault()
      camera.setZoom(event.key === '0' ? 1 : camera.zoom * (event.key === '-' ? 1 / 1.1 : 1.1))
      update()
      return
    }
    if (editing) return
    if (event.key === 'Escape') {
      if (gesture) cancelGesture()
      selection.clear()
      active = null
      tool = 'type'
      update()
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      removeSelected()
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      for (const b of blocks()) selection.add(b.id)
      update()
    }
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
      event.preventDefault()
      travel(event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo')
    }
    if (event.code === 'Space' && !event.repeat) {
      event.preventDefault()
      root.dataset.previousTool = tool
      tool = 'pan'
      update()
    }
  })
  sdk.listen(window, 'keyup', (event) => {
    if (event.code === 'Space' && root.dataset.previousTool) {
      tool = root.dataset.previousTool
      delete root.dataset.previousTool
      update()
    }
  })
  const copy = (event, cut = false) => {
    if (event.target.closest('[contenteditable=true],input,textarea') || !selection.size) return
    const selected = blocks().filter((b) => selection.has(b.id))
    event.clipboardData.setData('application/x-cordis-outlines', JSON.stringify({ version: 2, blocks: selected }))
    event.clipboardData.setData('text/plain', selected.map((b) => b.text).join('\n'))
    event.preventDefault()
    if (cut) removeSelected()
  }
  sdk.listen(root, 'copy', (e) => copy(e))
  sdk.listen(root, 'cut', (e) => copy(e, true))
  // Internal container data must be handled before a focused text editor sees
  // the paste. Ordinary text/HTML still belongs to that editor.
  const pasteContainers = (event) => {
    if (event.defaultPrevented || !editable() || !viewport.contains(event.target) ||
        event.target.closest('input,textarea') || headingTarget.contains(event.target)) return
    const raw = event.clipboardData?.getData('application/x-cordis-outlines')
    if (!raw) return
    event.preventDefault()
    event.stopPropagation()
    try {
      const pkg = JSON.parse(raw)
      if (pkg.version !== 2 || !Array.isArray(pkg.blocks) || !pkg.blocks.length ||
          pkg.blocks.some(b => !b || !Number.isFinite(b.x) || !Number.isFinite(b.y)))
        throw new Error('文本框剪贴板格式无效')
      const targetId = [...nodes].find(([, item]) => item.node.contains(event.target))?.[0]
      const target = blocks().find(b => b.id === targetId)
      const emptyTarget = target && !uploading.has(nodes.get(targetId)) && outline(target).elements.every(n =>
        ['paragraph', 'heading', 'code'].includes(n.kind) && !n.tag && n.runs.every(r => !r.text.trim()))
      const x = Math.min(...pkg.blocks.map(b => b.x)), y = Math.min(...pkg.blocks.map(b => b.y))
      const baseX = target ? target.x + (emptyTarget ? 0 : 24) : viewport.scrollLeft / camera.zoom + 40
      const baseY = target ? target.y + (emptyTarget ? 0 : 24) : Math.max(0, viewport.scrollTop / camera.zoom - contentTop) + 40
      const next = pkg.blocks.map(b => ({ ...b, id: crypto.randomUUID(),
        x: baseX + b.x - x, y: baseY + b.y - y, outline: renew(outline(b)) }))
      if (changeBlocks([...blocks().filter(b => !emptyTarget || b.id !== targetId), ...next])) {
        selection.clear()
        for (const b of next) selection.add(b.id)
        active = null
        update()
        viewport.focus({ preventScroll: true })
      }
    } catch (e) { sdk.toast('粘贴失败：' + e.message) }
  }
  ctx.effect(() => {
    root.addEventListener('paste', pasteContainers, true)
    return () => root.removeEventListener('paste', pasteContainers, true)
  })
  sdk.listen(root, 'paste', (event) => {
    if (event.defaultPrevented || !editable() || event.target.closest('[contenteditable=true],input,textarea')) return
    const text = event.clipboardData.getData('text/plain')
    const files = [...(event.clipboardData.files || [])].filter(f => f.type.startsWith('image/'))
    if (text.trim()) {
      event.preventDefault()
      add(undefined, undefined, rich.plain(text, crypto.randomUUID()))
      return
    }
    if (files.length) {
      event.preventDefault()
      void upload(files, null)
      return
    }
  })
  sdk.listen(viewport, 'dragover', (e) => {
    if (e.dataTransfer.types.includes('Files')) e.preventDefault()
  })
  sdk.listen(viewport, 'drop', (e) => {
    if (e.defaultPrevented || !editable()) return
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
    if (files.length) {
      e.preventDefault()
      const p = camera.point(e),
        id = add(p.x, p.y)
      void upload(files, id)
    }
  })
  ctx.effect(() => () => {
    disposed = true
    if (noteId) saveView(camera.snapshot())
    camera.destroy()
    if (frame) cancelAnimationFrame(frame)
    observer.disconnect()
    for (const item of nodes.values()) item.editor.destroy()
    nodes.clear()
    states.clear()
  })
  ctx.effect(() => {
    const themeObserver = new MutationObserver(paint)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme-mode'] })
    return () => themeObserver.disconnect()
  })
  model.observe(ctx, render)
}
