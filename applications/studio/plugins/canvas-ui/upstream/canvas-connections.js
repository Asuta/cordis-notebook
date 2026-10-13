// Adapted from basketikun/infinite-canvas@3a6b64b (MIT). See LICENSE and ../../../INFINITE-CANVAS.md.
import React from "react";
import { canvasThemes } from "./canvas-theme.js";
import { useThemeStore } from "../theme.js";
function ConnectionPath({
  connection,
  from,
  to,
  active,
  onSelect,
  onContextMenu,
}) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const startX = from.position.x + from.width;
  const startY = from.position.y + from.height / 2;
  const endX = to.position.x;
  const endY = to.position.y + to.height / 2;
  const dx = Math.abs(endX - startX);
  const curvature = Math.max(dx * 0.5, 50);
  const pathD = `M ${startX} ${startY} C ${startX + curvature} ${startY}, ${endX - curvature} ${endY}, ${endX} ${endY}`;
  return /* @__PURE__ */ React.createElement(
    "g",
    null,
    /* @__PURE__ */ React.createElement("path", {
      "data-connection-id": connection.id,
      "data-edge": connection.id,
      d: pathD,
      stroke: "transparent",
      strokeWidth: "16",
      fill: "none",
      style: { cursor: "pointer", pointerEvents: "stroke" },
      onClick: (event) => {
        event.stopPropagation();
        onSelect();
      },
      onContextMenu: (event) => {
        event.preventDefault();
        event.stopPropagation();
        onContextMenu?.(event);
      },
    }),
    /* @__PURE__ */ React.createElement("path", {
      d: pathD,
      stroke: active ? theme.node.activeStroke : theme.node.muted,
      strokeWidth: active ? 3 : 2,
      strokeOpacity: active ? 1 : 0.82,
      fill: "none",
      style: {
        filter: active
          ? `drop-shadow(0 0 8px ${theme.node.activeStroke}66)`
          : void 0,
        pointerEvents: "none",
      },
    }),
  );
}
function ActiveConnectionPath({ node, handle, mouseWorld, target }) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  if (!node) return null;
  const startX =
    handle.handleType === "source"
      ? node.position.x + node.width
      : mouseWorld.x;
  const startY =
    handle.handleType === "source"
      ? node.position.y + node.height / 2
      : mouseWorld.y;
  const endX = handle.handleType === "source" ? mouseWorld.x : node.position.x;
  const endY =
    handle.handleType === "source"
      ? mouseWorld.y
      : node.position.y + node.height / 2;
  const snappedStartX =
    handle.handleType === "target" && target
      ? target.position.x + target.width
      : startX;
  const snappedStartY =
    handle.handleType === "target" && target
      ? target.position.y + target.height / 2
      : startY;
  const snappedEndX =
    handle.handleType === "source" && target ? target.position.x : endX;
  const snappedEndY =
    handle.handleType === "source" && target
      ? target.position.y + target.height / 2
      : endY;
  const distance = Math.abs(snappedEndX - snappedStartX);
  const pathD = `M ${snappedStartX} ${snappedStartY} C ${snappedStartX + distance * 0.5} ${snappedStartY}, ${snappedEndX - distance * 0.5} ${snappedEndY}, ${snappedEndX} ${snappedEndY}`;
  return /* @__PURE__ */ React.createElement("path", {
    d: pathD,
    stroke: theme.node.activeStroke,
    strokeWidth: "2",
    fill: "none",
    strokeDasharray: "5,5",
  });
}
export { ActiveConnectionPath, ConnectionPath };
