import React, { useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { InfiniteCanvas } from "./upstream/infinite-canvas.js";
import { ConnectionPath } from "./upstream/canvas-connections.js";
import { Minimap } from "./upstream/canvas-mini-map.js";
import { setTheme } from "./theme.js";

const h = React.createElement;
function Slot({ element }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    ref.current.append(element);
    return () => element.remove();
  }, [element]);
  return h("div", { ref });
}
function Surface({ world, viewport, callbacks, tool, backgroundMode }) {
  const containerRef = useRef(null);
  return h(
    InfiniteCanvas,
    { containerRef, viewport, tool, backgroundMode, ...callbacks },
    h(Slot, { element: world }),
  );
}
// React owns the viewport; card plugins keep ownership of their DOM and drafts.
// Both layers dispatch through canvasSession rather than keeping a second document.
export function mountSurface(stage, world, svg, callbacks) {
  const host = document.createElement("div");
  host.className = "studio-react-surface";
  stage.prepend(host);
  const root = createRoot(host),
    wires = createRoot(svg);
  const miniHost = document.createElement("div");
  miniHost.className = "studio-minimap-host";
  miniHost.dataset.canvasNoZoom = "";
  stage.append(miniHost);
  const mini = createRoot(miniHost);
  return {
    update(viewport, options) {
      flushSync(() =>
        root.render(
          h(Surface, {
            world,
            viewport: { x: viewport.x, y: viewport.y, k: viewport.zoom },
            callbacks,
            ...options,
          }),
        ),
      );
    },
    wires(board, size, disconnect) {
      const nodes = new Map(
        board.nodes.map((n) => [
          n.id,
          { ...n, position: { x: n.x, y: n.y }, ...size(n) },
        ]),
      );
      const edges = [
        ...board.edges,
        ...board.nodes
          .filter((n) => n.sourceNodeId && nodes.has(n.sourceNodeId))
          .map((n) => ({
            id: "source-" + n.id,
            from: n.sourceNodeId,
            to: n.id,
            source: true,
          })),
      ];
      flushSync(() =>
        wires.render(
          edges.map((e) =>
            nodes.has(e.from) && nodes.has(e.to)
              ? h(ConnectionPath, {
                  key: e.id,
                  connection: e,
                  from: nodes.get(e.from),
                  to: nodes.get(e.to),
                  active: false,
                  onSelect: () => {
                    if (!e.source) disconnect(e.id);
                  },
                })
              : null,
          ),
        ),
      );
    },
    minimap(show, board, viewport, size) {
      flushSync(() =>
        mini.render(
          show
            ? h(Minimap, {
                nodes: board.nodes.map((n) => ({
                  ...n,
                  position: { x: n.x, y: n.y },
                  ...size(n),
                })),
                viewport: { x: viewport.x, y: viewport.y, k: viewport.zoom },
                viewportSize: {
                  width: stage.clientWidth,
                  height: stage.clientHeight,
                },
                onViewportChange: callbacks.onViewportChange,
              })
            : null,
        ),
      );
    },
    theme: setTheme,
    dispose() {
      flushSync(() => {
        mini.unmount();
        wires.unmount();
        root.unmount();
      });
      host.remove();
      miniHost.remove();
    },
  };
}
