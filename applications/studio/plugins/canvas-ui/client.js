import { cardBounds, fitView, arrangeGrid, moveDelta, overlayPosition } from './geometry.js'
import { arrangeCanvas, canvasLayouts } from './layouts.js'
import { createLayoutMenu } from './layout-menu.js'
import { createMediaViewer } from './media-viewer.js'
import { createApplicationSettings } from './settings.js'
export default async function (ctx, sdk) {
  const s = ctx.canvasSession, el = sdk.el, uuid = () => crypto.randomUUID();
  const { board, api, edit, flush, draft, choose, newBoard, refresh, imageUrl, rememberAsset, importImage, saveViewport } = s;
  const renderers = new Map(), menus = new Map(), extensions = new Map(), renderedNodes = new Map();
  const cardElements = new Map(), cardSizes = new Map(), wireElements = new Map();
  let pointerFrame = null, pendingPointer = null, canvasWindowFrame = null, windowBounds = null, boardsSignature = '';
  let overviewEnabled = true, overviewMode = s.viewport.zoom <= 0.32;
  let stopped = false, drag = null, connecting = null, connectDrag = null, space = false, viewTimer, selectionSignature = "", editingField = null, suppressCardClick = false, renamingBoardId = null;
  let clipboard = null, lastPointer = null, pasteTarget = null;
  const selected = new Set();
  const interactions = new Set();
  const root = el("main", { class: "studio-app" }), side = el("aside", { class: "studio-sidebar" }), main = el("section", { class: "studio-main" });
  const toolbar = el("header", { class: "studio-toolbar" }), stage = el("div", { class: "studio-stage", tabIndex: 0, "aria-label": "无限画布" });
  const world = el("div", { class: "studio-world" }), cards = el("div", { class: "studio-cards" });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("studio-wires");
  const boardList = el("nav", { class: "studio-boards", "aria-label": "画板列表" });
  const assetPanel = el("section", { class: "studio-asset-panel", "aria-label": "素材库" });
  const assetHeader = el("header", { class: "studio-asset-header" }), assetCount = el("span", { class: "studio-asset-count", "aria-live": "polite" }, "0");
  const assetsTools = el("div", { class: "studio-assets-tools" }), assetsList = el("div", { class: "studio-assets" });
  const assetHeading = el("div", { class: "studio-asset-heading" });
  assetHeading.append(el("strong", {}, "素材库"), assetCount);
  assetHeader.append(assetHeading);
  assetPanel.append(assetHeader, assetsTools, assetsList);
  const boardTitle = el("input", { class: "studio-board-title", "aria-label": "画板名称", maxLength: 120 }), notice = el("span", { class: "studio-status" }, "已保存");
  const zoomLabel = el("select", { "aria-label": "画布缩放" }), empty = el("div", { class: "studio-empty" });
  const contextTools = el("div", { class: "studio-context-tools", role: "toolbar", "aria-label": "所选卡片工具", hidden: true });
  const bottomControls = el("div", { class: "studio-bottom-controls" }), dock = el("div", { class: "studio-action-dock", role: "toolbar", "aria-label": "画布工具" });
  const selectionBox = el("div", { class: "studio-selection-box", hidden: true }), returnViews = new Map();
  const safe = (action) => async (event) => {
    try {
      await action(event);
    } catch (error) {
      notice.textContent = "操作未完成";
      sdk.toast(error.message);
    }
  };
  function beginEditing(input) {
    editingField = input;
    s.editing = true;
  }
  function endEditing(input) {
    // A previous blur may finish saving after another field has gained focus.
    if (editingField !== input) return;
    editingField = null;
    s.editing = false;
  }
  const button = (text, action, cls = "") => {
    const b = el("button", { type: "button", class: cls }, text);
    b.onpointerdown = (event) => {
      if (event.button === 0 && s.editing) event.preventDefault();
    };
    b.onclick = safe((event) => {
      b.focus();
      return action(event);
    });
    return b;
  };
  const themeKey = "studio-theme";
  const savedTheme = () => {
    const value = sdk.storage.local.getItem(themeKey);
    return value === "light" || value === "dark" ? value : null;
  };
  const themeQuery = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  let theme = savedTheme() || (themeQuery?.matches ? "dark" : "light");
  const themeToggle = button("", () => setTheme(theme === "dark" ? "light" : "dark", true), "studio-theme-toggle");
  function setTheme(value, persist = false) {
    theme = value;
    root.dataset.theme = value;
    root.style.colorScheme = value;
    themeToggle.textContent = value === "dark" ? "☀ 浅色模式" : "◐ 深色模式";
    themeToggle.title = value === "dark" ? "切换到浅色模式" : "切换到深色模式";
    themeToggle.setAttribute("aria-label", themeToggle.title);
    themeToggle.setAttribute("aria-pressed", String(value === "dark"));
    if (persist) sdk.storage.local.setItem(themeKey, value);
  }
  setTheme(theme);
  if (themeQuery) sdk.listen(themeQuery, "change", () => {
    if (!savedTheme()) setTheme(themeQuery.matches ? "dark" : "light");
  });
  const mediaViewer = createMediaViewer({ ctx, s, el, button, root });
  const position = () => {
    const point = { x: Math.round((stage.clientWidth / 2 - s.viewport.x) / s.viewport.zoom - 140), y: Math.round((stage.clientHeight / 2 - s.viewport.y) / s.viewport.zoom - 130) };
    while (board().nodes.some((n) => Math.abs(n.x - point.x) < 300 && Math.abs(n.y - point.y) < 280)) point.x += 340;
    return point;
  };
  async function add(type, extra = {}, options = {}) {
    await flush();
    const id = uuid();
    await edit([{ type: "add", node: { id, type, ...position(), ...extra } }]);
    selected.clear();
    selected.add(id);
    render();
    if (options.fit === true) fit();
    return id;
  }
  async function connect(from, to) {
    stopConnecting();
    await flush();
    await edit([{ type: "connect", id: uuid(), from, to }]);
    notice.textContent = "已连接输入";
    render();
  }
  async function historyStep(back) {
    await flush();
    const source = back ? s.undo : s.redo, target = back ? s.redo : s.undo, stack = source.get(s.boardId) || [];
    if (!stack.length) return;
    const result = await edit(stack.at(-1), { history: false });
    stack.pop();
    const next = target.get(s.boardId) || [];
    next.push(result.inverse);
    target.set(s.boardId, next);
    render();
  }
  const newBoardButton = button("＋ 新建画板", () => newBoard(), "studio-new-board")
  const sideTabs = el("div", { class: "studio-sidebar-tabs", role: "tablist", "aria-label": "侧栏页面" })
  const sideCanvas = el("div", { class: "studio-sidebar-page is-canvas", id: "studio-side-canvas", role: "tabpanel", "aria-label": "画板" })
  const sideAssets = el("div", { class: "studio-sidebar-page is-assets", id: "studio-side-assets", role: "tabpanel", "aria-label": "素材库", hidden: true })
  const sideMain = el("div", { class: "studio-sidebar-main" })
  const canvasTab = button("画板", () => showSidePage("canvas"), "studio-sidebar-tab")
  const assetsTab = button("素材库", () => showSidePage("assets"), "studio-sidebar-tab")
  for (const [tab, page, label] of [[canvasTab, "canvas", "画板"], [assetsTab, "assets", "素材库"]]) {
    tab.dataset.sidePage = page
    tab.id = "studio-side-tab-" + page
    tab.setAttribute("role", "tab")
    tab.setAttribute("aria-controls", "studio-side-" + page)
    tab.setAttribute("aria-label", label)
  }
  sideCanvas.setAttribute("aria-labelledby", canvasTab.id)
  sideAssets.setAttribute("aria-labelledby", assetsTab.id)
  sideTabs.append(canvasTab, assetsTab)
  sideCanvas.append(newBoardButton, boardList, sideMain, themeToggle)
  sideAssets.append(assetPanel)
  side.append(
    el("div", { class: "studio-brand" }, "✳ 灵感画布"),
    el("p", { class: "studio-tagline" }, "让想法，有形可见。"),
    sideTabs,
    sideCanvas,
    sideAssets
  )
  function showSidePage(name) {
    const assets = name === "assets"
    sideCanvas.hidden = assets
    sideAssets.hidden = !assets
    for (const [tab, active] of [[canvasTab, !assets], [assetsTab, assets]]) {
      tab.classList.toggle("is-active", active)
      tab.setAttribute("aria-selected", String(active))
      tab.tabIndex = active ? 0 : -1
    }
    extensions.get('assets')?.refresh?.()
  }
  showSidePage("canvas")
  sdk.listen(document, 'pointerdown', event => {
    if (event.target.closest('.studio-board-menu')) return;
    for (const menu of boardList.querySelectorAll('.studio-board-menu[open]')) menu.open = false;
  });
  const undoButton = button("↶", () => historyStep(true)), redoButton = button("↷", () => historyStep(false));
  undoButton.title = "撤销 Ctrl+Z";
  redoButton.title = "重做 Ctrl+Shift+Z";
  const tidyControl = createLayoutMenu({ ctx, sdk, el, button, stage, run: tidyCanvas });
  dock.append(tidyControl, undoButton, redoButton);
  toolbar.append(
    boardTitle,
    notice,
    button("载入最新", async () => {
      if (s.drafts.size && !window.confirm("本页未保存草稿将被放弃，请先复制需要保留的文字。是否载入已保存画板？")) return;
      await s.discardDrafts();
      notice.textContent = "已载入最新画板";
    })
  );
  boardTitle.onfocus = () => {
    beginEditing(boardTitle);
    updateSelectionTools();
  };
  boardTitle.oninput = () => draft({ id: s.titleDraftId, title: s.renderedTitle }, "title", boardTitle.value);
  boardTitle.onblur = safe(async () => {
    try { await flush(); }
    finally { endEditing(boardTitle); if (!s.drafts.size) render(); }
  });
  empty.append(el("div", { class: "studio-empty-symbol" }, "✳"), el("h1", {}, "给灵感一片空白"), el("p", {}, "放入图片，写下想法，连接到生成卡片。"), el("small", {}, "也可以把图片拖到这里，或让右侧 Agent 帮你搭建画布。"));
  const controls = el("div", { class: "studio-viewport-controls" });
  controls.setAttribute("role", "toolbar");
  controls.setAttribute("aria-label", "画布导航");
  for (const n of [15, 25, 50, 75, 100, 125, 150, 200, 300]) zoomLabel.append(el("option", { value: String(n) }, n + "%"));
  const customZoom = el("option", { value: "custom", disabled: true });
  zoomLabel.prepend(customZoom);
  zoomLabel.onchange = () => zoom(Number(zoomLabel.value) / 100);
  const focusButton = button("聚焦所选", () => focusView(true)), returnButton = button("返回视图", returnView);
  controls.append(button("−", () => zoom(s.viewport.zoom / 1.2)), zoomLabel, button("＋", () => zoom(s.viewport.zoom * 1.2)), button("适应画布", () => focusView(false)), focusButton, returnButton);
  const hint = el("div", { class: "studio-canvas-hint" }, "中键拖动平移 · 左键框选 · 滚轮缩放 · Esc 退出编辑/选择");
  bottomControls.append(dock, controls);
  world.append(svg, cards);
  stage.append(world, empty, selectionBox, contextTools, bottomControls, hint);
  main.append(toolbar, stage);
  root.append(side, main);
  sdk.mount("app", root);
  const applicationSettings = createApplicationSettings({ ctx, sdk, el, button, root, side: sideCanvas });
  function syncOverviewMode() {
    const previous = overviewMode;
    if (!overviewEnabled || s.viewport.zoom >= 0.38) overviewMode = false;
    else if (s.viewport.zoom <= 0.32) overviewMode = true;
    root.classList.toggle('is-overview', overviewMode);
    return previous !== overviewMode;
  }
  function transform() {
    const overviewChanged = syncOverviewMode();
    world.style.transform = `translate(${s.viewport.x}px,${s.viewport.y}px) scale(${s.viewport.zoom})`;
    const inverseZoom = 1 / s.viewport.zoom;
    world.style.setProperty('--studio-inverse-zoom', String(inverseZoom));
    world.style.setProperty('--studio-wire-width', `${3 * inverseZoom}px`);
    world.style.setProperty('--studio-wire-hover-width', `${4 * inverseZoom}px`);
    const percent = Math.round(s.viewport.zoom * 100);
    customZoom.textContent = percent + "%";
    zoomLabel.value = [15, 25, 50, 75, 100, 125, 150, 200, 300].includes(percent) ? String(percent) : "custom";
    stage.style.backgroundSize = `${24 * s.viewport.zoom}px ${24 * s.viewport.zoom}px`;
    stage.style.backgroundPosition = `${s.viewport.x}px ${s.viewport.y}px`;
    placeContextTools();
    scheduleCanvasWindow(overviewChanged);
  }
  function zoom(value, x = stage.clientWidth / 2, y = stage.clientHeight / 2) {
    value = Math.max(0.15, Math.min(3, value));
    const factor = value / s.viewport.zoom;
    s.viewport.x = x - (x - s.viewport.x) * factor;
    s.viewport.y = y - (y - s.viewport.y) * factor;
    s.viewport.zoom = value;
    transform();
    scheduleViewport();
  }
  const selectedNodes = () => board().nodes.filter((n) => selected.has(n.id));
  function cardSize(node) {
    const renderer = renderers.get(node.type), estimate = renderer?.estimateSize?.(node);
    const item = cardElements.get(node.id);
    // Persisted sizes must win over absent or stale DOM, including cached measurements.
    if (estimate && (!item || JSON.stringify(estimate) !== JSON.stringify(renderer.estimateSize(renderedNodes.get(node.id))))) return estimate;
    if (cardSizes.has(node.id)) return cardSizes.get(node.id);
    const size = { width: item?.offsetWidth || estimate?.width || 288, height: item?.offsetHeight || estimate?.height || node.cardHeight || (renderer?.height || 230) };
    if (item?.offsetWidth) cardSizes.set(node.id, size);
    return size;
  }
  const bottomInset = () => (bottomControls.offsetHeight || 48) + 32;
  function fit(nodes = board().nodes) {
    const next = fitView(cardBounds(nodes, cardSize), stage.clientWidth, stage.clientHeight, bottomInset(), selected.size && !s.editing ? (contextTools.offsetHeight || 48) + 24 : 32);
    s.viewport = next || (nodes.length ? s.viewport : { x: 60, y: 60, zoom: 1 });
    transform();
    scheduleViewport();
  }
  function focusView(selectionOnly) {
    if (selectionOnly && !selected.size) return;
    returnViews.set(s.boardId, { ...s.viewport });
    fit(selectionOnly ? selectedNodes() : board().nodes);
    updateSelectionTools();
  }
  function returnView() {
    const previous = returnViews.get(s.boardId);
    if (!previous) return;
    s.viewport = previous;
    returnViews.delete(s.boardId);
    transform();
    scheduleViewport();
    updateSelectionTools();
  }
  async function removeNodes(ids) {
    const existing = ids.filter((id) => board().nodes.some((node) => node.id === id));
    if (!existing.length) {
      for (const id of ids) selected.delete(id);
      render();
      return;
    }
    try {
      await edit([{ type: "remove", ids: existing }]);
      for (const id of existing) selected.delete(id);
      render();
    } catch (error) {
      // 其他页面可能已删除或修改卡片；先同步最新画布，避免持续用过期 revision 删除。
      try { await refresh({ fresh: true }) } catch {}
      for (const id of [...selected]) if (!board().nodes.some((node) => node.id === id)) selected.delete(id);
      render();
      throw error;
    }
  }
  async function removeSelection() {
    await flush();
    await removeNodes([...selected]);
  }
  async function arrangeSelection() {
    await flush();
    const operations = arrangeGrid(selectedNodes(), cardSize);
    if (operations.length > 100) throw Error("请每次选择不超过 100 张卡片进行排列。");
    if (operations.length) await edit(operations);
  }
  async function arrangeNodes(nodeIds, options = {}) {
    await flush();
    const nodes = nodeIds.map(id => board().nodes.find(node => node.id === id)).filter(Boolean), layout = {};
    if (options.after) {
      const anchor = board().nodes.find(node => node.id === options.after);
      if (!anchor) throw Error('排列参照卡片不存在');
      layout.startX = anchor.x + cardSize(anchor).width + (options.gap ?? 120); layout.startY = anchor.y;
    }
    const operations = arrangeGrid(nodes, cardSize, layout);
    if (operations.length > 100) throw Error('请每次排列不超过 100 张卡片。');
    if (operations.length) await edit([{ type: 'layout', nodes: operations }]);
  }
  async function tidyCanvas(algorithm) {
    await flush();
    const operations = arrangeCanvas(board().nodes, board().edges, cardSize, algorithm);
    if (operations.length) await edit([{ type: 'layout', nodes: operations }], { repaint: false });
    selected.clear();
    render();
    fit();
    notice.textContent = `${canvasLayouts.find(layout => layout.id === algorithm).label} · 已整理 ${board().nodes.length} 张卡片`;
  }
  async function stackSelection(position) {
    await flush();
    const ids = new Set(selected), nodes = board().nodes;
    if (!ids.size || !nodes.some(node => ids.has(node.id))) return;
    const picked = nodes.filter(node => ids.has(node.id)), rest = nodes.filter(node => !ids.has(node.id));
    const order = position === "front" ? [...rest, ...picked] : [...picked, ...rest];
    if (order.every((node, index) => node.id === nodes[index].id)) return;
    await edit([{ type: "stack", order: order.map(node => node.id) }]);
  }
  async function duplicateSelection() {
    await flush();
    const nodeIds = [...selected], targetBoard = s.boardId;
    if (!nodeIds.length) return;
    const copy = await api('/copy', { boardId: targetBoard, revision: board().revision, nodeIds });
    await edit(copy.operations, { targetBoard, expectedRevision: copy.revision });
    if (s.boardId !== targetBoard) return;
    selected.clear();
    copy.nodeIds.forEach((id) => selected.add(id));
    render();
  }
  function placeContextTools() {
    if (contextTools.hidden || !stage.clientWidth || !stage.clientHeight) return;
    const bounds = cardBounds(selectedNodes(), cardSize);
    if (!bounds) return;
    contextTools.style.maxHeight = Math.max(0, stage.clientHeight - bottomInset() - 16) + "px";
    const position2 = overlayPosition({
      x: s.viewport.x + bounds.x * s.viewport.zoom,
      y: s.viewport.y + bounds.y * s.viewport.zoom,
      width: bounds.width * s.viewport.zoom,
      height: bounds.height * s.viewport.zoom
    }, contextTools.offsetWidth, contextTools.offsetHeight, stage.clientWidth, stage.clientHeight, bottomInset());
    contextTools.style.left = position2.x + "px";
    contextTools.style.top = position2.y + "px";
  }
  function selectionActions(nodes) {
    const contributors = [...new Set(nodes.map(node => renderers.get(node.type)).filter(Boolean))], offeredActions = [];
    for (const renderer of contributors) {
      for (const action of renderer.selectionActions?.(nodes, view) || []) offeredActions.push({ action, run: () => action.run(nodes, view) });
      if (nodes.length === 1) for (const action of renderer.actions || []) offeredActions.push({ action, run: () => action.run(nodes[0], view) });
    }
    return offeredActions;
  }
  function updateSelectionTools() {
    const nodes = selectedNodes(), offeredActions = selectionActions(nodes);
    const actionSignature = offeredActions.map(({ action }) => [action.id || '', action.label, action.disabled === true, action.title || '']);
    const signature = JSON.stringify([s.boardId, s.editing, nodes.map((n) => [n.id, n.type, n.title]), actionSignature]);
    for (const card of cards.children) card.classList.toggle("selected", selected.has(card.dataset.node));
    focusButton.disabled = !nodes.length;
    returnButton.disabled = !returnViews.has(s.boardId);
    contextTools.hidden = !nodes.length || s.editing || !!drag;
    if (signature !== selectionSignature) {
      selectionSignature = signature;
      contextTools.replaceChildren();
      if (nodes.length) {
        contextTools.append(el("span", { class: "studio-selection-label" }, nodes.length > 1 ? `已选 ${nodes.length} 张卡片` : renderers.get(nodes[0].type)?.label || "插件未启用"), button("聚焦", () => focusView(true)));
        for (const [index, { action }] of offeredActions.entries()) {
          const actionButton = button(action.label, () => {
            const current = selectionActions(selectedNodes())[index];
            if (current && current.action.disabled !== true) return current.run();
          });
          actionButton.disabled = action.disabled === true;
          if (action.id) actionButton.dataset.actionId = action.id;
          if (action.title) actionButton.title = action.title;
          contextTools.append(actionButton);
        }
        if (nodes.length > 1) contextTools.append(button("整理为网格", arrangeSelection));
        contextTools.append(button("置于顶层", () => stackSelection("front")), button("置于底层", () => stackSelection("back")));
        contextTools.append(button("创建副本", duplicateSelection), button("删除所选", removeSelection, "studio-danger"));
      }
      paintWires();
    }
    placeContextTools();
  }
  function scheduleViewport() {
    clearTimeout(viewTimer);
    viewTimer = setTimeout(() => saveViewport().catch((error) => sdk.toast(error.message)), 500);
  }
  function wirePath(from, to) {
    const distance = Math.max(70, Math.abs(to.x - from.x) * 0.45);
    return `M ${from.x} ${from.y} C ${from.x + distance} ${from.y}, ${to.x - distance} ${to.y}, ${to.x} ${to.y}`;
  }
  function portPoint(node, side) {
    return { x: node.x + (side === "output" ? cardSize(node).width : 0), y: node.y + 40 };
  }
  function paintWires() {
    const nodes = new Map(board().nodes.map(node => [node.id, node])), keep = new Set();
    function wire(key, from, to, edge) {
      if (!from || !to) return;
      keep.add(key);
      let path = wireElements.get(key);
      if (!path) {
        path = document.createElementNS(svg.namespaceURI, 'path');
        const title = document.createElementNS(svg.namespaceURI, 'title');
        title.textContent = edge ? '点击断开连线' : '生成结果来源';
        path.append(title);
        if (edge) {
          path.dataset.edge = edge.id;
          path.onclick = safe(async event => { event.stopPropagation(); await edit([{ type: 'disconnect', id: edge.id }]); });
        } else path.classList.add('studio-result-wire');
        wireElements.set(key, path);
        svg.append(path);
      }
      const d = wirePath(portPoint(from, 'output'), portPoint(to, 'input'));
      if (path.getAttribute('d') !== d) path.setAttribute('d', d);
      path.classList.toggle('is-selected', selected.has(from.id) && selected.has(to.id));
    }
    for (const edge of board().edges) {
      wire('edge:' + edge.id, nodes.get(edge.from), nodes.get(edge.to), edge);
    }
    for (const result of nodes.values()) if (result.sourceNodeId) wire('result:' + result.id, nodes.get(result.sourceNodeId), result);
    for (const [key, path] of wireElements) if (!keep.has(key)) {
      path.remove(); wireElements.delete(key);
    }
  }
  function field(node, prop, area = false, onSaved = null) {
    const value = s.drafts.get(node.id)?.patch[prop] ?? node[prop];
    const input = el(area ? "textarea" : "input", { value, "aria-label": node.title + (prop === "prompt" ? " 提示词" : prop === "text" ? " 文字内容" : " 标题"), maxLength: prop === 'prompt' ? 24000 : area ? 12e3 : 120 });
    input.onfocus = () => {
      beginEditing(input);
      selected.clear();
      selected.add(node.id);
      updateSelectionTools();
    };
    input.oninput = () => draft(node, prop, input.value);
    input.onblur = safe(async () => {
      try { await flush(); onSaved?.(input); }
      finally { endEditing(input); if (!s.drafts.size) render(); }
    });
    input.onkeydown = (event) => {
      if (event.isComposing || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      selected.clear();
      selected.add(node.id);
      input.blur();
      stage.focus({ preventScroll: true });
      updateSelectionTools();
    };
    return input;
  }
  function renderCard(node, overview = false, overviewHeight = 0) {
    const card = el("article", { class: "studio-card studio-" + node.type + (selected.has(node.id) ? " selected" : "") + (overview ? " is-overview" : "") });
    card.studioOverview = overview;
    card.dataset.node = node.id;
    card.style.left = node.x + "px";
    card.style.top = node.y + "px";
    if (overview) card.style.height = Math.max(120, overviewHeight || 230) + 'px';
    const head = el("div", { class: "studio-card-head" });
    head.dataset.handle = node.id;
    const title = el("span", {}, node.title);
    title.title = "双击修改卡片标题";
    title.ondblclick = (event) => {
      event.stopPropagation();
      const input = field(renderedNodes.get(node.id) || node, "title", false, (input) => {
        title.textContent = board().nodes.find(item => item.id === node.id)?.title ?? input.value;
        input.replaceWith(title);
      });
      title.replaceWith(input);
      input.focus();
      input.select();
    };
    const renderer = renderers.get(node.type);
    card.studioRenderer = renderer;
    card.studioNode = JSON.stringify(node);
    head.append(el("span", { class: "studio-kind" }, renderer?.icon || "?"));
    head.append(title);
    card.append(head);
    if (renderer?.input || renderer?.output) {
      const port = button(renderer.input ? "输入" : "连接", () => {
      });
      port.className = "studio-port " + (renderer.input ? "input" : "output");
      port.title = renderer.input ? "接入兼容卡片" : "拖动或点击连接到输入圆点";
      port.dataset[renderer.input ? "input" : "output"] = node.id;
      card.append(port);
    }
    if (renderer && overview) {
      if (renderer.renderOverview) renderer.renderOverview(node, card, view);
      else card.append(el('div', { class: 'studio-overview-summary' }, node.title));
    }
    else if (renderer) renderer.render(node, card, view);
    else card.append(el("p", { class: "studio-missing-card" }, `“${node.title}”的卡片功能暂不可用，请在插件管理中启用对应功能。内容和连线已保留。`));
    if (!overview) for (const extension of extensions.values()) extension.card?.(node, card, view);
    return card;
  }
  function beginBoardRename(id) {
    renamingBoardId = id;
    render();
    queueMicrotask(() => boardList.querySelector('[data-board-rename="' + id + '"]')?.focus());
  }
  function boardRow(item) {
    if (renamingBoardId === item.id) {
      const input = el('input', { class: 'studio-board-rename', 'data-board-rename': item.id, 'aria-label': '重命名画板', value: item.title, maxLength: 120 });
      let cancelled = false;
      input.onfocus = () => beginEditing(input);
      input.onkeydown = (event) => {
        if (event.key === 'Escape') { cancelled = true; event.preventDefault(); input.blur(); }
        else if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
      };
      input.onblur = safe(async () => {
        try {
          const title = input.value.trim();
          if (!cancelled && title && title !== item.title) await s.renameBoard(item.id, title);
        } finally {
          endEditing(input); renamingBoardId = null; render();
        }
      });
      return input;
    }
    const row = el('div', { class: 'studio-board-item' });
    const chooseBoard = button(item.title, () => choose(item.id), item.id === s.boardId ? 'active' : '');
    const menu = el('details', { class: 'studio-board-menu' });
    const summary = el('summary', { 'aria-label': `管理画板 ${item.title}`, title: '画板操作' }, '⋯');
    const actions = el('div', { class: 'studio-board-menu-panel' });
    actions.append(
      button('重命名', () => { menu.open = false; beginBoardRename(item.id); }),
      button('复制画板', async () => { menu.open = false; await s.duplicateBoard(item.id); }),
    );
    menu.append(summary, actions); row.append(chooseBoard, menu); return row;
  }
  function cardSignature(node, overview = false) {
    const renderer = renderers.get(node.type);
    return JSON.stringify([node, overview ? renderer?.overviewKey?.(node, view) : renderer?.renderKey?.(node, view), overview]);
  }
  function shouldOverview(node) {
    if (!overviewMode || selected.has(node.id) || s.drafts.has(node.id)) return false;
    const card = cardElements.get(node.id), player = node.type === 'video' && card?.querySelector('video');
    return !card?.contains(document.activeElement) && !(player && !player.paused && !player.ended);
  }
  function canvasBounds(margin = 0) {
    const zoom = s.viewport.zoom;
    return { left: (-s.viewport.x - margin) / zoom, top: (-s.viewport.y - margin) / zoom,
      right: (-s.viewport.x + stage.clientWidth + margin) / zoom, bottom: (-s.viewport.y + stage.clientHeight + margin) / zoom };
  }
  function viewportNodes() {
    if (!stage.clientWidth || !stage.clientHeight) { windowBounds = null; return board().nodes; }
    const { left, top, right, bottom } = canvasBounds(520);
    windowBounds = { left, top, right, bottom, boardId: s.boardId };
    return board().nodes.filter(node => {
      const card = cardElements.get(node.id);
      const player = node.type === 'video' && card?.querySelector('video');
      if (selected.has(node.id) || card?.contains(document.activeElement) || player && !player.paused && !player.ended) return true;
      const size = cardSize(node);
      return node.x <= right && node.x + size.width >= left && node.y <= bottom && node.y + size.height >= top;
    });
  }
  function detachCard(card) {
    resizeObserver?.unobserve(card);
    card.studioRenderer?.detachCard?.(renderedNodes.get(card.dataset.node), card, view);
    card.remove();
    cardElements.delete(card.dataset.node); renderedNodes.delete(card.dataset.node);
  }
  function renderCanvasCards(windowOnly = false) {
    if (stopped || s.editing || interactions.size || drag?.type === 'nodes') return;
    const nodes = viewportNodes(), keep = new Set(nodes.map(node => node.id));
    for (const node of nodes) {
      const existing = cardElements.get(node.id), renderer = renderers.get(node.type), overview = shouldOverview(node);
      if (windowOnly && existing?.studioRenderer === renderer && existing.studioOverview === overview) {
        existing.classList.toggle('selected', selected.has(node.id));
        if (existing.style.left !== node.x + 'px') existing.style.left = node.x + 'px';
        if (existing.style.top !== node.y + 'px') existing.style.top = node.y + 'px';
        continue;
      }
      const signature = cardSignature(node, overview);
      const preserveDOM = windowOnly || renderer?.renderKey || (typeof renderer?.preserveDOM === 'function' ? renderer.preserveDOM(node) : renderer?.preserveDOM);
      if (preserveDOM && existing?.studioRenderer === renderer && existing?.studioSignature === signature && existing.studioOverview === overview) {
        existing.classList.toggle('selected', selected.has(node.id));
        if (existing.style.left !== node.x + 'px') existing.style.left = node.x + 'px';
        if (existing.style.top !== node.y + 'px') existing.style.top = node.y + 'px';
        continue;
      }
      const overviewHeight = overview ? node.cardHeight || cardSize(node).height : 0;
      const rendered = structuredClone(node);
      // Build before detaching so renderers can recover scroll state from the old card.
      const card = renderCard(rendered, overview, overviewHeight);
      if (existing) detachCard(existing);
      renderedNodes.set(node.id, rendered); cardElements.set(node.id, card); cardSizes.delete(node.id);
      card.studioSignature = signature;
      cards.append(card); resizeObserver?.observe(card);
      if (!overview) renderer?.attachCard?.(rendered, card, view);
    }
    for (const [id, card] of cardElements) if (!keep.has(id)) detachCard(card);
    nodes.forEach((node, index) => { const card = cardElements.get(node.id); if (cards.children[index] !== card) cards.insertBefore(card, cards.children[index] || null); });
    const ids = new Set(board().nodes.map(node => node.id));
    for (const id of cardSizes.keys()) if (!ids.has(id)) cardSizes.delete(id);
  }
  function scheduleCanvasWindow(force = false) {
    if (stopped || document.hidden || canvasWindowFrame !== null) return;
    if (!force && windowBounds?.boardId === s.boardId && stage.clientWidth && stage.clientHeight) {
      const visible = canvasBounds(), inset = 160 / s.viewport.zoom;
      if (visible.left >= windowBounds.left + inset && visible.right <= windowBounds.right - inset &&
          visible.top >= windowBounds.top + inset && visible.bottom <= windowBounds.bottom - inset) return;
    }
    canvasWindowFrame = window.requestAnimationFrame(() => {
      canvasWindowFrame = null;
      renderCanvasCards(true);
    });
  }
  function render() {
    if (stopped || document.hidden || drag || interactions.size || s.editing) return;
    syncOverviewMode();
    const restoreFocus = cards.contains(document.activeElement);
    for (const id of selected) if (!board().nodes.some((n) => n.id === id)) selected.delete(id);
    s.renderedTitle = board().title;
    boardTitle.value = s.drafts.get(s.titleDraftId)?.patch.title ?? s.renderedTitle;
    const nextBoards = JSON.stringify([s.boardId, renamingBoardId, s.state.boards.map(({ id, title }) => [id, title])]);
    if (nextBoards !== boardsSignature) { boardsSignature = nextBoards; boardList.replaceChildren(...s.state.boards.map(boardRow)); }
    for (const extension of extensions.values()) extension.refresh?.();
    renderCanvasCards();
    empty.hidden = board().nodes.length > 0;
    if (restoreFocus) stage.focus({ preventScroll: true });
    undoButton.disabled = !s.undo.get(s.boardId)?.length;
    redoButton.disabled = !s.redo.get(s.boardId)?.length;
    paintWires();
    transform();
    updateSelectionTools();
  }
  const coordinates = (event) => {
    const rect = stage.getBoundingClientRect();
    return { x: (event.clientX - rect.left - s.viewport.x) / s.viewport.zoom, y: (event.clientY - rect.top - s.viewport.y) / s.viewport.zoom };
  };
  function setPasteTarget(target) {
    if (pasteTarget === target) return;
    pasteTarget?.clear?.();
    pasteTarget = target;
  }
  function clearPasteTarget() {
    if (!pasteTarget) return;
    pasteTarget.clear?.();
    pasteTarget = null;
  }
  function canConnect(from, to) {
    if (!from || !to || from === to) return false;
    const targetNode = board().nodes.find((node) => node.id === to);
    if (!targetNode || !renderers.get(targetNode.type)?.input) return false;
    if (board().edges.some((edge) => edge.from === from && edge.to === to)) return false;
    const types = new Map((s.state.types || []).map((type) => [type.id, type]));
    const sourceType = types.get(board().nodes.find((node) => node.id === from)?.type), targetType = types.get(targetNode.type);
    // The server remains the authority when a view is still loading type metadata.
    return !sourceType || !targetType ? true : !!targetType.accepts?.includes(sourceType.output);
  }
  function connectionPair(mode, origin, target) {
    if (!origin || !target) return null;
    return mode === "forward" ? { from: origin, to: target } : { from: target, to: origin };
  }
  function connectPreview(state, point) {
    const origin = board().nodes.find((node) => node.id === state.origin);
    if (!origin) return;
    let path = svg.querySelector('.studio-connect-preview');
    if (!path) {
      path = document.createElementNS(svg.namespaceURI, 'path');
      path.classList.add('studio-connect-preview');
      svg.append(path);
    }
    path.setAttribute('d', state.mode === "forward"
      ? wirePath(portPoint(origin, "output"), point)
      : wirePath(point, portPoint(origin, "input")));
  }
  function clearConnectDrag() {
    stage.classList.remove('is-connecting');
    delete stage.dataset.connectMode;
    if (!connectDrag) return;
    const state = connectDrag;
    connectDrag = null;
    svg.querySelector('.studio-connect-preview')?.remove();
    for (const card of cards.children) card.classList.remove('is-connect-target', 'is-connect-invalid');
    if (stage.hasPointerCapture?.(state.pointerId)) stage.releasePointerCapture(state.pointerId);
  }
  function stopConnecting() {
    connecting = null;
    stage.classList.remove('is-connecting');
    delete stage.dataset.connectMode;
  }
  function updateConnectDrag(event) {
    if (!connectDrag || event.pointerId !== connectDrag.pointerId) return;
    if (Math.hypot(event.clientX - connectDrag.startX, event.clientY - connectDrag.startY) >= 4) connectDrag.moved = true;
    if (!connectDrag.moved) return;
    const element = document.elementFromPoint(event.clientX, event.clientY), card = element?.closest('[data-node]');
    const target = card?.dataset.node || null;
    const candidate = connectDrag.mode === "forward" ? { from: connectDrag.origin, to: target } : { from: target, to: connectDrag.origin };
    const valid = canConnect(candidate.from, candidate.to);
    connectDrag.candidate = valid ? candidate : null;
    for (const item of cards.children) {
      item.classList.toggle('is-connect-target', !!valid && item.dataset.node === target);
      item.classList.toggle('is-connect-invalid', !!target && !valid && item.dataset.node === target);
    }
    connectPreview(connectDrag, coordinates(event));
  }
  async function copySelectedToClipboard() {
    if (!selected.size) return;
    await flush();
    const nodeIds = [...selected], targetBoard = s.boardId;
    const copy = await api('/copy', { boardId: targetBoard, revision: board().revision, nodeIds });
    clipboard = { operations: copy.operations, count: nodeIds.length, boardId: targetBoard };
    notice.textContent = `已复制 ${nodeIds.length} 张卡片`;
    sdk.toast(`已复制 ${nodeIds.length} 张卡片，Ctrl+V 粘贴`);
  }
  function materializeClipboard(point) {
    const operations = structuredClone(clipboard.operations), additions = operations.filter((operation) => operation.type === 'add');
    if (!additions.length) return null;
    const nodeIds = new Map(additions.map((operation) => [operation.node.id, uuid()]));
    const minX = Math.min(...additions.map((operation) => operation.node.x)), maxX = Math.max(...additions.map((operation) => operation.node.x));
    const minY = Math.min(...additions.map((operation) => operation.node.y)), maxY = Math.max(...additions.map((operation) => operation.node.y));
    const dx = Math.max(-100000 - minX, Math.min(100000 - maxX, Math.round(point.x - minX)));
    const dy = Math.max(-100000 - minY, Math.min(100000 - maxY, Math.round(point.y - minY)));
    for (const operation of operations) {
      if (operation.type === 'add') {
        operation.node.id = nodeIds.get(operation.node.id);
        operation.node.x += dx; operation.node.y += dy;
        if (operation.node.sourceNodeId) operation.node.sourceNodeId = nodeIds.get(operation.node.sourceNodeId) || undefined;
        if (!operation.node.sourceNodeId) delete operation.node.sourceNodeId;
      } else if (operation.type === 'connect') {
        operation.id = uuid(); operation.from = nodeIds.get(operation.from); operation.to = nodeIds.get(operation.to);
      }
    }
    return { operations, nodeIds: [...nodeIds.values()] };
  }
  async function pasteClipboard(point) {
    if (!clipboard) return false;
    const copy = materializeClipboard(point);
    if (!copy) return false;
    await flush();
    await edit(copy.operations);
    selected.clear();
    copy.nodeIds.forEach((id) => selected.add(id));
    render();
    notice.textContent = `已粘贴 ${copy.nodeIds.length} 张卡片`;
    return true;
  }
  function clipboardImage() {
    if (!clipboard) return null;
    const additions = clipboard.operations.filter((operation) => operation.type === 'add');
    if (additions.length !== 1 || additions[0].node.type !== 'image' || !additions[0].node.assetId || s.state.assets[additions[0].node.assetId]?.kind !== 'image') return null;
    return additions[0].node;
  }
  sdk.listen(stage, "pointerdown", (event) => {
    if (s.held || stopped || event.button > 1 || drag || event.target.closest(".studio-context-tools,.studio-bottom-controls,.studio-layout-menu")) return;
    const left = event.button === 0, middle = event.button === 1, card = event.target.closest("[data-node]");
    lastPointer = coordinates(event);
    if (!event.target.closest('.studio-reference-row')) clearPasteTarget();
    const pan = (space && left) || (middle && !card);
    const output = event.target.closest("[data-output]"), input = event.target.closest("[data-input]");
    if (left && !space && connecting && card) {
      const pair = connectionPair(connecting.mode, connecting.origin, card.dataset.node);
      if (pair && canConnect(pair.from, pair.to)) { stopConnecting(); void safe(() => connect(pair.from, pair.to))(); return; }
      sdk.toast(connecting.mode === "forward" ? '这张卡片不能接收当前连线' : '这张卡片不能作为当前参数卡的输入');
      return;
    }
    if (left && !space && (output || input)) {
      stopConnecting();
      const mode = output ? "forward" : "reverse", origin = (output || input).dataset[mode === "forward" ? "output" : "input"];
      connectDrag = { mode, origin, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false, candidate: null };
      stage.classList.add('is-connecting');
      stage.dataset.connectMode = mode;
      stage.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }
    if (left && !space && event.target.closest("button,input,textarea,select,a,path,label,[role=button],[contenteditable=true]")) return;
    const scroller = event.target.closest(".studio-scroll");
    if (left && !space && event.target === scroller && ((scroller.clientWidth > 0 && event.offsetX >= scroller.clientWidth) || (scroller.clientHeight > 0 && event.offsetY >= scroller.clientHeight))) return;
    if (card && !pan) {
      if (left && (event.shiftKey || event.ctrlKey || event.metaKey)) {
        selected.has(card.dataset.node) ? selected.delete(card.dataset.node) : selected.add(card.dataset.node);
        updateSelectionTools();
        scheduleCanvasWindow(true);
        return;
      }
      if (!selected.has(card.dataset.node)) {
        selected.clear();
        selected.add(card.dataset.node);
      }
      drag = { type: "nodes", start: coordinates(event), nodes: board().nodes.filter((n) => selected.has(n.id)).map((n) => ({ id: n.id, x: n.x, y: n.y })) };
    } else if (left && !space) {
      if (connecting) stopConnecting();
      const extend = event.shiftKey || event.ctrlKey || event.metaKey;
      drag = { type: "select", start: coordinates(event), selected: new Set(selected), extend };
      if (!drag.extend) selected.clear();
    } else {
      drag = { type: "pan", x: event.clientX, y: event.clientY, before: { ...s.viewport } };
    }
    Object.assign(drag, { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, moved: false });
    if (drag.type !== "nodes") stage.setPointerCapture?.(event.pointerId);
    stage.focus({ preventScroll: true });
    if (middle || drag.type !== "nodes") event.preventDefault();
    updateSelectionTools();
  });
  function movePointer(event) {
    if (!drag && !connectDrag) return;
    if (event.pointerId !== (drag || connectDrag).pointerId) return;
    pendingPointer = event;
    if (pointerFrame !== null) return;
    pointerFrame = window.requestAnimationFrame(() => {
      pointerFrame = null;
      const latest = pendingPointer; pendingPointer = null;
      if (latest) applyPointer(latest);
    });
  }
  function clearPointerFrame() {
    if (pointerFrame !== null) window.cancelAnimationFrame(pointerFrame);
    pointerFrame = null; pendingPointer = null;
  }
  function applyPointer(event) {
    if (connectDrag) updateConnectDrag(event);
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) > 4) drag.moved = true;
    if (!drag.moved) return;
    if (drag.type === "pan") {
      s.viewport.x = Math.max(-1e5, Math.min(1e5, drag.before.x + event.clientX - drag.x));
      s.viewport.y = Math.max(-1e5, Math.min(1e5, drag.before.y + event.clientY - drag.y));
      transform();
    } else {
      const point = coordinates(event);
      if (drag.type === "nodes") {
        const delta = moveDelta(drag.nodes, point.x - drag.start.x, point.y - drag.start.y);
        for (const before of drag.nodes) {
          const node = board().nodes.find((n) => n.id === before.id);
          node.x = before.x + delta.x;
          node.y = before.y + delta.y;
          const item = cardElements.get(node.id);
          if (item) { item.style.left = node.x + "px"; item.style.top = node.y + "px"; }
        }
        ;
        paintWires();
      } else {
        selectionBox.hidden = false;
        Object.assign(selectionBox.style, {
          left: s.viewport.x + Math.min(point.x, drag.start.x) * s.viewport.zoom + "px",
          top: s.viewport.y + Math.min(point.y, drag.start.y) * s.viewport.zoom + "px",
          width: Math.abs(point.x - drag.start.x) * s.viewport.zoom + "px",
          height: Math.abs(point.y - drag.start.y) * s.viewport.zoom + "px"
        });
        for (const node of board().nodes) {
          const size = cardSize(node), inside = node.x + size.width >= Math.min(point.x, drag.start.x) && node.x <= Math.max(point.x, drag.start.x) && node.y + size.height >= Math.min(point.y, drag.start.y) && node.y <= Math.max(point.y, drag.start.y);
          if (inside || drag.extend && drag.selected.has(node.id)) selected.add(node.id);
          else selected.delete(node.id);
        }
        updateSelectionTools();
      }
    }
  }
  sdk.listen(window, "pointermove", movePointer);
  sdk.listen(stage, "pointermove", (event) => { lastPointer = coordinates(event) });
  function cancelGesture() {
    clearPointerFrame();
    if (connectDrag) clearConnectDrag();
    if (!drag) return;
    const previous = drag;
    drag = null;
    if (previous.type === "nodes") for (const before of previous.nodes) Object.assign(board().nodes.find((n) => n.id === before.id), before);
    if (previous.type === "pan") s.viewport = previous.before;
    if (previous.type === "select") {
      selected.clear();
      previous.selected.forEach((id) => selected.add(id));
    }
    if (stage.hasPointerCapture?.(previous.pointerId)) stage.releasePointerCapture(previous.pointerId);
    selectionBox.hidden = true;
    render();
  }
  const release = safe(async (event) => {
    if (event.pointerId === (drag || connectDrag)?.pointerId) {
      clearPointerFrame();
      applyPointer(event);
    }
    if (connectDrag && event.pointerId === connectDrag.pointerId) {
      const state = connectDrag;
      if (!state.moved) {
        clearConnectDrag();
        connecting = { mode: state.mode, origin: state.origin };
        stage.classList.add('is-connecting');
        stage.dataset.connectMode = state.mode;
        notice.textContent = state.mode === "forward" ? "选择接收连线的卡片" : "选择作为当前参数卡输入的卡片";
        return;
      }
      updateConnectDrag(event);
      const candidate = connectDrag?.candidate;
      clearConnectDrag(); stopConnecting();
      if (candidate) await connect(candidate.from, candidate.to);
      return;
    }
    if (connecting) {
      const mode = connecting.mode;
      const card = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-node]");
      const pair = connectionPair(connecting.mode, connecting.origin, card?.dataset.node);
      stopConnecting();
      if (pair && canConnect(pair.from, pair.to)) await connect(pair.from, pair.to);
      else if (card) sdk.toast(mode === "forward" ? '这张卡片不能接收当前连线' : '这张卡片不能作为当前参数卡的输入');
    }
    if (!connecting) stage.classList.remove('is-connecting');
    if (!drag || event.pointerId !== drag.pointerId) return;
    const previous = drag;
    drag = null;
    if (stage.hasPointerCapture?.(previous.pointerId)) stage.releasePointerCapture(previous.pointerId);
    selectionBox.hidden = true;
    if (previous.type === "nodes" && previous.moved) {
      suppressCardClick = true;
      setTimeout(() => { suppressCardClick = false }, 0);
      const operations = previous.nodes.map((old) => {
        const n = board().nodes.find((n2) => n2.id === old.id);
        const patch = { x: n.x, y: n.y };
        Object.assign(n, old);
        return { type: "update", id: old.id, patch };
      }).filter((op) => previous.nodes.some((n) => n.id === op.id && (n.x !== op.patch.x || n.y !== op.patch.y)));
      try {
        if (operations.length) {
          await edit(operations, { repaint: false });
          for (const before of previous.nodes) {
            const node = board().nodes.find((item) => item.id === before.id);
            view.syncRenderedNode(before.id, { x: node.x, y: node.y });
          }
        }
      } catch (error) {
        render();
        throw error;
      }
    } else if (previous.type === "pan" && previous.moved) await saveViewport();
    // Keep the pressed element connected for a normal click. Moving cards already
    // updates their live position, so saving that position must not rebuild media.
    updateSelectionTools();
    scheduleCanvasWindow(true);
  });
  sdk.listen(window, "pointerup", release);
  sdk.listen(stage, "auxclick", event => { if (event.button === 1) event.preventDefault() });
  const blockDraggedCardClick = event => {
    if (!suppressCardClick) return;
    suppressCardClick = false;
    event.preventDefault();
    event.stopPropagation();
  };
  stage.addEventListener("click", blockDraggedCardClick, true);
  ctx.effect(() => () => stage.removeEventListener("click", blockDraggedCardClick, true));
  sdk.listen(stage, "pointercancel", cancelGesture);
  sdk.listen(stage, "lostpointercapture", cancelGesture);
  sdk.listen(window, "blur", () => {
    space = false;
    stopConnecting();
    clearConnectDrag();
    cancelGesture();
  });
  sdk.listen(stage, "wheel", (event) => {
    const rect = stage.getBoundingClientRect();
    const forceZoom = event.ctrlKey || event.metaKey;
    if (!forceZoom && event.target.closest("textarea,select,video,.studio-scroll,.studio-context-tools,.studio-bottom-controls")) return;
    event.preventDefault();
    if (drag) return;
    zoom(s.viewport.zoom * Math.exp(-event.deltaY * 1e-3), event.clientX - rect.left, event.clientY - rect.top);
  });
  sdk.listen(window, "keydown", safe(async (event) => {
    if (event.isComposing || !root.contains(event.target) || event.target.closest("input,textarea,select") || root.querySelector("dialog[open]")) return;
    if (event.code === "Space") {
      space = true;
      event.preventDefault();
    }
    if (event.key === "Escape") {
      if (drag) {
        cancelGesture();
        return;
      }
      stopConnecting();
      clearConnectDrag();
      clearPasteTarget();
      selected.clear();
      render();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      const current = selectedNodes();
      const group = current.length === 1 ? renderers.get(current[0].type)?.selectionGroup?.(current[0], view) : null;
      if (group?.length) {
        selected.clear();
        group.forEach(node => selected.add(node.id));
      } else board().nodes.forEach((n) => selected.add(n.id));
      updateSelectionTools();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      await historyStep(!event.shiftKey);
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
      if (!selected.size) return;
      event.preventDefault();
      await copySelectedToClipboard();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
      if (pasteTarget && !pasteTarget.valid?.()) clearPasteTarget();
      if (pasteTarget) {
        if (!clipboard) return;
        event.preventDefault();
        const image = clipboardImage();
        if (!image) { sdk.toast('参考槽位只能粘贴单张图片卡片'); return; }
        await flush();
        await pasteTarget.apply(image.assetId);
        clearPasteTarget();
        notice.textContent = '已粘贴到参考槽位';
        return;
      }
      if (clipboard) {
        event.preventDefault();
        await pasteClipboard(lastPointer || position());
      }
    }
    if (event.key === "Delete" && selected.size) {
      event.preventDefault();
      await removeNodes([...selected]);
    }
  }));
  const resizeObserver = typeof window.ResizeObserver === "function" ? new window.ResizeObserver(entries => {
    for (const entry of entries) if (entry.target.dataset.node) cardSizes.delete(entry.target.dataset.node);
    placeContextTools(); scheduleCanvasWindow(true); paintWires();
  }) : null;
  resizeObserver?.observe(stage);
  resizeObserver?.observe(cards);
  resizeObserver?.observe(contextTools);
  sdk.listen(window, "keyup", (event) => {
    if (event.code === "Space") space = false;
  });
  sdk.listen(document, 'visibilitychange', () => {
    if (document.hidden) {
      if (canvasWindowFrame !== null) { window.cancelAnimationFrame(canvasWindowFrame); canvasWindowFrame = null; }
      for (const player of cards.querySelectorAll('video')) player.pause();
      extensions.get('assets')?.refresh?.();
      return;
    }
    void refresh({ fresh: true }).catch(error => sdk.toast(error.message)).finally(() => {
      if (!stopped && !document.hidden) render();
    });
  });
  const view = {
    el,
    button,
    safe,
    beginEditing,
    endEditing,
    beginInteraction() {
      const token = {};
      interactions.add(token);
      return () => interactions.delete(token);
    },
    field,
    add,
    edit,
    flush,
    refresh,
    board,
    imageUrl,
    api,
    root,
    empty,
    side: sideCanvas,
    sideCanvas,
    sideAssets,
    sideMain,
    showSidePage,
    stage,
    assetsList,
    assetPanel,
    assetHeader,
    assetCount,
    assetsTools,
    cards,
    position,
    coordinates,
    board: () => board(),
    state: () => s.state,
    boardId: () => s.boardId,
    execute: (...args) => s.execute(...args),
    openMedia: assetId => mediaViewer.open(assetId),
    setPasteTarget,
    clearPasteTarget,
    focusReference(target) {
      selected.clear();
      updateSelectionTools();
      setPasteTarget(target);
    },
    pointer: () => lastPointer ? { x: lastPointer.x, y: lastPointer.y } : null,
    isOverview: () => overviewMode,
    setOverviewEnabled(value) {
      overviewEnabled = Boolean(value);
      if (syncOverviewMode()) render();
    },
    render,
    select(nodeIds) {
      selected.clear();
      for (const id of nodeIds) if (board().nodes.some(node => node.id === id)) selected.add(id);
      render();
    },
    arrangeNodes,
    refreshCardLayout() {
      cardSizes.clear();
      updateSelectionTools();
      paintWires();
    },
    syncRenderedNode(id, patch) {
      const rendered = renderedNodes.get(id);
      if (!rendered) return false;
      Object.assign(rendered, patch);
      const card = cardElements.get(id);
      if (card) { card.studioNode = JSON.stringify(rendered); card.studioSignature = cardSignature(rendered, card.studioOverview); }
      return true;
    },
    register(owner, definition) {
      if (!/^[a-z][a-z0-9-]*$/.test(definition.id) || renderers.has(definition.id)) throw Error("卡片视图无效或重复");
      return owner.effect(() => {
        renderers.set(definition.id, definition);
        selectionSignature = "";
        render();
        return () => {
          if (renderers.get(definition.id) === definition) {
            renderers.delete(definition.id);
            selectionSignature = "";
            render();
          }
        };
      });
    },
    menu(owner, definition) {
      if (menus.has(definition.id)) throw Error("菜单重复");
      const update = () => dock.replaceChildren(...[...menus.values()].sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000) || a.id.localeCompare(b.id)).map((item) => {
        const control = button(typeof item.label === 'function' ? item.label() : item.label, item.run, item.className || '');
        if (item.pressed !== undefined) control.setAttribute('aria-pressed', String(typeof item.pressed === 'function' ? item.pressed() : item.pressed));
        if (item.title) control.title = typeof item.title === 'function' ? item.title() : item.title;
        return control;
      }), tidyControl, undoButton, redoButton);
      return owner.effect(() => {
        menus.set(definition.id, definition);
        update();
        return () => {
          menus.delete(definition.id);
          update();
        };
      });
    },
    settings(owner, definition) {
      return applicationSettings.register(owner, definition)
    },
    extend(owner, id, extension) {
      if (extensions.has(id)) throw Error("界面扩展重复");
      return owner.effect(() => {
        extensions.set(id, extension);
        if (extension.refresh) extension.refresh();
        else if (extension.card) {
          const nodes = new Map(board().nodes.map(node => [node.id, node]));
          for (const card of cardElements.values()) {
            if (!card.studioOverview && nodes.has(card.dataset.node)) extension.card(nodes.get(card.dataset.node), card, view);
          }
        }
        return () => {
          extensions.delete(id);
          extension.dispose?.();
        };
      });
    }
  };
  s.attachView(ctx, { render, syncRenderedNode: view.syncRenderedNode, status: (value) => notice.textContent = value, dragging: () => !!drag || interactions.size > 0, choose: () => {
    selected.clear();
    stopConnecting();
    clearConnectDrag();
    clearPasteTarget();
  }, hold: (value) => {
    root.inert = value;
  } });
  ctx.effect(() => () => {
    stopped = true;
    clearPointerFrame();
    if (canvasWindowFrame !== null) window.cancelAnimationFrame(canvasWindowFrame);
    for (const card of cardElements.values()) detachCard(card);
    resizeObserver?.disconnect();
    clearTimeout(viewTimer);
  });
  sdk.provide("canvasUI", view);
  render();
}
