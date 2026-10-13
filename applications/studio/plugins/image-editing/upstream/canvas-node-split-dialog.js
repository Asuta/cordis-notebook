// Adapted from basketikun/infinite-canvas@3a6b64b (MIT). See LICENSE and ../../../INFINITE-CANVAS.md.
import React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, InputNumber, Modal, Tooltip } from "antd";
import {
  Grid2x2,
  ListRestart,
  PanelTop,
  Redo2,
  Rows3,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useTranslation } from "../messages.js";
import { readImageMeta } from "../image-utils.js";
import { useImageEditorViewport } from "./use-image-editor-viewport.js";
const defaultParams = {
  rows: 2,
  columns: 2,
  horizontalLines: [0.5],
  verticalLines: [0.5],
};
const maxGridSize = 12;
function CanvasNodeSplitDialog({ dataUrl, open, onClose, onConfirm }) {
  const { t } = useTranslation();
  const [params, setParams] = useState(defaultParams);
  const [image, setImage] = useState(null);
  const [active, setActive] = useState(null);
  const historyRef = useRef([]);
  const redoRef = useRef([]);
  const dragAbortRef = useRef(null);
  const [historySize, setHistorySize] = useState(0);
  const [redoSize, setRedoSize] = useState(0);
  const viewport = useImageEditorViewport(image, open);
  const previewRef = viewport.stageRef;
  const horizontalLines = params.horizontalLines || [];
  const verticalLines = params.verticalLines || [];
  const rows = horizontalLines.length + 1;
  const columns = verticalLines.length + 1;
  const total = rows * columns;
  const pieceSize = image
    ? {
        width: Math.max(1, Math.floor(image.width / columns)),
        height: Math.max(1, Math.floor(image.height / rows)),
      }
    : null;
  useEffect(() => {
    if (!open) return;
    setParams(defaultParams);
    setActive(null);
    setImage(null);
    historyRef.current = [];
    redoRef.current = [];
    setHistorySize(0);
    setRedoSize(0);
  }, [dataUrl, open]);
  useEffect(() => {
    if (!open) return;
    void readImageMeta(dataUrl).then(setImage);
  }, [dataUrl, open]);
  useEffect(() => {
    if (!open) dragAbortRef.current?.abort();
    return () => dragAbortRef.current?.abort();
  }, [open]);
  const update = (key, value) => {
    const count = clampGrid(value ?? params[key]);
    pushHistory(historyRef, redoRef, params, setHistorySize, setRedoSize);
    setActive(null);
    setParams((current) => ({
      ...current,
      [key]: count,
      [key === "rows" ? "horizontalLines" : "verticalLines"]:
        buildGridLines(count),
    }));
  };
  const addLine = (axis) => {
    pushHistory(historyRef, redoRef, params, setHistorySize, setRedoSize);
    const key = axis === "horizontal" ? "horizontalLines" : "verticalLines";
    const spot = findLineSpot(params[key] || []);
    const lines = [...(params[key] || []), spot].sort((a, b) => a - b);
    setActive({ axis, index: lines.indexOf(spot) });
    setParams({
      ...params,
      [key]: lines,
      rows: axis === "horizontal" ? lines.length + 1 : params.rows,
      columns: axis === "vertical" ? lines.length + 1 : params.columns,
    });
  };
  const deleteLine = () => {
    if (!active) return;
    pushHistory(historyRef, redoRef, params, setHistorySize, setRedoSize);
    setParams((current) => {
      const key =
        active.axis === "horizontal" ? "horizontalLines" : "verticalLines";
      const lines = (current[key] || []).filter(
        (_, index) => index !== active.index,
      );
      return {
        ...current,
        [key]: lines,
        rows: active.axis === "horizontal" ? lines.length + 1 : current.rows,
        columns:
          active.axis === "vertical" ? lines.length + 1 : current.columns,
      };
    });
    setActive(null);
  };
  const startDrag = (axis, index, event) => {
    event.preventDefault();
    event.stopPropagation();
    setActive({ axis, index });
    const box = previewRef.current?.getBoundingClientRect();
    if (!box) return;
    pushHistory(historyRef, redoRef, params, setHistorySize, setRedoSize);
    dragAbortRef.current?.abort();
    const controller = new AbortController();
    dragAbortRef.current = controller;
    const move = (moveEvent) =>
      setLine(
        axis,
        index,
        axis === "horizontal"
          ? (moveEvent.clientY - box.top) / box.height
          : (moveEvent.clientX - box.left) / box.width,
      );
    const stop = () => controller.abort();
    window.addEventListener("pointermove", move, { signal: controller.signal });
    window.addEventListener("pointerup", stop, { signal: controller.signal });
    window.addEventListener("pointercancel", stop, {
      signal: controller.signal,
    });
  };
  const setLine = (axis, index, value) => {
    setParams((current) => {
      const key = axis === "horizontal" ? "horizontalLines" : "verticalLines";
      const lines = [...(current[key] || [])];
      lines[index] = clampLine(
        value,
        lines[index - 1] ?? 0,
        lines[index + 1] ?? 1,
      );
      return { ...current, [key]: lines };
    });
  };
  const resetLines = () => {
    pushHistory(historyRef, redoRef, params, setHistorySize, setRedoSize);
    setActive(null);
    setParams((current) => ({
      ...current,
      horizontalLines: buildGridLines(current.rows),
      verticalLines: buildGridLines(current.columns),
    }));
  };
  const undoSplit = useCallback(() => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    redoRef.current.push(cloneSplitParams(params));
    setParams(previous);
    setActive(null);
    setHistorySize(historyRef.current.length);
    setRedoSize(redoRef.current.length);
  }, [params]);
  const redoSplit = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return;
    historyRef.current.push(cloneSplitParams(params));
    setParams(next);
    setActive(null);
    setHistorySize(historyRef.current.length);
    setRedoSize(redoRef.current.length);
  }, [params]);
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input,textarea,[contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      const isUndo =
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        key === "z";
      const isRedo =
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        ((event.shiftKey && key === "z") || (!event.shiftKey && key === "y"));
      const isDelete = event.key === "Delete" || event.key === "Backspace";
      if (!isUndo && !isRedo && !isDelete) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (isDelete) deleteLine();
      else if (isRedo) redoSplit();
      else undoSplit();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [active, open, params, redoSplit, undoSplit]);
  const confirmParams = {
    ...params,
    horizontalLines,
    verticalLines,
    rows,
    columns,
  };
  return /* @__PURE__ */ React.createElement(
    Modal,
    {
      title: null,
      open: open && Boolean(dataUrl),
      onCancel: onClose,
      footer: null,
      width: 780,
      centered: true,
      destroyOnHidden: true,
      transitionName: "",
      maskTransitionName: "",
    },
    /* @__PURE__ */ React.createElement(
      "div",
      { className: "space-y-5", "data-canvas-no-zoom": true },
      /* @__PURE__ */ React.createElement(
        "div",
        null,
        /* @__PURE__ */ React.createElement(
          "h2",
          { className: "text-xl font-semibold" },
          t("canvas.editors.splitTitle"),
        ),
        /* @__PURE__ */ React.createElement(
          "p",
          { className: "mt-1 text-sm opacity-60" },
          t("canvas.editors.splitDescription", { count: total }),
        ),
        /* @__PURE__ */ React.createElement(
          "p",
          { className: "mt-2 text-xs leading-5 opacity-55" },
          t("canvas.editors.splitHint"),
        ),
      ),
      /* @__PURE__ */ React.createElement(
        "div",
        { className: "grid gap-6 md:grid-cols-[minmax(260px,1fr)_280px]" },
        /* @__PURE__ */ React.createElement(
          "div",
          { className: "rounded-xl border p-4" },
          /* @__PURE__ */ React.createElement(
            "div",
            {
              ref: viewport.viewportRef,
              ...viewport.panHandlers,
              className: `relative isolate h-[340px] min-h-[300px] rounded-lg bg-black/5 ${viewport.scrollClassName} ${viewport.isPanning ? "cursor-grabbing" : viewport.spacePressed ? "cursor-grab" : ""}`,
            },
            /* @__PURE__ */ React.createElement(
              "div",
              { className: "relative", style: viewport.contentStyle },
              /* @__PURE__ */ React.createElement(
                "div",
                {
                  ref: previewRef,
                  className:
                    "absolute isolate overflow-hidden rounded-lg bg-black [backface-visibility:hidden] [contain:layout_paint] [transform:translateZ(0)]",
                  style: viewport.stageStyle,
                },
                /* @__PURE__ */ React.createElement(
                  "div",
                  {
                    className:
                      "absolute left-0 top-0 [backface-visibility:hidden]",
                    style: viewport.mediaStyle,
                  },
                  /* @__PURE__ */ React.createElement("img", {
                    src: dataUrl,
                    alt: "",
                    className: "block h-full w-full object-contain",
                    draggable: false,
                  }),
                ),
                /* @__PURE__ */ React.createElement(SplitGrid, {
                  horizontalLines,
                  verticalLines,
                  active,
                  onPointerDown: startDrag,
                }),
              ),
            ),
          ),
          /* @__PURE__ */ React.createElement(
            "div",
            { className: "mt-3 flex items-center justify-between text-sm" },
            /* @__PURE__ */ React.createElement(
              "div",
              { className: "flex items-center gap-1" },
              /* @__PURE__ */ React.createElement(
                Tooltip,
                { title: t("canvas.editors.undoSplitTitle") },
                /* @__PURE__ */ React.createElement(Button, {
                  type: "text",
                  icon: /* @__PURE__ */ React.createElement(Undo2, {
                    className: "size-4",
                  }),
                  disabled: !historySize,
                  "aria-label": t("canvas.editors.undoSplit"),
                  onClick: undoSplit,
                }),
              ),
              /* @__PURE__ */ React.createElement(
                Tooltip,
                { title: t("canvas.editors.redoSplitTitle") },
                /* @__PURE__ */ React.createElement(Button, {
                  type: "text",
                  icon: /* @__PURE__ */ React.createElement(Redo2, {
                    className: "size-4",
                  }),
                  disabled: !redoSize,
                  "aria-label": t("canvas.editors.redoSplit"),
                  onClick: redoSplit,
                }),
              ),
              /* @__PURE__ */ React.createElement(
                Tooltip,
                { title: t("canvas.editors.zoomOut") },
                /* @__PURE__ */ React.createElement(Button, {
                  type: "text",
                  icon: /* @__PURE__ */ React.createElement(ZoomOut, {
                    className: "size-4",
                  }),
                  disabled: !viewport.canZoomOut,
                  "aria-label": t("canvas.editors.zoomOut"),
                  onClick: viewport.zoomOut,
                }),
              ),
              /* @__PURE__ */ React.createElement(
                "button",
                {
                  type: "button",
                  className:
                    "min-w-14 text-center text-xs font-semibold tabular-nums opacity-70",
                  onClick: viewport.resetZoom,
                },
                Math.round(viewport.zoom * 100),
                "%",
              ),
              /* @__PURE__ */ React.createElement(
                Tooltip,
                { title: t("canvas.editors.zoomIn") },
                /* @__PURE__ */ React.createElement(Button, {
                  type: "text",
                  icon: /* @__PURE__ */ React.createElement(ZoomIn, {
                    className: "size-4",
                  }),
                  disabled: !viewport.canZoomIn,
                  "aria-label": t("canvas.editors.zoomIn"),
                  onClick: viewport.zoomIn,
                }),
              ),
            ),
            /* @__PURE__ */ React.createElement(
              "span",
              { className: "font-semibold" },
              image
                ? `${image.width} x ${image.height} px`
                : t("canvas.editors.loading"),
            ),
          ),
        ),
        /* @__PURE__ */ React.createElement(
          "div",
          { className: "space-y-5 py-2" },
          /* @__PURE__ */ React.createElement(NumberField, {
            label: t("canvas.editors.rows"),
            value: rows,
            onChange: (value) => update("rows", value),
          }),
          /* @__PURE__ */ React.createElement(NumberField, {
            label: t("canvas.editors.columns"),
            value: columns,
            onChange: (value) => update("columns", value),
          }),
          /* @__PURE__ */ React.createElement(
            "div",
            { className: "grid grid-cols-2 gap-2" },
            /* @__PURE__ */ React.createElement(
              Button,
              {
                icon: /* @__PURE__ */ React.createElement(Rows3, {
                  className: "size-4",
                }),
                onClick: () => addLine("horizontal"),
              },
              t("canvas.editors.horizontalLine"),
            ),
            /* @__PURE__ */ React.createElement(
              Button,
              {
                icon: /* @__PURE__ */ React.createElement(PanelTop, {
                  className: "size-4 rotate-90",
                }),
                onClick: () => addLine("vertical"),
              },
              t("canvas.editors.verticalLine"),
            ),
            /* @__PURE__ */ React.createElement(
              Button,
              {
                icon: /* @__PURE__ */ React.createElement(Trash2, {
                  className: "size-4",
                }),
                disabled: !active,
                onClick: deleteLine,
              },
              t("canvas.editors.deleteLine"),
            ),
            /* @__PURE__ */ React.createElement(
              Button,
              {
                icon: /* @__PURE__ */ React.createElement(ListRestart, {
                  className: "size-4",
                }),
                onClick: resetLines,
              },
              t("canvas.editors.resetLines"),
            ),
          ),
          /* @__PURE__ */ React.createElement(
            "div",
            { className: "rounded-xl border px-4 py-3 text-sm" },
            /* @__PURE__ */ React.createElement(
              "div",
              { className: "flex items-center justify-between" },
              /* @__PURE__ */ React.createElement(
                "span",
                { className: "opacity-60" },
                t("canvas.editors.pieceCount"),
              ),
              /* @__PURE__ */ React.createElement(
                "span",
                { className: "font-semibold" },
                t("canvas.editors.pieces", { count: total }),
              ),
            ),
            /* @__PURE__ */ React.createElement(
              "div",
              { className: "mt-2 flex items-center justify-between" },
              /* @__PURE__ */ React.createElement(
                "span",
                { className: "opacity-60" },
                t("canvas.editors.averageSize"),
              ),
              /* @__PURE__ */ React.createElement(
                "span",
                { className: "font-semibold" },
                pieceSize
                  ? `${pieceSize.width} x ${pieceSize.height}`
                  : t("canvas.editors.unknown"),
              ),
            ),
          ),
          /* @__PURE__ */ React.createElement(
            Button,
            {
              type: "primary",
              size: "large",
              className: "w-full",
              icon: /* @__PURE__ */ React.createElement(Grid2x2, {
                className: "size-4",
              }),
              disabled: total > 100,
              title:
                total > 100
                  ? "每次最多生成 100 张切片，请减少切分线"
                  : undefined,
              onClick: () => onConfirm(confirmParams),
            },
            t("canvas.editors.generateChildren"),
          ),
        ),
      ),
    ),
  );
}
function NumberField({ label, value, onChange }) {
  return /* @__PURE__ */ React.createElement(
    "label",
    { className: "block space-y-2" },
    /* @__PURE__ */ React.createElement(
      "span",
      { className: "font-medium opacity-75" },
      label,
    ),
    /* @__PURE__ */ React.createElement(InputNumber, {
      className: "w-full",
      min: 1,
      max: maxGridSize,
      precision: 0,
      value,
      onChange,
    }),
  );
}
function SplitGrid({ horizontalLines, verticalLines, active, onPointerDown }) {
  return /* @__PURE__ */ React.createElement(
    "div",
    { className: "pointer-events-none absolute inset-0" },
    verticalLines.map((line, index) =>
      /* @__PURE__ */ React.createElement(
        "div",
        {
          key: `column-${index}`,
          className:
            "pointer-events-auto absolute inset-y-0 -ml-2 w-4 cursor-ew-resize",
          style: { left: `${line * 100}%` },
          onPointerDown: (event) => onPointerDown("vertical", index, event),
        },
        /* @__PURE__ */ React.createElement("div", {
          className: `absolute left-1/2 top-0 h-full border-l shadow-[0_0_0_1px_rgba(0,0,0,.35)] ${active?.axis === "vertical" && active.index === index ? "border-amber-300" : "border-white/90"}`,
        }),
      ),
    ),
    horizontalLines.map((line, index) =>
      /* @__PURE__ */ React.createElement(
        "div",
        {
          key: `row-${index}`,
          className:
            "pointer-events-auto absolute inset-x-0 -mt-2 h-4 cursor-ns-resize",
          style: { top: `${line * 100}%` },
          onPointerDown: (event) => onPointerDown("horizontal", index, event),
        },
        /* @__PURE__ */ React.createElement("div", {
          className: `absolute left-0 top-1/2 w-full border-t shadow-[0_0_0_1px_rgba(0,0,0,.35)] ${active?.axis === "horizontal" && active.index === index ? "border-amber-300" : "border-white/90"}`,
        }),
      ),
    ),
  );
}
function buildGridLines(count) {
  return Array.from(
    { length: Math.max(1, count) - 1 },
    (_, index) => (index + 1) / count,
  );
}
function findLineSpot(lines) {
  const cuts = [0, ...lines, 1].sort((a, b) => a - b);
  let spot = 0.5;
  let max = 0;
  for (let index = 0; index < cuts.length - 1; index += 1) {
    const gap = cuts[index + 1] - cuts[index];
    if (gap > max) {
      max = gap;
      spot = cuts[index] + gap / 2;
    }
  }
  return spot;
}
function clampLine(value, min, max) {
  return Math.min(max - 0.01, Math.max(min + 0.01, value));
}
function clampGrid(value) {
  const numberValue = Number(value);
  return Math.min(
    maxGridSize,
    Math.max(1, Math.round(Number.isFinite(numberValue) ? numberValue : 1)),
  );
}
function cloneSplitParams(params) {
  return {
    ...params,
    horizontalLines: [...(params.horizontalLines || [])],
    verticalLines: [...(params.verticalLines || [])],
  };
}
function pushHistory(historyRef, redoRef, params, setHistorySize, setRedoSize) {
  historyRef.current.push(cloneSplitParams(params));
  if (historyRef.current.length > 50) historyRef.current.shift();
  redoRef.current = [];
  setHistorySize(historyRef.current.length);
  setRedoSize(0);
}
export { CanvasNodeSplitDialog };
