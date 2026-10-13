import React from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider, theme } from "antd";
import { CanvasNodeCropDialog } from "./upstream/canvas-node-crop-dialog.js";
import { CanvasNodeSplitDialog } from "./upstream/canvas-node-split-dialog.js";
import { cropDataUrl, splitDataUrl } from "./upstream/canvas-image-data.js";

export default function (ctx, sdk) {
  const s = ctx.canvasSession,
    view = ctx.canvasUI,
    host = view.el("div", { class: "studio-image-editor-root" });
  view.root.append(host);
  const root = createRoot(host);
  let stopped = false,
    opened = false,
    busy = false,
    token = 0;
  const close = () => {
    token++;
    opened = false;
    s.editing = false;
    root.render(null);
    view.render();
  };
  function validate(args, mode) {
    if (mode === "crop") {
      const c = args.crop;
      if (
        !c ||
        ![c.x, c.y, c.width, c.height].every(Number.isFinite) ||
        c.x < 0 ||
        c.y < 0 ||
        c.width <= 0 ||
        c.height <= 0 ||
        c.x + c.width > 1.000001 ||
        c.y + c.height > 1.000001
      )
        throw Error("裁剪区域应为原图范围内的 0–1 比例坐标");
    } else {
      const p = args.split;
      if (
        !p ||
        !Number.isInteger(p.rows) ||
        !Number.isInteger(p.columns) ||
        p.rows < 1 ||
        p.columns < 1 ||
        p.rows * p.columns > 100
      )
        throw Error("切分需为正整数，且每次不超过画布的 100 个操作上限");
      for (const [key, count] of [
        ["horizontalLines", p.rows],
        ["verticalLines", p.columns],
      ])
        if (
          p[key] !== undefined &&
          (!Array.isArray(p[key]) ||
            p[key].length !== count - 1 ||
            p[key].some(
              (n, i, a) =>
                !Number.isFinite(n) ||
                n <= 0 ||
                n >= 1 ||
                (i > 0 && n <= a[i - 1]),
            ))
        )
          throw Error("切分线需按顺序位于图片内部");
    }
  }
  async function run(mode, args) {
    validate(args, mode);
    if (busy) throw Error("请等待当前图片编辑完成");
    const node = s.board().nodes.find((n) => n.id === args.nodeId);
    if (
      (args.boardId !== undefined && args.boardId !== s.boardId) ||
      (args.revision !== undefined && args.revision !== s.board().revision) ||
      (args.assetId !== undefined && args.assetId !== node?.assetId)
    )
      throw Error("画布或原图已变化，请关闭图片编辑并重新打开");
    if (node?.type !== "image" || !s.state.assets[node.assetId])
      throw Error("请选择有效的图片卡片");
    const boardId = s.boardId,
      revision = s.board().revision,
      source = { ...node },
      sourceBounds = view.bounds([node]),
      stamp = token;
    const startX = Math.max(source.x + sourceBounds.width + 80,
      ...s.board().nodes.filter(n => n.type !== 'group').map(n => n.x + view.bounds([n]).width + 80));
    const check = () => {
      if (stopped || sdk.signal?.aborted || stamp !== token)
        throw Error("图片编辑已取消");
    };
    busy = true;
    const status = view.el(
      "div",
      { class: "studio-image-editing-status", role: "status" },
      "正在保存图片编辑结果…",
    );
    host.append(status);
    try {
      const url = s.imageUrl(source.assetId, false);
      const pieces =
        mode === "crop"
          ? [{ row: 0, column: 0, dataUrl: await cropDataUrl(url, args.crop) }]
          : await splitDataUrl(url, args.split);
      const ops = [],
        assets = [];
      let row = 0, rowY = source.y, rowHeight = 0;
      for (const piece of pieces) {
        check();
        const name = (
          source.title +
          (mode === "crop"
            ? " · 裁剪"
            : ` · ${piece.row + 1}-${piece.column + 1}`)
        ).slice(0, 120);
        const asset = await s.api("/upload", {
          name,
          base64: piece.dataUrl.split(",")[1],
        });
        check();
        s.rememberAsset(asset);
        assets.push(asset.id);
        const w = 340,
          h = (w * asset.height) / asset.width;
        if (piece.row !== row) { rowY += rowHeight + 100; rowHeight = 0; row = piece.row; }
        rowHeight = Math.max(rowHeight, h);
        ops.push({
          type: "add",
          node: {
            id: crypto.randomUUID(),
            type: "image",
            title: name,
            assetId: asset.id,
            sourceNodeId: source.id,
            width: w,
            x: startX + piece.column * 380,
            y: rowY,
          },
        });
      }
      check();
      await s.edit(ops, { targetBoard: boardId, expectedRevision: revision });
      if (s.boardId === boardId && !opened) {
        view.select(ops.map((op) => op.node.id));
        view.focus(
          s.board().nodes.filter((n) => ops.some((op) => op.node.id === n.id)),
        );
      }
      return { nodeIds: ops.map((op) => op.node.id), assetIds: assets };
    } finally {
      busy = false;
      status.remove();
    }
  }
  const schema = {
    type: "object",
    properties: {
      nodeId: { type: "string" },
      boardId: { type: "string", description: "预期的源画板 ID" },
      assetId: { type: "string", description: "预期的源图片素材 ID" },
      revision: { type: "integer", description: "预期的画板版本" },
      crop: {
        type: "object",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
          width: { type: "number" },
          height: { type: "number" },
        },
        required: ["x", "y", "width", "height"],
      },
      split: {
        type: "object",
        properties: { rows: { type: "integer" }, columns: { type: "integer" } },
        required: ["rows", "columns"],
      },
    },
    required: ["nodeId"],
  };
  for (const [mode, label] of [
    ["crop", "裁剪图片"],
    ["split", "切分图片"],
  ])
    s.actions.register(ctx, {
      id: "image-" + mode,
      label,
      schema,
      run: (args) => run(mode, args),
    });
  function open(mode, node) {
    if (busy || stopped) return;
    // Selection toolbar callbacks may still hold a node from an older render.
    node = s.board().nodes.find((current) => current.id === node.id);
    if (node?.type !== "image" || !s.state.assets[node.assetId])
      throw Error("请选择有效的图片卡片");
    // Pin the preview and the eventual edit to the same document snapshot.
    // Session polling can update the board while the dialog stays open.
    const source = {
      nodeId: node.id,
      boardId: s.boardId,
      assetId: node.assetId,
      revision: s.board().revision,
    };
    const dataUrl = s.imageUrl(source.assetId, false);
    opened = true;
    s.editing = true;
    const Dialog =
      mode === "crop" ? CanvasNodeCropDialog : CanvasNodeSplitDialog;
    root.render(
      React.createElement(
        ConfigProvider,
        {
          theme: {
            algorithm:
              view.root.dataset.theme === "dark"
                ? theme.darkAlgorithm
                : theme.defaultAlgorithm,
          },
        },
        React.createElement(Dialog, {
          dataUrl,
          open: true,
          onClose: close,
          onConfirm: async (params) => {
            if (busy) return;
            try {
              const result = await s.execute("image-" + mode, {
                ...source,
                [mode === "crop" ? "crop" : "split"]: params,
              });
              close();
              view.select(result.nodeIds);
              view.focus(
                s.board().nodes.filter((n) => result.nodeIds.includes(n.id)),
              );
            } catch (error) {
              sdk.toast(error.message);
            }
          },
        }),
      ),
    );
  }
  view.actions(ctx, "image", [
    { label: "裁剪图片", run: (node) => open("crop", node) },
    { label: "切分图片", run: (node) => open("split", node) },
  ]);
  ctx.on("plugins/before-stop", () => {
    token++;
    if (opened) close();
  });
  ctx.effect(() => () => {
    stopped = true;
    token++;
    if (opened) s.editing = false;
    root.unmount();
    host.remove();
  });
}
