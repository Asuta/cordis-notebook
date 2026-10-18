import { cardBounds, fitView, arrangeGrid, moveDelta, overlayPosition } from './geometry.js'
import { arrangeCanvas, canvasLayouts } from './layouts.js'
import { createLayoutMenu } from './layout-menu.js'
import { createMediaViewer } from './media-viewer.js'
import { createApplicationSettings } from './settings.js'
export default async function (ctx, sdk) {
  const s = ctx.canvasSession, el = sdk.el, uuid = () => crypto.randomUUID();
  const { board, api, edit, flush, draft, choose, newBoard, refresh, imageUrl, rememberAsset, importImage, saveViewport } = s;
  const renderers = new Map(), menus = new Map(), extensions = new Map();
  let stopped = false, drag = null, connecting = null, connectDrag = null, space = false, viewTimer, selectionSignature = "", editingField = null, suppressCardClick = false, renamingBoardId = null;
  let clipboard = null, lastPointer = null, pasteTarget = null;
  const selected = new Set();
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
  side.append(
    el("div", { class: "studio-brand" }, "✳ 灵感画布"),
    el("p", { class: "studio-tagline" }, "让想法，有形可见。"),
    button("＋ 新建画板", () => newBoard(), "studio-new-board"),
    boardList,
    assetPanel,
    themeToggle
  );
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
  const applicationSettings = createApplicationSettings({ ctx, sdk, el, button, root, side });
  function transform() {
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
    const item = [...cards.children].find((item2) => item2.dataset.node === node.id);
    return { width: item?.offsetWidth || 288, height: item?.offsetHeight || (renderers.get(node.type)?.height || 230) };
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
  async function removeSelection() {
    await flush();
    if (selected.size) await edit([{ type: "remove", ids: [...selected] }]);
    selected.clear();
    render();
  }
  async function arrangeSelection() {
    await flush();
    const operations = arrangeGrid(selectedNodes(), cardSize);
    if (operations.length > 100) throw Error("请每次选择不超过 100 张卡片进行排列。");
    if (operations.length) await edit(operations);
  }
  function directOutputs(node) {
    return board().nodes.filter(child => child.sourceNodeId === node.id);
  }
  function selectedSubsetGenerator(nodes) {
    const generators = nodes.filter(node => node.type === 'generator');
    if (generators.length !== 1) return null;
    const generator = generators[0], products = directOutputs(generator);
    if (nodes.length === 1) return generator.id;
    const subset = new Set([generator.id, ...products.map(product => product.id)]);
    return products.length && nodes.every(node => subset.has(node.id)) && products.every(product => selected.has(product.id)) ? generator.id : null;
  }
  async function organizeSubset(nodeId) {
    await flush();
    const node = board().nodes.find(item => item.id === nodeId && item.type === 'generator');
    if (!node) return;
    const products = directOutputs(node);
    if (products.length < 2) return;
    const operations = arrangeGrid(products, cardSize, { startX: node.x + cardSize(node).width + 120, startY: node.y });
    if (operations.length) await edit([{ type: 'layout', nodes: operations }]);
    selected.clear();
    selected.add(node.id);
    products.forEach(product => selected.add(product.id));
    updateSelectionTools();
    notice.textContent = `已整理 ${products.length} 张生成产物`;
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
  function updateSelectionTools() {
    const nodes = selectedNodes(), subset = selectedSubsetGenerator(nodes);
    const subsetProducts = subset ? directOutputs(nodes.find(node => node.id === subset)) : [];
    const signature = JSON.stringify([s.boardId, s.editing, nodes.map((n) => [n.id, n.type, n.title]), subset ? subsetProducts.map(node => node.id) : null]);
    for (const card of cards.children) card.classList.toggle("selected", selected.has(card.dataset.node));
    focusButton.disabled = !nodes.length;
    returnButton.disabled = !returnViews.has(s.boardId);
    contextTools.hidden = !nodes.length || s.editing || !!drag;
    if (signature !== selectionSignature) {
      selectionSignature = signature;
      contextTools.replaceChildren();
      if (nodes.length) {
        contextTools.append(el("span", { class: "studio-selection-label" }, nodes.length > 1 ? `已选 ${nodes.length} 张卡片` : renderers.get(nodes[0].type)?.label || "插件未启用"), button("聚焦", () => focusView(true)));
        if (nodes.length === 1) {
          const node = nodes[0];
          for (const action of renderers.get(node.type)?.actions || []) contextTools.append(button(action.label, () => action.run(node, view)));
        }
        if (subset) {
          const subsetButton = button("整理子集", () => organizeSubset(subset));
          subsetButton.disabled = subsetProducts.length < 2;
          subsetButton.title = subsetButton.disabled ? '至少需要两个直接生成产物' : '将直接生成产物在参数卡右侧整理成近方形网格';
          contextTools.append(subsetButton);
        }
        if (nodes.length > 1) contextTools.append(button("整理为网格", arrangeSelection));
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
    svg.replaceChildren();
    for (const edge of board().edges) {
      const a = board().nodes.find((n) => n.id === edge.from), b = board().nodes.find((n) => n.id === edge.to);
      const path = document.createElementNS(svg.namespaceURI, "path");
      path.setAttribute("d", wirePath(portPoint(a, "output"), portPoint(b, "input")));
      path.dataset.edge = edge.id;
      path.classList.toggle("is-selected", selected.has(edge.from) && selected.has(edge.to));
      path.onclick = safe(async (event) => {
        event.stopPropagation();
        await edit([{ type: "disconnect", id: edge.id }]);
      });
      const title = document.createElementNS(svg.namespaceURI, "title");
      title.textContent = "点击断开连线";
      path.append(title);
      svg.append(path);
    }
    for (const result of board().nodes.filter((n) => n.sourceNodeId)) {
      const source = board().nodes.find((n) => n.id === result.sourceNodeId);
      if (!source) continue;
      const path = document.createElementNS(svg.namespaceURI, "path");
      path.classList.add("studio-result-wire");
      path.classList.toggle("is-selected", selected.has(source.id) && selected.has(result.id));
      path.setAttribute("d", wirePath(portPoint(source, "output"), portPoint(result, "input")));
      const title = document.createElementNS(svg.namespaceURI, "title");
      title.textContent = "生成结果来源";
      path.append(title);
      svg.append(path);
    }
  }
  function field(node, prop, area = false) {
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
      try { await flush(); }
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
  function renderCard(node) {
    const generatedVideo = node.type === 'video' && !!node.sourceNodeId, unplayedVideo = generatedVideo && node.played !== true;
    const card = el("article", { class: `studio-card studio-${node.type}${selected.has(node.id) ? " selected" : ""}${unplayedVideo ? ' is-unplayed' : ''}` });
    card.dataset.node = node.id;
    card.style.left = node.x + "px";
    card.style.top = node.y + "px";
    const head = el("div", { class: "studio-card-head" });
    head.dataset.handle = node.id;
    const title = el("span", {}, node.title);
    title.title = "双击修改卡片标题";
    title.ondblclick = (event) => {
      event.stopPropagation();
      const input = field(node, "title");
      title.replaceWith(input);
      input.focus();
      input.select();
    };
    const renderer = renderers.get(node.type);
    card.studioRenderer = renderer;
    card.studioNode = JSON.stringify(node);
    head.append(el("span", { class: "studio-kind" }, renderer?.icon || "?"));
    if (unplayedVideo) head.append(el('span', { class: 'studio-video-unplayed' }, '未播放'));
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
    if (renderer) renderer.render(node, card, view);
    else card.append(el("p", { class: "studio-missing-card" }, `“${node.title}”的卡片功能暂不可用，请在插件管理中启用对应功能。内容和连线已保留。`));
    for (const extension of extensions.values()) extension.card?.(node, card, view);
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
  function render() {
    if (stopped || drag || s.editing) return;
    const restoreFocus = cards.contains(document.activeElement);
    for (const id of selected) if (!board().nodes.some((n) => n.id === id)) selected.delete(id);
    s.renderedTitle = board().title;
    boardTitle.value = s.drafts.get(s.titleDraftId)?.patch.title ?? s.renderedTitle;
    boardList.replaceChildren(...s.state.boards.map(boardRow));
    for (const extension of extensions.values()) extension.refresh?.();
    s.renderedNodes.clear();
    const existingCards = new Map([...cards.children].map(item => [item.dataset.node, item]));
    const nextCards = board().nodes.map((node) => {
      const rendered = structuredClone(node);
      s.renderedNodes.set(node.id, rendered);
      const existing = existingCards.get(node.id);
      // Keep an unchanged video element connected while background jobs update.
      if (node.type === 'video' && node.assetId && existing && existing.studioRenderer === renderers.get(node.type) && existing.studioNode === JSON.stringify(node)) {
        existing.classList.toggle('selected', selected.has(node.id)); return existing;
      }
      return renderCard(rendered);
    });
    const keep = new Set(nextCards);
    for (const item of [...cards.children]) if (!keep.has(item)) { resizeObserver?.unobserve(item); item.remove(); }
    nextCards.forEach((item, index) => { if (cards.children[index] !== item) cards.insertBefore(item, cards.children[index] || null); });
    empty.hidden = board().nodes.length > 0;
    for (const item of cards.children) resizeObserver?.observe(item);
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
          const item = cards.querySelector(`[data-node="${node.id}"]`);
          item.style.left = node.x + "px";
          item.style.top = node.y + "px";
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
    movePointer(event);
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
            const node = board().nodes.find((item) => item.id === before.id), rendered = s.renderedNodes.get(before.id);
            if (rendered) Object.assign(rendered, { x: node.x, y: node.y });
            const card = cards.querySelector(`[data-node="${before.id}"]`);
            if (card) card.studioNode = JSON.stringify(rendered || node);
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
      if (current.length === 1 && current[0].type === 'generator') {
        selected.clear();
        selected.add(current[0].id);
        directOutputs(current[0]).forEach(node => selected.add(node.id));
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
      await edit([{ type: "remove", ids: [...selected] }]);
      selected.clear();
      render();
    }
  }));
  const resizeObserver = typeof window.ResizeObserver === "function" ? new window.ResizeObserver(placeContextTools) : null;
  resizeObserver?.observe(stage);
  resizeObserver?.observe(cards);
  resizeObserver?.observe(contextTools);
  sdk.listen(window, "keyup", (event) => {
    if (event.code === "Space") space = false;
  });
  const view = {
    el,
    button,
    safe,
    beginEditing,
    endEditing,
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
    side,
    stage,
    assetsList,
    assetPanel,
    assetHeader,
    assetCount,
    assetsTools,
    cards,
    position,
    coordinates,
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
    render,
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
      const update = () => dock.replaceChildren(...[...menus.values()].sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000) || a.id.localeCompare(b.id)).map((item) => button(item.label, item.run, item.className || "")), tidyControl, undoButton, redoButton);
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
        extension.refresh?.();
        return () => {
          extensions.delete(id);
          extension.dispose?.();
        };
      });
    }
  };
  s.attachView(ctx, { render, status: (value) => notice.textContent = value, dragging: () => !!drag, choose: () => {
    selected.clear();
    stopConnecting();
    clearConnectDrag();
    clearPasteTarget();
  }, hold: (value) => {
    root.inert = value;
  } });
  ctx.effect(() => () => {
    stopped = true;
    resizeObserver?.disconnect();
    clearTimeout(viewTimer);
  });
  sdk.provide("canvasUI", view);
  render();
}
