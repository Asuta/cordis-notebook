// Adapted from basketikun/infinite-canvas@3a6b64b (MIT). See LICENSE and ../../../INFINITE-CANVAS.md.
import React, { useEffect, useRef, useState } from "react";
import { canvasThemes } from "./canvas-theme.js";
import { useThemeStore } from "../theme.js";
function InfiniteCanvas({
  containerRef,
  viewport,
  tool,
  backgroundMode = "lines",
  onViewportChange,
  onCanvasMouseDown,
  onCanvasDeselect,
  onCanvasDoubleClick,
  onContextMenu,
  onDrop,
  children,
  blocked,
  onPanStateChange,
}) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const panState = useRef({
    isPanning: false,
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
    hasMoved: false,
    startedOnBackground: false,
  });
  const scaleRef = useRef(viewport.k);
  const frameRef = useRef(null);
  const nextViewportRef = useRef(null);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isControlPressed, setIsControlPressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const cancelPan = () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    nextViewportRef.current = null;
    const previous = panState.current;
    if (previous.isPanning)
      onViewportChange({
        x: previous.initialX,
        y: previous.initialY,
        k: scaleRef.current,
      });
    previous.isPanning = false;
    setIsPanning(false);
    onPanStateChange?.(false);
    document.body.style.cursor = "";
  };
  useEffect(() => {
    scaleRef.current = viewport.k;
  }, [viewport.k]);
  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    },
    [],
  );
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!event.isComposing && event.key === "Escape") cancelPan();
      if (event.key === "Control") setIsControlPressed(true);
      if (event.code !== "Space") return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        target?.closest("[contenteditable='true']")
      )
        return;
      event.preventDefault();
      setIsSpacePressed(true);
    };
    const handleKeyUp = (event) => {
      if (event.code === "Space") {
        const target = event.target instanceof Element ? event.target : null;
        if (!(
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement ||
          event.target instanceof HTMLSelectElement ||
          target?.closest("[contenteditable='true']")
        ))
          event.preventDefault();
        setIsSpacePressed(false);
      }
      if (event.key === "Control") setIsControlPressed(false);
    };
    const handleBlur = () => {
      setIsSpacePressed(false);
      setIsControlPressed(false);
      cancelPan();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);
  const handleWheel = (event) => {
    if (blocked?.()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (
      target?.closest(
        "input,textarea,select,[contenteditable='true'],[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown",
      )
    )
      return;
    const delta = -event.deltaY;
    const factor = Math.pow(1.1, delta / 100);
    const newScale = Math.min(Math.max(viewport.k * factor, 0.15), 3);
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const worldX = (mouseX - viewport.x) / viewport.k;
    const worldY = (mouseY - viewport.y) / viewport.k;
    onViewportChange({
      x: mouseX - worldX * newScale,
      y: mouseY - worldY * newScale,
      k: newScale,
    });
  };
  const handlePointerDown = (event) => {
    if (blocked?.() || event.shiftKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-canvas-no-zoom]")) return;
    if (target?.closest("[data-connection-create-menu]")) return;
    const isBackgroundClick = !target?.closest(
      "[data-node-id],[data-connection-id]",
    );
    const temporaryTool2 = event.ctrlKey || isSpacePressed;
    const activeTool2 = temporaryTool2
      ? tool === "select"
        ? "pan"
        : "select"
      : tool;
    const shouldPan =
      isBackgroundClick &&
      (event.button === 1 || (event.button === 0 && activeTool2 === "pan"));
    if (shouldPan) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      panState.current = {
        isPanning: true,
        startX: event.clientX,
        startY: event.clientY,
        initialX: viewport.x,
        initialY: viewport.y,
        hasMoved: false,
        startedOnBackground: isBackgroundClick,
      };
      setIsPanning(true);
      onPanStateChange?.(true);
      document.body.style.cursor = "grabbing";
      return;
    }
    if (event.button === 0 && isBackgroundClick) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      onCanvasMouseDown?.(event);
    }
  };
  const handleDoubleClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (
      target?.closest(
        "[data-canvas-no-zoom],[data-node-id],[data-connection-id]",
      )
    )
      return;
    onCanvasDoubleClick?.(event);
  };
  useEffect(() => {
    const handlePointerMove = (event) => {
      if (!panState.current.isPanning) return;
      const dx = event.clientX - panState.current.startX;
      const dy = event.clientY - panState.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        panState.current.hasMoved = true;
      }
      nextViewportRef.current = {
        x: panState.current.initialX + dx,
        y: panState.current.initialY + dy,
        k: scaleRef.current,
      };
      if (frameRef.current) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        if (nextViewportRef.current) onViewportChange(nextViewportRef.current);
      });
    };
    const handlePointerUp = () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
        if (nextViewportRef.current) onViewportChange(nextViewportRef.current);
      }
      if (!panState.current.isPanning) return;
      if (!panState.current.hasMoved && panState.current.startedOnBackground) {
        onCanvasDeselect?.();
      }
      panState.current.isPanning = false;
      setIsPanning(false);
      onPanStateChange?.(false);
      document.body.style.cursor = "";
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", cancelPan);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", cancelPan);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      document.body.style.cursor = "";
    };
  }, [onCanvasDeselect, onViewportChange]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const preventWheelScroll = (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          "input,textarea,select,[contenteditable='true'],[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown",
        )
      )
        return;
      event.preventDefault();
    };
    container.addEventListener("wheel", preventWheelScroll, { passive: false });
    return () => container.removeEventListener("wheel", preventWheelScroll);
  }, [containerRef]);
  const temporaryTool = isControlPressed || isSpacePressed;
  const activeTool = temporaryTool
    ? tool === "select"
      ? "pan"
      : "select"
    : tool;
  const cursor = isPanning
    ? "grabbing"
    : activeTool === "pan"
      ? "grab"
      : void 0;
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      ref: containerRef,
      className:
        "studio-infinite-surface relative h-full w-full select-none overflow-hidden",
      style: { background: theme.canvas.background, cursor },
      onPointerDown: handlePointerDown,
      onDoubleClick: handleDoubleClick,
      onWheel: handleWheel,
      onContextMenu,
      onDragOver: (event) => event.preventDefault(),
      onDrop,
    },
    /* @__PURE__ */ React.createElement(CanvasGrid, {
      viewport,
      mode: backgroundMode,
    }),
    /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "absolute origin-top-left",
        style: {
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})`,
        },
      },
      children,
    ),
  );
}
function CanvasGrid({ viewport, mode }) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  if (mode === "blank") return null;
  const gridSize = 48 * viewport.k;
  const x = viewport.x % gridSize;
  const y = viewport.y % gridSize;
  const dotSize = viewport.k < 0.12 ? 0.8 : 1.15;
  const backgroundImage =
    mode === "dots"
      ? `radial-gradient(circle, ${theme.canvas.dot} ${dotSize}px, transparent ${dotSize + 0.2}px)`
      : `linear-gradient(${theme.canvas.line} 1px, transparent 1px), linear-gradient(90deg, ${theme.canvas.line} 1px, transparent 1px)`;
  return /* @__PURE__ */ React.createElement("div", {
    className: "pointer-events-none absolute inset-0 opacity-40",
    style: {
      backgroundImage,
      backgroundSize: `${gridSize}px ${gridSize}px`,
      backgroundPosition: `${x}px ${y}px`,
    },
  });
}
export { InfiniteCanvas };
