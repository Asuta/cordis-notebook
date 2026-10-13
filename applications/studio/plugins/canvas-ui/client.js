import { mountSurface } from "./surface.js";
import { mountNodeCard } from "./node-presenter.js";
import { createElement as iconElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Type,
  Image,
  Settings2,
  Undo2,
  Redo2,
  Group,
  Hand,
  MousePointer2,
  Map as MapIcon,
  Palette,
  LocateFixed,
  Focus,
  CornerUpLeft,
  PanelLeftClose,
} from "lucide-react";
import {
  cardBounds,
  fitView,
  arrangeCards,
  moveDelta,
  overlayPosition,
  resizeCard,
} from "./geometry.js";
export default async function (ctx, sdk) {
  const s = ctx.canvasSession,
    el = sdk.el,
    uuid = () => crypto.randomUUID();
  const {
    board,
    api,
    edit,
    flush,
    draft,
    choose,
    newBoard,
    refresh,
    imageUrl,
    rememberAsset,
    importImage,
    saveViewport,
  } = s;
  const renderers = new Map(),
    mountedCards = new Map(),
    menus = new Map(),
    extensions = new Map(),
    cardActions = new Map();
  let surface,
    panning = false,
    canvasTool = "pan",
    backgroundMode = "lines",
    miniMap = false;
  const icon = (Icon) => {
    const span = el("span", { class: "studio-icon" });
    span.innerHTML = renderToStaticMarkup(
      iconElement(Icon, { size: 18, strokeWidth: 1.7 }),
    );
    return span;
  };
  let stopped = false,
    drag = null,
    connecting = null,
    space = false,
    viewTimer,
    selectionSignature = "";
  const selected = new Set();
  const root = el("main", { class: "studio-app" }),
    side = el("aside", { class: "studio-sidebar" }),
    main = el("section", { class: "studio-main" });
  const toolbar = el("header", { class: "studio-toolbar" }),
    stage = el("div", {
      class: "studio-stage",
      tabIndex: 0,
      "aria-label": "无限画布",
    });
  const world = el("div", { class: "studio-world" }),
    cards = el("div", { class: "studio-cards" });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("studio-wires");
  const boardList = el("nav", {
      class: "studio-boards",
      "aria-label": "画板列表",
    }),
    assetsList = el("div", { class: "studio-assets" });
  const boardTitle = el("input", {
      class: "studio-board-title",
      "aria-label": "画板名称",
      maxLength: 120,
    }),
    notice = el("span", { class: "studio-status" }, "已保存");
  const zoomLabel = el("select", { "aria-label": "画布缩放" }),
    empty = el("div", { class: "studio-empty" });
  const contextTools = el("div", {
    class: "studio-context-tools",
    role: "toolbar",
    "aria-label": "所选卡片工具",
    hidden: true,
  });
  const bottomControls = el("div", { class: "studio-bottom-controls" }),
    dock = el("div", {
      class: "studio-action-dock",
      role: "toolbar",
      "aria-label": "画布工具",
    });
  const selectionBox = el("div", {
      class: "studio-selection-box",
      hidden: true,
    }),
    returnViews = new Map();
  const safe = (action) => async (event) => {
    try {
      await action(event);
    } catch (error) {
      notice.textContent = "操作未完成";
      sdk.toast(error.message);
    }
  };
  const button = (text, action, cls = "") => {
    const b = el(
      "button",
      { type: "button", class: cls, "aria-label": text },
      text,
    );
    b.onpointerdown = (event) => {
      if (event.button === 0 && s.editing) event.preventDefault();
    };
    b.onclick = safe((event) => {
      b.focus();
      return action(event);
    });
    return b;
  };
  const position = () => {
    const point = {
      x: Math.round(
        (stage.clientWidth / 2 - s.viewport.x) / s.viewport.zoom - 140,
      ),
      y: Math.round(
        (stage.clientHeight / 2 - s.viewport.y) / s.viewport.zoom - 130,
      ),
    };
    for (let i = 0; i <= board().nodes.length; i++) {
      const overlap = board().nodes.find(
        (n) =>
          n.type !== "group" &&
          n.x < point.x + 340 &&
          n.x + cardSize(n).width > point.x &&
          n.y < point.y + 280 &&
          n.y + cardSize(n).height > point.y,
      );
      if (!overlap) break;
      point.x = overlap.x + cardSize(overlap).width + 80;
    }
    return point;
  };
  async function add(type, extra = {}) {
    await flush();
    const id = uuid();
    await edit([{ type: "add", node: { id, type, ...position(), ...extra } }]);
    selected.clear();
    selected.add(id);
    render();
    fit();
    return id;
  }
  async function connect(from, to) {
    connecting = null;
    await flush();
    await edit([{ type: "connect", id: uuid(), from, to }]);
    notice.textContent = "已连接输入";
    render();
  }
  async function historyStep(back) {
    await flush();
    const source = back ? s.undo : s.redo,
      target = back ? s.redo : s.undo,
      stack = source.get(s.boardId) || [];
    if (!stack.length) return;
    const result = await edit(stack.at(-1), { history: false });
    stack.pop();
    const next = target.get(s.boardId) || [];
    next.push(result.inverse);
    target.set(s.boardId, next);
    render();
  }
  side.append(
    el("div", { class: "studio-brand", hidden: true }, "灵感画布"),
    el("p", { class: "studio-tagline", hidden: true }, "让想法，有形可见。"),
    button("＋ 新建画板", () => newBoard(), "studio-new-board"),
    boardList,
    el("div", { class: "studio-sidebar-label" }, "素材库"),
    assetsList,
  );
  const undoButton = button("↶", () => historyStep(true)),
    redoButton = button("↷", () => historyStep(false));
  undoButton.title = "撤销 Ctrl+Z";
  redoButton.title = "重做 Ctrl+Shift+Z";
  dock.append(undoButton, redoButton);
  toolbar.append(
    boardTitle,
    notice,
    button("载入最新", async () => {
      if (
        s.drafts.size &&
        !window.confirm(
          "本页未保存草稿将被放弃，请先复制需要保留的文字。是否载入已保存画板？",
        )
      )
        return;
      await s.discardDrafts();
      notice.textContent = "已载入最新画板";
    }),
  );
  boardTitle.onfocus = () => {
    s.editing = true;
    updateSelectionTools();
  };
  boardTitle.oninput = () =>
    draft(
      { id: s.titleDraftId, title: s.renderedTitle },
      "title",
      boardTitle.value,
    );
  boardTitle.onblur = safe(async () => {
    s.editing = false;
    await flush();
    if (!s.drafts.size) render();
  });
  empty.append(
    el("div", { class: "studio-empty-symbol" }, "✳"),
    el("h1", {}, "给灵感一片空白"),
    el("p", {}, "放入图片，写下想法，连接到生成卡片。"),
    el("small", {}, "也可以把图片拖到这里，或让右侧 Agent 帮你搭建画布。"),
  );
  const controls = el("div", { class: "studio-viewport-controls" });
  controls.setAttribute("role", "toolbar");
  controls.setAttribute("aria-label", "画布导航");
  for (const n of [15, 25, 50, 75, 100, 125, 150, 200, 300])
    zoomLabel.append(el("option", { value: String(n) }, n + "%"));
  const customZoom = el("option", { value: "custom", disabled: true });
  zoomLabel.prepend(customZoom);
  zoomLabel.onchange = () => zoom(Number(zoomLabel.value) / 100);
  const focusButton = button("聚焦所选", () => focusView(true)),
    returnButton = button("返回视图", returnView),
    fitViewButton = button("适应画布", () => focusView(false));
  for (const [control, Icon, label] of [
    [fitViewButton, LocateFixed, "适应画布"],
    [focusButton, Focus, "聚焦所选"],
    [returnButton, CornerUpLeft, "返回视图"],
  ]) {
    control.replaceChildren(icon(Icon));
    control.setAttribute("aria-label", label);
    control.title = label;
  }
  controls.append(
    button("−", () => zoom(s.viewport.zoom / 1.2)),
    zoomLabel,
    button("＋", () => zoom(s.viewport.zoom * 1.2)),
    fitViewButton,
    focusButton,
    returnButton,
  );
  const hint = el(
    "div",
    { class: "studio-canvas-hint" },
    "空白拖动平移 · 滚轮缩放 · Shift 框选 · Esc 退出编辑/选择",
  );
  bottomControls.append(dock, controls);
  world.append(svg, cards);
  stage.append(world, empty, selectionBox, contextTools, bottomControls, hint);
  main.append(toolbar, stage);
  root.append(side, main);
  root.classList.toggle('studio-embedded', window.parent !== window);
  sdk.mount("app", root);
  function transform() {
    surface?.update(s.viewport, { tool: canvasTool, backgroundMode });
    surface?.minimap(miniMap, board(), s.viewport, cardSize);
    const percent = Math.round(s.viewport.zoom * 100);
    customZoom.textContent = percent + "%";
    zoomLabel.value = [15, 25, 50, 75, 100, 125, 150, 200, 300].includes(
      percent,
    )
      ? String(percent)
      : "custom";
    stage.style.backgroundSize = `${24 * s.viewport.zoom}px ${24 * s.viewport.zoom}px`;
    stage.style.backgroundPosition = `${s.viewport.x}px ${s.viewport.y}px`;
    placeContextTools();
    for (const entry of mountedCards.values()) entry.controller?.updateUI();
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
    const renderer = renderers.get(node.type);
    if (renderer?.upstream) {
      const defaults = renderer.size?.(node) || { width: 340, height: 240 };
      return { width: node.width || defaults.width, height: node.height || defaults.height };
    }
    const item = [...cards.children].find(
      (item2) => item2.dataset.node === node.id,
    );
    return {
      width: node.width || item?.offsetWidth || 340,
      height:
        node.height ||
        item?.offsetHeight ||
        renderers.get(node.type)?.height ||
        240,
    };
  }
  const bottomInset = () => (bottomControls.offsetHeight || 48) + 32;
  function fit(nodes = board().nodes) {
    const next = fitView(
      cardBounds(nodes, cardSize),
      stage.clientWidth,
      stage.clientHeight,
      bottomInset(),
      selected.size && !s.editing ? (contextTools.offsetHeight || 48) + 24 : 32,
    );
    s.viewport =
      next || (nodes.length ? s.viewport : { x: 60, y: 60, zoom: 1 });
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
  function revealPanel(id) {
    const node = board().nodes.find(n => n.id === id), panel = mountedCards.get(id)?.card.querySelector('[data-node-panel]');
    if (!node || !panel || !stage.clientHeight) return;
    const height = panel.getBoundingClientRect().height, dimensions = cardSize(node);
    const bottom = stage.clientHeight - bottomInset() - height - 12;
    const topInset = (contextTools.offsetHeight || 48) + 64;
    const nextZoom = Math.max(.15, Math.min(s.viewport.zoom, (bottom - topInset) / dimensions.height));
    const top = Math.max(topInset, Math.min(bottom - dimensions.height * nextZoom, s.viewport.y + node.y * s.viewport.zoom));
    const panelWidth = Math.min(600, stage.clientWidth - 32);
    const center = Math.max(panelWidth / 2 + 16, Math.min(stage.clientWidth - panelWidth / 2 - 16, s.viewport.x + (node.x + dimensions.width / 2) * s.viewport.zoom));
    s.viewport = { x: center - (node.x + dimensions.width / 2) * nextZoom, y: top - node.y * nextZoom, zoom: nextZoom };
    transform(); scheduleViewport();
  }
  async function removeSelection() {
    await flush();
    for (const child of board().nodes)
      if (child.groupId && selected.has(child.groupId)) selected.add(child.id);
    if (selected.size) await edit([{ type: "remove", ids: [...selected] }]);
    selected.clear();
    render();
  }
  async function arrange(direction) {
    await flush();
    const operations = arrangeCards(selectedNodes(), direction, cardSize, board().nodes);
    if (operations.length > 100)
      throw Error("请每次选择不超过 100 张卡片进行排列。");
    if (operations.length) await edit(operations);
  }
  async function duplicateSelection() {
    await flush();
    for (const child of board().nodes)
      if (child.groupId && selected.has(child.groupId)) selected.add(child.id);
    const nodes = selectedNodes().sort(
        (a, b) => Number(b.type === "group") - Number(a.type === "group"),
      ),
      ids = new Map(nodes.map((n) => [n.id, uuid()]));
    if (!nodes.length) return;
    const delta = moveDelta(nodes, 40, 40);
    const operations = nodes.map((n) => {
      const node = {
        ...n,
        id: ids.get(n.id),
        x: n.x + delta.x,
        y: n.y + delta.y,
      };
      if (n.groupId) {
        if (ids.has(n.groupId)) node.groupId = ids.get(n.groupId);
        else delete node.groupId;
      }
      return { type: "add", node };
    });
    for (const edge of board().edges)
      if (ids.has(edge.from) && ids.has(edge.to))
        operations.push({
          type: "connect",
          id: uuid(),
          from: ids.get(edge.from),
          to: ids.get(edge.to),
        });
    if (operations.length > 100)
      throw Error("所选卡片和内部连线过多，请分批创建副本。");
    await edit(operations);
    selected.clear();
    ids.forEach((id) => selected.add(id));
    render();
  }
  function placeContextTools() {
    if (contextTools.hidden || !stage.clientWidth || !stage.clientHeight)
      return;
    const bounds = cardBounds(selectedNodes(), cardSize);
    if (!bounds) return;
    contextTools.style.maxHeight =
      Math.max(0, stage.clientHeight - bottomInset() - 16) + "px";
    const position2 = overlayPosition(
      {
        x: s.viewport.x + bounds.x * s.viewport.zoom,
        y: s.viewport.y + bounds.y * s.viewport.zoom - 28 * s.viewport.zoom,
        width: bounds.width * s.viewport.zoom,
        height: (bounds.height + 28) * s.viewport.zoom,
      },
      contextTools.offsetWidth,
      contextTools.offsetHeight,
      stage.clientWidth,
      stage.clientHeight,
      bottomInset(),
    );
    contextTools.style.left = position2.x + "px";
    contextTools.style.top = position2.y + "px";
  }
  function updateSelectionTools() {
    const nodes = selectedNodes(),
      signature = JSON.stringify([
        s.boardId,
        s.editing,
        nodes.map((n) => [n.id, n.type, n.title]),
      ]);
    for (const card of cards.children)
      card.classList.toggle("selected", selected.has(card.dataset.node));
    for (const entry of mountedCards.values()) entry.controller?.updateUI();
    focusButton.disabled = !nodes.length;
    returnButton.disabled = !returnViews.has(s.boardId);
    contextTools.hidden = !nodes.length || s.editing || !!drag;
    if (signature !== selectionSignature) {
      selectionSignature = signature;
      contextTools.replaceChildren();
      if (nodes.length) {
        contextTools.append(
          el(
            "span",
            { class: "studio-selection-label" },
            nodes.length > 1
              ? `已选 ${nodes.length} 张卡片`
              : renderers.get(nodes[0].type)?.label || "插件未启用",
          ),
          button("聚焦", () => focusView(true)),
        );
        if (nodes.length === 1) {
          const node = nodes[0];
          for (const action of [
            ...(renderers.get(node.type)?.actions || []),
            ...[...cardActions.values()]
              .filter((entry) => entry.type === node.type)
              .flatMap((entry) => entry.actions),
          ])
            contextTools.append(
              button(action.label, () => action.run(node, view)),
            );
        } else
          contextTools.append(
            button("水平排列", () => arrange("horizontal")),
            button("垂直排列", () => arrange("vertical")),
          );
        if (s.actions.get("group") && nodes.length > 1)
          contextTools.append(
            button("编组", () => s.execute("group", { ids: [...selected] })),
          );
        if (
          s.actions.get("ungroup") &&
          nodes.some((n) => n.type === "group" || n.groupId)
        )
          contextTools.append(
            button("取消编组", () =>
              s.execute("ungroup", { ids: [...selected] }),
            ),
          );
        contextTools.append(
          button("创建副本", duplicateSelection),
          button("删除所选", removeSelection, "studio-danger"),
        );
      }
    }
    placeContextTools();
  }
  function scheduleViewport() {
    clearTimeout(viewTimer);
    viewTimer = setTimeout(
      () => saveViewport().catch((error) => sdk.toast(error.message)),
      500,
    );
  }
  function paintWires() {
    surface?.wires(board(), cardSize, (id) =>
      safe(() => edit([{ type: "disconnect", id }]))(),
    );
  }
  function field(node, prop, area = false) {
    const value = s.drafts.get(node.id)?.patch[prop] ?? node[prop];
    const input = el(area ? "textarea" : "input", {
      value,
      "aria-label":
        node.title +
        (prop === "prompt"
          ? " 提示词"
          : prop === "text"
            ? " 文字内容"
            : " 标题"),
      maxLength: area ? 12e3 : 120,
    });
    input.onfocus = () => {
      s.editing = true;
      selected.clear();
      selected.add(node.id);
      updateSelectionTools();
    };
    input.oninput = () => draft(node, prop, input.value);
    input.onblur = safe(async () => {
      s.editing = false;
      await flush();
      if (!s.drafts.size) render();
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
    const card = el("article", {
      class: `studio-card studio-${node.type}${selected.has(node.id) ? " selected" : ""}`,
    });
    card.dataset.node = node.id;
    card.dataset.nodeId = node.id;
    if (node.width) card.style.width = node.width + "px";
    else if (node.type === "image")
      card.style.width =
        Math.min(640, s.state.assets[node.assetId]?.width || 340) + "px";
    if (node.height) card.style.minHeight = node.height + "px";
    if (node.groupId) card.dataset.groupId = node.groupId;
    card.style.left = node.x + "px";
    card.style.top = node.y + "px";
    const renderer = renderers.get(node.type);
    if (renderer?.upstream) {
      card.classList.add('studio-card-upstream');
      placeCard(card, node);
      const controller = renderer.render(node, card, view);
      mountedCards.set(node.id, { card, renderer, controller, boardId: s.boardId });
      return card;
    }
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
    head.append(
      el("span", { class: "studio-kind" }, renderer?.icon || "?"),
      title,
    );
    card.append(head);
    if (renderer?.input || renderer?.output) {
      const port = button(renderer.input ? "输入" : "连接", () => {});
      port.className = "studio-port " + (renderer.input ? "input" : "output");
      port.title = renderer.input ? "接入兼容卡片" : "拖动或点击连接到输入圆点";
      port.dataset[renderer.input ? "input" : "output"] = node.id;
      card.append(port);
    }
    if (renderer) renderer.render(node, card, view);
    else
      card.append(
        el(
          "p",
          { class: "studio-missing-card" },
          `“${node.title}”的卡片功能暂不可用，请在插件管理中启用对应功能。内容和连线已保留。`,
        ),
      );
    return card;
  }
  function placeCard(card, node) {
    const size = cardSize(node);
    Object.assign(card.style, { left: node.x + 'px', top: node.y + 'px', width: size.width + 'px', height: size.height + 'px', minHeight: '0' });
    if (node.groupId) card.dataset.groupId = node.groupId;
    else delete card.dataset.groupId;
  }
  function render() {
    if (stopped || drag || s.editing) return;
    const restoreFocus = cards.contains(document.activeElement);
    renderSidebar();
    for (const id of selected)
      if (!board().nodes.some((n) => n.id === id)) selected.delete(id);
    s.renderedTitle = board().title;
    boardTitle.value =
      s.drafts.get(s.titleDraftId)?.patch.title ?? s.renderedTitle;
    boardList.replaceChildren(
      ...s.state.boards.map((b) =>
        button(b.title, () => choose(b.id), b.id === s.boardId ? "active" : ""),
      ),
    );
    for (const extension of extensions.values()) extension.refresh?.();
    s.renderedNodes.clear();
    for (const item of cards.children) resizeObserver?.unobserve(item);
    for (const [id, entry] of mountedCards) {
      const node = board().nodes.find(n => n.id === id);
      if (entry.boardId !== s.boardId || !node || entry.renderer !== renderers.get(node.type)) {
        entry.controller?.dispose(); entry.card.remove(); mountedCards.delete(id);
      }
    }
    const nextCards = board().nodes.map((node) => {
        const rendered = structuredClone(node);
        s.renderedNodes.set(node.id, rendered);
        const entry = mountedCards.get(node.id);
        if (entry) { placeCard(entry.card, node); entry.controller?.update(rendered); return entry.card; }
        return renderCard(rendered);
      });
    // Keep the DOM identity of mounted React cards, including their editor and composer state.
    for (const card of [...cards.children]) if (!nextCards.includes(card)) card.remove();
    nextCards.forEach((card, index) => { if (cards.children[index] !== card) cards.insertBefore(card, cards.children[index] || null); });
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
    return {
      x: (event.clientX - rect.left - s.viewport.x) / s.viewport.zoom,
      y: (event.clientY - rect.top - s.viewport.y) / s.viewport.zoom,
    };
  };
  sdk.listen(stage, "pointerdown", (event) => {
    if (
      s.held ||
      stopped ||
      event.button > 1 ||
      drag ||
      event.target.closest(
        ".studio-context-tools,.studio-bottom-controls,.studio-minimap-host",
      )
    )
      return;
    const pan = space || event.button === 1;
    const output = event.target.closest("[data-output]"),
      input = event.target.closest("[data-input]");
    if (!pan && output) {
      connecting = output.dataset.output;
      notice.textContent = "选择生成卡片的输入圆点";
      event.preventDefault();
      return;
    }
    if (!pan && input) {
      if (connecting)
        void safe(() => connect(connecting, input.dataset.input))();
      return;
    }
    const resize = !pan && event.target.closest('[data-resize]');
    if (resize) {
      const card = resize.closest('[data-node]'), node = board().nodes.find(n => n.id === card?.dataset.node);
      if (!node || s.editing || s.drafts.size) return;
      selected.clear(); selected.add(node.id);
      drag = { type: 'resize', start: coordinates(event), before: structuredClone(node), size: cardSize(node), corner: resize.dataset.resize,
        pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, moved: false };
      stage.setPointerCapture?.(event.pointerId); stage.focus({ preventScroll: true }); event.preventDefault(); updateSelectionTools();
      return;
    }
    if (!pan && event.target.closest("button,input,textarea,select,a,path"))
      return;
    const card = event.target.closest("[data-node]");
    if (
      !card &&
      !event.shiftKey &&
      canvasTool === "pan" &&
      event.target !== stage
    ) {
      // The React viewport prevents the browser's default focus change.
      // Still blur card fields so drafts flush and canvas shortcuts work.
      stage.focus({ preventScroll: true });
      return;
    }
    if (card && !pan && event.button === 0) {
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        selected.has(card.dataset.node)
          ? selected.delete(card.dataset.node)
          : selected.add(card.dataset.node);
        updateSelectionTools();
        return;
      }
      if (!event.target.closest("[data-handle]") && !card.classList.contains('studio-card-upstream')) {
        selected.clear();
        selected.add(card.dataset.node);
        stage.focus({ preventScroll: true });
        updateSelectionTools();
        return;
      }
      if (!selected.has(card.dataset.node)) {
        selected.clear();
        selected.add(card.dataset.node);
      }
      for (const child of board().nodes)
        if (child.groupId && selected.has(child.groupId))
          selected.add(child.id);
      drag = {
        type: "nodes",
        start: coordinates(event),
        nodes: board()
          .nodes.filter((n) => selected.has(n.id))
          .map((n) => ({ id: n.id, x: n.x, y: n.y })),
      };
    } else {
      if (!pan && (event.shiftKey || canvasTool === "select")) {
        drag = {
          type: "select",
          start: coordinates(event),
          selected: new Set(selected),
          extend: event.ctrlKey || event.metaKey,
        };
        if (!drag.extend) selected.clear();
      } else {
        if (!pan) selected.clear();
        drag = {
          type: "pan",
          x: event.clientX,
          y: event.clientY,
          before: { ...s.viewport },
        };
      }
    }
    Object.assign(drag, {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      moved: false,
    });
    if (drag.type !== 'nodes') stage.setPointerCapture?.(event.pointerId);
    stage.focus({ preventScroll: true });
    // Let a stationary click reach the upstream card (including double-click).
    // Capture only after a real drag; early capture retargets click to the stage.
    if (drag.type !== 'nodes') event.preventDefault();
    updateSelectionTools();
  });
  function movePointer(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (
      Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) > 4
    )
      drag.moved = true;
    if (!drag.moved) return;
    if (drag.type === 'nodes' && !stage.hasPointerCapture?.(event.pointerId)) stage.setPointerCapture?.(event.pointerId);
    if (drag.type === "pan") {
      s.viewport.x = Math.max(
        -1e5,
        Math.min(1e5, drag.before.x + event.clientX - drag.x),
      );
      s.viewport.y = Math.max(
        -1e5,
        Math.min(1e5, drag.before.y + event.clientY - drag.y),
      );
      transform();
    } else {
      const point = coordinates(event);
      if (drag.type === "nodes") {
        const delta = moveDelta(
          drag.nodes,
          point.x - drag.start.x,
          point.y - drag.start.y,
        );
        for (const before of drag.nodes) {
          const node = board().nodes.find((n) => n.id === before.id);
          node.x = before.x + delta.x;
          node.y = before.y + delta.y;
          const item = cards.querySelector(`[data-node="${node.id}"]`);
          item.style.left = node.x + "px";
          item.style.top = node.y + "px";
        }
        paintWires();
      } else if (drag.type === 'resize') {
        const node = board().nodes.find(n => n.id === drag.before.id);
        Object.assign(node, resizeCard({ ...drag.before, ...drag.size }, drag.corner, point.x - drag.start.x, point.y - drag.start.y, node.type === 'image'));
        const entry = mountedCards.get(node.id);
        placeCard(entry.card, node); entry.controller.update(node); paintWires();
      } else {
        selectionBox.hidden = false;
        Object.assign(selectionBox.style, {
          left:
            s.viewport.x +
            Math.min(point.x, drag.start.x) * s.viewport.zoom +
            "px",
          top:
            s.viewport.y +
            Math.min(point.y, drag.start.y) * s.viewport.zoom +
            "px",
          width: Math.abs(point.x - drag.start.x) * s.viewport.zoom + "px",
          height: Math.abs(point.y - drag.start.y) * s.viewport.zoom + "px",
        });
        for (const node of board().nodes) {
          const size = cardSize(node),
            inside =
              node.x + size.width >= Math.min(point.x, drag.start.x) &&
              node.x <= Math.max(point.x, drag.start.x) &&
              node.y + size.height >= Math.min(point.y, drag.start.y) &&
              node.y <= Math.max(point.y, drag.start.y);
          if (inside || (drag.extend && drag.selected.has(node.id)))
            selected.add(node.id);
          else selected.delete(node.id);
        }
        updateSelectionTools();
      }
    }
  }
  sdk.listen(window, "pointermove", movePointer);
  function cancelGesture() {
    if (!drag) return;
    const previous = drag;
    drag = null;
    if (previous.type === "nodes")
      for (const before of previous.nodes)
        Object.assign(
          board().nodes.find((n) => n.id === before.id),
          before,
        );
    if (previous.type === "pan") s.viewport = previous.before;
    if (previous.type === 'resize') restoreSize(previous);
    if (previous.type === "select") {
      selected.clear();
      previous.selected.forEach((id) => selected.add(id));
    }
    if (stage.hasPointerCapture?.(previous.pointerId))
      stage.releasePointerCapture(previous.pointerId);
    selectionBox.hidden = true;
    render();
  }
  function restoreSize(gesture) {
    const node = board().nodes.find(n => n.id === gesture.before.id);
    for (const key of ['x', 'y', 'width', 'height']) {
      if (Object.hasOwn(gesture.before, key)) node[key] = gesture.before[key];
      else delete node[key];
    }
  }
  const release = safe(async (event) => {
    if (connecting) {
      const input = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest("[data-input]");
      if (input) await connect(connecting, input.dataset.input);
    }
    if (!drag || event.pointerId !== drag.pointerId) return;
    movePointer(event);
    const previous = drag;
    drag = null;
    if (stage.hasPointerCapture?.(previous.pointerId))
      stage.releasePointerCapture(previous.pointerId);
    selectionBox.hidden = true;
    if (previous.type === "nodes" && previous.moved) {
      const operations = previous.nodes
        .map((old) => {
          const n = board().nodes.find((n2) => n2.id === old.id);
          const patch = { x: n.x, y: n.y };
          Object.assign(n, old);
          return { type: "update", id: old.id, patch };
        })
        .filter((op) =>
          previous.nodes.some(
            (n) => n.id === op.id && (n.x !== op.patch.x || n.y !== op.patch.y),
          ),
        );
      try {
        if (operations.length) await edit(operations);
      } finally {
        render();
      }
    } else if (previous.type === 'resize') {
      const node = board().nodes.find(n => n.id === previous.before.id);
      const patch = { x: node.x, y: node.y, width: node.width, height: node.height };
      restoreSize(previous);
      try { if (previous.moved) await edit([{ type: 'update', id: node.id, patch }]); }
      finally { render(); }
    } else if (previous.type === "pan" && previous.moved) await saveViewport();
    render();
  });
  sdk.listen(window, "pointerup", release);
  sdk.listen(stage, "pointercancel", cancelGesture);
  sdk.listen(stage, "lostpointercapture", cancelGesture);
  sdk.listen(window, "blur", () => {
    space = false;
    connecting = null;
    cancelGesture();
  });
  sdk.listen(
    window,
    "keydown",
    safe(async (event) => {
      if (
        event.isComposing ||
        !root.contains(event.target) ||
        event.target.closest("input,textarea,select") ||
        root.querySelector("dialog[open]")
      )
        return;
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "g" &&
        s.actions.get(event.shiftKey ? "ungroup" : "group")
      ) {
        event.preventDefault();
        await s.execute(event.shiftKey ? "ungroup" : "group", {
          ids: [...selected],
        });
        return;
      }
      if (event.code === "Space") {
        space = true;
        event.preventDefault();
      }
      if (event.key === "Escape") {
        if (drag) {
          cancelGesture();
          return;
        }
        connecting = null;
        selected.clear();
        render();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        board().nodes.forEach((n) => selected.add(n.id));
        updateSelectionTools();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        await historyStep(!event.shiftKey);
      }
      if (event.key === "Delete" && selected.size) {
        event.preventDefault();
        await removeSelection();
      }
    }),
  );
  const resizeObserver =
    typeof window.ResizeObserver === "function"
      ? new window.ResizeObserver(placeContextTools)
      : null;
  resizeObserver?.observe(stage);
  resizeObserver?.observe(cards);
  resizeObserver?.observe(contextTools);
  sdk.listen(window, "keyup", (event) => {
    if (event.code === "Space") space = false;
  });
  const nodeList = el("div", { class: "studio-node-list" }),
    search = el("input", {
      "aria-label": "搜索节点",
      placeholder: "搜索节点",
      class: "studio-node-search",
    });
  const tabs = el("div", { class: "studio-side-tabs" }),
    nodesTab = button("画布", () => showTab("nodes")),
    assetsTab = button("资产", () => showTab("assets")),
    boardsTab = button("画板", () => showTab("boards"));
  const count = el("div", { class: "studio-node-count" });
  tabs.append(nodesTab, assetsTab, boardsTab);
  side.prepend(tabs, count, search, nodeList);
  let sideTab = "nodes";
  function showTab(tab) {
    sideTab = tab;
    nodeList.hidden = tab !== "nodes";
    search.hidden = tab !== "nodes";
    assetsList.hidden = tab !== "assets";
    boardList.hidden = tab !== "boards";
    side.querySelector(".studio-new-board").hidden = tab !== "boards";
    for (const [b, id] of [
      [nodesTab, "nodes"],
      [assetsTab, "assets"],
      [boardsTab, "boards"],
    ])
      b.classList.toggle("active", id === tab);
  }
  function renderSidebar() {
    count.textContent = "画布元素  " + board().nodes.length;
    const query = search.value.toLowerCase();
    nodeList.replaceChildren(
      ...board()
        .nodes.filter((n) =>
          (n.title + " " + (n.text || n.prompt || ""))
            .toLowerCase()
            .includes(query),
        )
        .map((n) => {
          const b = button(n.title, () => {
            selected.clear();
            selected.add(n.id);
            fit([n]);
            updateSelectionTools();
          });
          b.className = "studio-node-row";
          const preview =
            n.type === "image"
              ? el("img", { src: imageUrl(n.assetId), alt: "" })
              : icon(
                  n.type === "text"
                    ? Type
                    : n.type === "group"
                      ? Group
                      : Settings2,
                );
          const copy = el("span", {});
          copy.append(
            el("strong", {}, n.title),
            el(
              "small",
              {},
              (
                n.text ||
                n.prompt ||
                renderers.get(n.type)?.label ||
                "插件未启用"
              ).slice(0, 80),
            ),
          );
          b.replaceChildren(preview, copy);
          return b;
        }),
    );
    showTab(sideTab);
  }
  search.oninput = renderSidebar;
  side.querySelector(".studio-sidebar-label").hidden = true;
  const collapse = button("收起侧栏", () =>
    root.classList.toggle("studio-side-collapsed"),
  );
  collapse.replaceChildren(icon(PanelLeftClose));
  toolbar.prepend(collapse);
  const toolButton = button("切换选择与平移", () => {
    canvasTool = canvasTool === "pan" ? "select" : "pan";
    toolButton.replaceChildren(
      icon(canvasTool === "pan" ? Hand : MousePointer2),
    );
    transform();
  });
  toolButton.replaceChildren(icon(Hand));
  const fitButton = button("适应画布", () => focusView(false));
  fitButton.replaceChildren(icon(LocateFixed));
  const mapButton = button("小地图", () => {
    miniMap = !miniMap;
    transform();
  });
  mapButton.replaceChildren(icon(MapIcon));
  const appearanceButton = button("切换背景", () => {
    backgroundMode =
      backgroundMode === "lines"
        ? "dots"
        : backgroundMode === "dots"
          ? "blank"
          : "lines";
    transform();
  });
  appearanceButton.replaceChildren(icon(Palette));
  undoButton.replaceChildren(icon(Undo2));
  undoButton.setAttribute("aria-label", "撤销");
  redoButton.replaceChildren(icon(Redo2));
  redoButton.setAttribute("aria-label", "重做");
  let dark = sdk.storage.local.getItem('colorTheme') !== 'light';
  toolbar.append(
    button("切换主题", () => {
      dark = !dark;
      root.dataset.theme = dark ? "dark" : "light";
      sdk.storage.local.setItem('colorTheme', root.dataset.theme);
      surface.theme(dark ? "dark" : "light");
      paintWires();
      transform();
    }),
  );
  root.dataset.theme = dark ? 'dark' : 'light';
  surface = mountSurface(stage, world, svg, {
    blocked: () => !!drag || s.held || stopped,
    onViewportChange: (next) => {
      s.viewport = {
        x: Math.max(-1e5, Math.min(1e5, next.x)),
        y: Math.max(-1e5, Math.min(1e5, next.y)),
        zoom: Math.max(0.15, Math.min(3, next.k)),
      };
      transform();
      scheduleViewport();
    },
    onCanvasDeselect: () => {
      selected.clear();
      updateSelectionTools();
    },
    onPanStateChange: (active) => {
      panning = active;
    },
  });
  surface.theme(root.dataset.theme);
  const view = {
    el,
    button,
    safe,
    field,
    revealPanel,
    nodeCard: (node, card, options) => mountNodeCard(card, node, options, { session: s, view, size: cardSize, selected: id => selected.has(id) }),
    editNode: (id, property) => mountedCards.get(id)?.controller?.edit(property),
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
    cards,
    position,
    coordinates,
    state: () => s.state,
    boardId: () => s.boardId,
    execute: (...args) => s.execute(...args),
    render,
    selection: () => [...selected],
    select(ids) {
      selected.clear();
      ids.forEach((id) => selected.add(id));
      updateSelectionTools();
    },
    bounds: (nodes) => cardBounds(nodes, cardSize),
    focus: (nodes) => fit(nodes),
    actions(owner, type, actions) {
      const key = Symbol(type);
      return owner.effect(() => {
        cardActions.set(key, { type, actions });
        selectionSignature = "";
        updateSelectionTools();
        return () => {
          cardActions.delete(key);
          selectionSignature = "";
          updateSelectionTools();
        };
      });
    },
    register(owner, definition) {
      if (
        !/^[a-z][a-z0-9-]*$/.test(definition.id) ||
        renderers.has(definition.id)
      )
        throw Error("卡片视图无效或重复");
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
      const update = () => {
        const icons = {
          text: Type,
          image: Image,
          generator: Settings2,
          group: Group,
        };
        const items = [...menus.values()]
          .sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000))
          .map((item) => {
            const b = button(item.label, item.run, item.className || "");
            b.title = item.label;
            if (icons[item.id]) {
              b.replaceChildren(icon(icons[item.id]));
              const label = el("span", { class: "studio-sr-only" }, item.label);
              b.append(label);
            }
            return b;
          });
        dock.replaceChildren(
          ...items,
          undoButton,
          redoButton,
          toolButton,
          fitButton,
          mapButton,
          appearanceButton,
        );
      };
      return owner.effect(() => {
        menus.set(definition.id, definition);
        update();
        return () => {
          menus.delete(definition.id);
          update();
        };
      });
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
    },
  };
  s.actions.observe(ctx, () => {
    selectionSignature = "";
    updateSelectionTools();
  });
  s.attachView(ctx, {
    render,
    status: (value) => (notice.textContent = value),
    dragging: () => !!drag || panning,
    choose: () => {
      selected.clear();
      connecting = null;
    },
    hold: (value) => {
      root.inert = value;
    },
  });
  ctx.effect(() => () => {
    stopped = true;
    for (const entry of mountedCards.values()) entry.controller?.dispose();
    mountedCards.clear();
    surface?.dispose();
    resizeObserver?.disconnect();
    clearTimeout(viewTimer);
  });
  sdk.provide("canvasUI", view);
  render();
}
