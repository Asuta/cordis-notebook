import { canvasLayouts } from './layouts.js'

export function createLayoutMenu({ ctx, sdk, el, button, stage, run }) {
  const storageKey = 'studio-canvas-layout'
  let selected = sdk.storage.local.getItem(storageKey), busy = false
  if (!canvasLayouts.some(layout => layout.id === selected)) selected = canvasLayouts[0].id
  const control = el('div', { class: 'studio-layout-control' })
  const apply = button('整理画布', () => execute(selected))
  const toggle = button('▾', () => setOpen(menu.hidden), 'studio-layout-toggle')
  const menu = el('div', { class: 'studio-layout-menu', role: 'menu', 'aria-label': '画布整理方式', hidden: true, id: 'studio-layout-menu' })
  toggle.setAttribute('aria-label', '选择画布整理算法')
  toggle.setAttribute('aria-haspopup', 'menu')
  toggle.setAttribute('aria-controls', menu.id)
  toggle.setAttribute('aria-expanded', 'false')
  menu.append(el('div', { class: 'studio-layout-heading' }, '选择整理方式'), el('p', { class: 'studio-layout-hint' }, '选择即应用 · Ctrl+Z 撤销'))
  const choices = canvasLayouts.map(layout => {
    const choice = button('', () => execute(layout.id), 'studio-layout-choice')
    choice.setAttribute('role', 'menuitemradio')
    choice.dataset.layout = layout.id
    choice.append(el('strong', {}, layout.label), el('small', {}, layout.description))
    menu.append(choice)
    return choice
  })
  function update() {
    const layout = canvasLayouts.find(item => item.id === selected)
    apply.title = `使用${layout.label}整理画布`
    toggle.title = `选择整理方式 · 当前：${layout.label}`
    choices.forEach(choice => choice.setAttribute('aria-checked', String(choice.dataset.layout === selected)))
  }
  function position() {
    if (menu.hidden) return
    const area = stage.getBoundingClientRect(), anchor = control.getBoundingClientRect()
    menu.style.maxHeight = Math.max(80, stage.clientHeight - 24) + 'px'
    menu.style.left = stage.scrollLeft + Math.max(8, Math.min(stage.clientWidth - menu.offsetWidth - 8, anchor.left - area.left)) + 'px'
    menu.style.top = stage.scrollTop + Math.max(8, anchor.top - area.top - menu.offsetHeight - 10) + 'px'
  }
  function setOpen(open, focus = false) {
    menu.hidden = !open
    toggle.setAttribute('aria-expanded', String(open))
    position()
    if (focus) (open ? choices.find(choice => choice.dataset.layout === selected) : toggle)?.focus()
  }
  async function execute(id) {
    if (busy) return
    setOpen(false)
    busy = true; apply.disabled = toggle.disabled = true
    try {
      await run(id)
      selected = id; sdk.storage.local.setItem(storageKey, id); update()
    } finally { busy = false; apply.disabled = toggle.disabled = false }
  }
  sdk.listen(document, 'pointerdown', event => {
    if (!control.contains(event.target) && !menu.contains(event.target)) setOpen(false)
  })
  sdk.listen(toggle, 'keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); setOpen(true, true) }
    if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); event.stopPropagation(); setOpen(false, true) }
  })
  sdk.listen(menu, 'keydown', event => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation() }
      setOpen(false, true)
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation()
      const index = choices.indexOf(document.activeElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length
      choices[next].focus()
    }
  })
  sdk.listen(window, 'resize', position)
  sdk.listen(window, 'blur', () => setOpen(false))
  sdk.listen(menu, 'wheel', event => event.stopPropagation())
  control.append(apply, toggle); stage.append(menu); update()
  ctx.effect(() => () => { menu.remove(); control.remove() })
  return control
}
