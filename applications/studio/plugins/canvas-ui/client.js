import { cardBounds, fitView, arrangeCards, moveDelta, overlayPosition } from './geometry.js'
export default async function (ctx, sdk) {
  const s = ctx.canvasSession, el = sdk.el, uuid = () => crypto.randomUUID();
  const { board, api, edit, flush, draft, choose, newBoard, refresh, imageUrl, rememberAsset, importImage, saveViewport } = s;
  const renderers = new Map(), menus = new Map(), extensions = new Map();
  let stopped = false, drag = null, connecting = null, space = false, viewTimer, selectionSignature = "";
  const selected = new Set();
  const root = el("main", { class: "studio-app" }), side = el("aside", { class: "studio-sidebar" }), main = el("section", { class: "studio-main" });
  const toolbar = el("header", { class: "studio-toolbar" }), stage = el("div", { class: "studio-stage", tabIndex: 0, "aria-label": "无限画布" });
  const world = el("div", { class: "studio-world" }), cards = el("div", { class: "studio-cards" });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("studio-wires");
  const boardList = el("nav", { class: "studio-boards", "aria-label": "画板列表" }), assetsList = el("div", { class: "studio-assets" });
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
  const position = () => {
    const point = { x: Math.round((stage.clientWidth / 2 - s.viewport.x) / s.viewport.zoom - 140), y: Math.round((stage.clientHeight / 2 - s.viewport.y) / s.viewport.zoom - 130) };
    while (board().nodes.some((n) => Math.abs(n.x - point.x) < 300 && Math.abs(n.y - point.y) < 280)) point.x += 340;
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
    el("div", { class: "studio-sidebar-label" }, "素材库"),
    assetsList
  );
  const undoButton = button("↶", () => historyStep(true)), redoButton = button("↷", () => historyStep(false));
  undoButton.title = "撤销 Ctrl+Z";
  redoButton.title = "重做 Ctrl+Shift+Z";
  dock.append(undoButton, redoButton);
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
    s.editing = true;
    updateSelectionTools();
  };
  boardTitle.oninput = () => draft({ id: s.titleDraftId, title: s.renderedTitle }, "title", boardTitle.value);
  boardTitle.onblur = safe(async () => {
    s.editing = false;
    await flush();
    if (!s.drafts.size) render();
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
  const hint = el("div", { class: "studio-canvas-hint" }, "空白拖动平移 · 滚轮缩放 · Shift 框选 · Esc 退出编辑/选择");
  bottomControls.append(dock, controls);
  world.append(svg, cards);
  stage.append(world, empty, selectionBox, contextTools, bottomControls, hint);
  main.append(toolbar, stage);
  root.append(side, main);
  sdk.mount("app", root);
  function transform() {
    world.style.transform = `translate(${s.viewport.x}px,${s.viewport.y}px) scale(${s.viewport.zoom})`;
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
  async function arrange(direction) {
    await flush();
    const operations = arrangeCards(selectedNodes(), direction, cardSize);
    if (operations.length > 100) throw Error("请每次选择不超过 100 张卡片进行排列。");
    if (operations.length) await edit(operations);
  }
  async function duplicateSelection() {
    await flush();
    const nodes = selectedNodes(), ids = new Map(nodes.map((n) => [n.id, uuid()]));
    if (!nodes.length) return;
    const delta = moveDelta(nodes, 40, 40);
    const operations = nodes.map((n) => ({ type: "add", node: { ...n, id: ids.get(n.id), x: n.x + delta.x, y: n.y + delta.y } }));
    for (const edge of board().edges) if (ids.has(edge.from) && ids.has(edge.to)) operations.push({ type: "connect", id: uuid(), from: ids.get(edge.from), to: ids.get(edge.to) });
    if (operations.length > 100) throw Error("所选卡片和内部连线过多，请分批创建副本。");
    await edit(operations);
    selected.clear();
    ids.forEach((id) => selected.add(id));
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
    const nodes = selectedNodes(), signature = JSON.stringify([s.boardId, s.editing, nodes.map((n) => [n.id, n.type, n.title])]);
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
        } else contextTools.append(button("水平排列", () => arrange("horizontal")), button("垂直排列", () => arrange("vertical")));
        contextTools.append(button("创建副本", duplicateSelection), button("删除所选", removeSelection, "studio-danger"));
      }
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
  function paintWires() {
    svg.replaceChildren();
    for (const edge of board().edges) {
      const a = board().nodes.find((n) => n.id === edge.from), b = board().nodes.find((n) => n.id === edge.to);
      const path = document.createElementNS(svg.namespaceURI, "path");
      path.setAttribute("d", wirePath({ x: a.x + 288, y: a.y + 38 }, { x: b.x, y: b.y + 38 }));
      path.dataset.edge = edge.id;
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
      path.setAttribute("d", wirePath({ x: source.x + 288, y: source.y + 38 }, { x: result.x, y: result.y + 38 }));
      const title = document.createElementNS(svg.namespaceURI, "title");
      title.textContent = "生成结果来源";
      path.append(title);
      svg.append(path);
    }
  }
  function field(node, prop, area = false) {
    const value = s.drafts.get(node.id)?.patch[prop] ?? node[prop];
    const input = el(area ? "textarea" : "input", { value, "aria-label": node.title + (prop === "prompt" ? " 提示词" : prop === "text" ? " 文字内容" : " 标题"), maxLength: area ? 12e3 : 120 });
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
    const card = el("article", { class: `studio-card studio-${node.type}${selected.has(node.id) ? " selected" : ""}` });
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
    head.append(el("span", { class: "studio-kind" }, renderer?.icon || "?"), title);
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
    return card;
  }
  function render() {
    if (stopped || drag || s.editing) return;
    const restoreFocus = cards.contains(document.activeElement);
    for (const id of selected) if (!board().nodes.some((n) => n.id === id)) selected.delete(id);
    s.renderedTitle = board().title;
    boardTitle.value = s.drafts.get(s.titleDraftId)?.patch.title ?? s.renderedTitle;
    boardList.replaceChildren(...s.state.boards.map((b) => button(b.title, () => choose(b.id), b.id === s.boardId ? "active" : "")));
    for (const extension of extensions.values()) extension.refresh?.();
    s.renderedNodes.clear();
    for (const item of cards.children) resizeObserver?.unobserve(item);
    cards.replaceChildren(...board().nodes.map((node) => {
      const rendered = structuredClone(node);
      s.renderedNodes.set(node.id, rendered);
      return renderCard(rendered);
    }));
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
  sdk.listen(stage, "pointerdown", (event) => {
    if (s.held || stopped || event.button > 1 || drag || event.target.closest(".studio-context-tools,.studio-bottom-controls")) return;
    const pan = space || event.button === 1;
    const output = event.target.closest("[data-output]"), input = event.target.closest("[data-input]");
    if (!pan && output) {
      connecting = output.dataset.output;
      notice.textContent = "选择生成卡片的输入圆点";
      event.preventDefault();
      return;
    }
    if (!pan && input) {
      if (connecting) void safe(() => connect(connecting, input.dataset.input))();
      return;
    }
    if (!pan && event.target.closest("button,input,textarea,select,a,path")) return;
    const card = event.target.closest("[data-node]");
    if (card && !pan && event.button === 0) {
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        selected.has(card.dataset.node) ? selected.delete(card.dataset.node) : selected.add(card.dataset.node);
        updateSelectionTools();
        return;
      }
      if (!event.target.closest("[data-handle]")) {
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
      drag = { type: "nodes", start: coordinates(event), nodes: board().nodes.filter((n) => selected.has(n.id)).map((n) => ({ id: n.id, x: n.x, y: n.y })) };
    } else {
      if (!pan && event.shiftKey) {
        drag = { type: "select", start: coordinates(event), selected: new Set(selected), extend: event.ctrlKey || event.metaKey };
        if (!drag.extend) selected.clear();
      } else {
        if (!pan) selected.clear();
        drag = { type: "pan", x: event.clientX, y: event.clientY, before: { ...s.viewport } };
      }
    }
    Object.assign(drag, { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, moved: false });
    stage.setPointerCapture?.(event.pointerId);
    stage.focus({ preventScroll: true });
    event.preventDefault();
    updateSelectionTools();
  });
  function movePointer(event) {
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
  sdk.listen(stage, "pointermove", movePointer);
  function cancelGesture() {
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
    if (connecting) {
      const input = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-input]");
      if (input) await connect(connecting, input.dataset.input);
    }
    if (!drag || event.pointerId !== drag.pointerId) return;
    movePointer(event);
    const previous = drag;
    drag = null;
    if (stage.hasPointerCapture?.(previous.pointerId)) stage.releasePointerCapture(previous.pointerId);
    selectionBox.hidden = true;
    if (previous.type === "nodes" && previous.moved) {
      const operations = previous.nodes.map((old) => {
        const n = board().nodes.find((n2) => n2.id === old.id);
        const patch = { x: n.x, y: n.y };
        Object.assign(n, old);
        return { type: "update", id: old.id, patch };
      }).filter((op) => previous.nodes.some((n) => n.id === op.id && (n.x !== op.patch.x || n.y !== op.patch.y)));
      try {
        if (operations.length) await edit(operations);
      } finally {
        render();
      }
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
  sdk.listen(stage, "wheel", (event) => {
    if (event.target.closest("textarea,select,.studio-context-tools,.studio-bottom-controls")) return;
    event.preventDefault();
    if (drag) return;
    const rect = stage.getBoundingClientRect();
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
      ;
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
    cards,
    position,
    coordinates,
    state: () => s.state,
    boardId: () => s.boardId,
    execute: (...args) => s.execute(...args),
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
      const update = () => dock.replaceChildren(...[...menus.values()].sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000) || a.id.localeCompare(b.id)).map((item) => button(item.label, item.run, item.className || "")), undoButton, redoButton);
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
    }
  };
  s.attachView(ctx, { render, status: (value) => notice.textContent = value, dragging: () => !!drag, choose: () => {
    selected.clear();
    connecting = null;
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
