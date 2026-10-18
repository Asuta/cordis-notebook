export function createApplicationSettings({ ctx, sdk, el, button, root, side }) {
  const app = sdk.application || {}
  const sections = new Map()
  const dialog = el("dialog", { class: "studio-app-settings", "aria-labelledby": "studio-app-settings-title" })
  const title = el("h2", { id: "studio-app-settings-title" }, (app.name || "当前应用") + "设置")
  const subtitle = el("p", { class: "studio-app-settings-subtitle" }, "管理当前应用自己的设置，不影响其他应用或项目级配置。")
  const close = el("button", { type: "button", class: "studio-app-settings-close", "aria-label": "关闭应用设置" }, "关闭")
  const header = el("header", { class: "studio-app-settings-header" })
  const headerCopy = el("div")
  headerCopy.append(title, subtitle)
  header.append(headerCopy, close)

  const section = el("section", { class: "studio-app-settings-section" })
  const sectionHead = el("div", { class: "studio-app-settings-section-head" })
  const sectionCopy = el("div")
  sectionCopy.append(el("h3", {}, "数据目录"), el("p", {}, "保存灵感画布的画板、生成记录、收藏和媒体文件。"))
  sectionHead.append(sectionCopy, el("span", { class: "studio-app-settings-scope" }, "仅当前应用"))
  const current = el("div", { class: "studio-app-settings-path" })
  const currentPath = el("code", { id: "studio-app-data-path" }, "读取中…")
  current.append(el("span", {}, "当前目录"), currentPath)
  const target = el("input", { type: "text", autocomplete: "off", "aria-label": "新的数据目录", placeholder: "输入绝对路径，或点击浏览…" })
  const field = el("label", { class: "studio-app-settings-field" })
  field.append(el("span", {}, "目标文件夹"), target)
  const browse = el("button", { type: "button" }, "浏览…")
  const attach = el("button", { type: "button" }, "接入已有目录")
  const migrate = el("button", { type: "button", class: "studio-primary" }, "迁移到这里")
  const actions = el("div", { class: "studio-app-settings-actions" })
  actions.append(browse, attach, migrate)
  const status = el("p", { class: "studio-app-settings-status", role: "status" })
  section.append(sectionHead, current, field, actions, status)
  const customSections = el("div", { class: "studio-app-settings-sections" })
  const footer = el("footer", { class: "studio-app-settings-footer" }, "迁移会保留原目录作为备份；笔记、画图和项目状态不会随这里切换。")
  dialog.append(header, section, customSections, footer)

  const entry = button("⚙ 应用设置", () => open(), "studio-app-settings-entry")
  entry.title = "设置当前应用的数据目录等信息"
  side.append(entry)
  root.append(dialog)

  let busy = false, standalone = false
  function setBusy(value, message = "") {
    busy = value
    for (const control of [browse, attach, migrate]) control.disabled = value || standalone
    close.disabled = value
    status.textContent = message
  }
  async function load() {
    setBusy(true, "正在读取数据目录…")
    try {
      const info = await sdk.request("/api/application-data-directory")
      standalone = !!info.standalone
      title.textContent = (info.app?.name || app.name || "当前应用") + "设置"
      currentPath.textContent = info.path
      currentPath.title = info.path
      setBusy(false, standalone ? "单插件开发模式不支持切换数据目录。" : "")
    } catch (error) {
      setBusy(false, "读取失败：" + error.message)
    }
  }
  async function open() {
    if (!dialog.open) dialog.showModal()
    await load()
    await Promise.allSettled([...sections.values()].map(item => item.definition.refresh?.()))
  }
  browse.onclick = async () => {
    setBusy(true, "请在弹出的窗口中选择文件夹…")
    try {
      const picked = await sdk.request("/api/application-data-directory/pick", "POST", {})
      if (picked.path) target.value = picked.path
      setBusy(false, picked.path ? "" : "未选择文件夹。")
    } catch (error) {
      setBusy(false, error.message)
    }
  }
  async function relocate(action) {
    const path = target.value.trim()
    if (!path) {
      status.textContent = "请先选择或输入目标文件夹。"
      target.focus()
      return
    }
    setBusy(true, action === "migrate" ? "正在复制并校验数据，请勿关闭页面…" : "正在接入数据目录…")
    try {
      const result = await sdk.request("/api/application-data-directory", "POST", { action, path })
      setBusy(false, "已切换到 " + result.path + "，页面即将重新载入。")
      setTimeout(() => location.reload(), 500)
    } catch (error) {
      setBusy(false, error.message)
    }
  }
  close.onclick = () => { if (!busy) dialog.close() }
  attach.onclick = () => { void relocate("attach") }
  migrate.onclick = () => { void relocate("migrate") }
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault() })
  dialog.addEventListener("click", event => {
    if (event.target !== dialog || busy) return
    const bounds = dialog.getBoundingClientRect()
    const outside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom
    if (outside) dialog.close()
  })
  function register(owner, definition) {
    if (!definition || !/^[a-z][a-z0-9-]*$/.test(definition.id) || sections.has(definition.id)) throw Error("应用设置区块无效或重复")
    return owner.effect(() => {
      const section = el("section", { class: "studio-app-settings-section studio-app-settings-extension" })
      const head = el("div", { class: "studio-app-settings-section-head" }), copy = el("div")
      copy.append(el("h3", {}, definition.title), el("p", {}, definition.description || ""))
      head.append(copy, el("span", { class: "studio-app-settings-scope" }, definition.scope || "仅当前应用"))
      const content = el("div", { class: "studio-app-settings-extension-content" })
      section.append(head, content)
      const item = { definition, section, dispose: definition.render?.(content) }
      sections.set(definition.id, item)
      customSections.append(section)
      return () => {
        item.dispose?.()
        section.remove()
        sections.delete(definition.id)
      }
    })
  }
  ctx.effect(() => () => { entry.remove(); dialog.remove() })
  return { open, register }
}
