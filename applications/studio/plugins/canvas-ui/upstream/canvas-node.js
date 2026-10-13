// Adapted from basketikun/infinite-canvas@3a6b64b (MIT). See LICENSE and ../../../INFINITE-CANVAS.md.
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronRight, Copy, Download, Group, Image as ImageIcon, Music2, Puzzle, RefreshCw, Star, Trash2, Video } from "lucide-react";
import { canvasThemes } from "./canvas-theme.js";
import { formatBytes } from "./node-adapters.js";
import { pickImageSource } from "./image-thumbnail.js";
import { previewUrlFor, subscribeImagePreviews, getImagePreviewRevision } from "./node-adapters.js";
import { useThemeStore } from "../theme.js";
import { CanvasResourceMentionTextarea } from "./node-adapters.js";
import { CanvasNodeType } from "./node-adapters.js";
import { useTranslation } from "./node-adapters.js";
const selectionBlue = "#2f80ff";
const CanvasNode = React.memo(function CanvasNode2({
  data,
  scale,
  isSelected,
  isRelated,
  isFocusRelated,
  isConnectionTarget,
  isConnecting,
  referenceSelectionState,
  showPanel,
  showImageInfo,
  mentionReferences = [],
  pluginHost,
  renderPanel,
  renderNodeContent,
  groupChildCount = 0,
  isGroupDropTarget = false,
  batchExpanded = false,
  onMouseDown,
  onSelectCapture,
  onHoverStart,
  onHoverEnd,
  onConnectStart,
  onResizeStart,
  onResize,
  onResizeEnd,
  onContentChange,
  onTitleChange,
  onToggleBatch,
  onSetBatchPrimary,
  onDuplicateBatchImage,
  onDownloadBatchImage,
  onRetryBatchImage,
  onDeleteBatchImage,
  onRetry,
  onViewImage,
  onSelectReference,
  onContextMenu,
  onEditingChange = () => {
  },
  onTitleInput = () => {
  },
  editorRequest
}) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const definition = data.definition || {};
  const pluginContext = null;
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(data.title || "");
  const hasImageContent = data.type === CanvasNodeType.Image && Boolean(data.metadata?.content);
  const hasVideoContent = data.type === CanvasNodeType.Video && Boolean(data.metadata?.content);
  const hasAudioContent = data.type === CanvasNodeType.Audio && Boolean(data.metadata?.content);
  const isGroup = data.type === CanvasNodeType.Group;
  const batchCount = data.type === CanvasNodeType.Image ? data.metadata?.images?.length || 0 : data.type === CanvasNodeType.Text ? data.metadata?.texts?.length || 0 : 0;
  const isBatchRoot = batchCount > 1;
  const supportsInteractionToggle = Boolean(definition?.interactionToggle);
  const forceInteractive = supportsInteractionToggle ? Boolean(definition?.forceInteractive?.(data)) : false;
  const contentInteractive = !supportsInteractionToggle || forceInteractive || !data.metadata?.content ? true : Boolean(data.metadata?.interactive);
  const transparentBg = Boolean(definition?.transparentBackground);
  const isActive = isConnectionTarget || isSelected || isFocusRelated;
  const imageBorderColor = isActive ? selectionBlue : isRelated ? theme.node.muted : "transparent";
  const textareaRef = useRef(null);
  const stopContentEditing = () => {
    setIsEditingContent(false);
    onEditingChange(false);
  };
  const titleInputRef = useRef(null);
  useEffect(() => {
    if (!editorRequest) return;
    if (editorRequest.property === "title") setIsEditingTitle(true);
    else setIsEditingContent(true);
    onEditingChange(true);
  }, [editorRequest]);
  useEffect(() => {
    setTitleDraft(data.title || "");
  }, [data.title]);
  useEffect(() => {
    if (!isEditingTitle) return;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [isEditingTitle]);
  const finishTitleEditing = useCallback(() => {
    const title = titleDraft.trim() || data.title || t("canvas.node.untitled");
    setTitleDraft(title);
    setIsEditingTitle(false);
    if (title !== data.title) onTitleChange(data.id, title);
    onEditingChange(false);
  }, [data.id, data.title, onTitleChange, t, titleDraft]);
  useEffect(() => {
    if (!isEditingTitle) return;
    const handleOutsidePointerDown = (event) => {
      const target = event.target;
      if (target instanceof Node && titleInputRef.current?.contains(target)) return;
      finishTitleEditing();
    };
    window.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
  }, [finishTitleEditing, isEditingTitle]);
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const handleWheel = (event) => event.stopPropagation();
    textarea.addEventListener("wheel", handleWheel, { passive: false });
    return () => textarea.removeEventListener("wheel", handleWheel);
  }, [data.type, isEditingContent]);
  useEffect(() => {
    if (!isEditingContent) return;
    const textarea = textareaRef.current;
    textarea?.focus();
    textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
  }, [isEditingContent]);
  useEffect(() => {
    if (!isEditingContent) return;
    const handleOutsidePointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (isEditingContent && textareaRef.current?.contains(target)) return;
      stopContentEditing();
    };
    window.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
  }, [isEditingContent]);
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      "data-node-id": data.id,
      className: `node-element group/node absolute flex select-none flex-col transition-shadow duration-200 ${isGroup ? "z-[5]" : isSelected ? "z-50" : "z-10"} ${referenceSelectionState === "available" ? "cursor-pointer" : referenceSelectionState ? "cursor-not-allowed" : ""}`,
      style: {
        transform: `translate(${data.position.x}px, ${data.position.y}px)`,
        width: data.width,
        height: data.height,
        transition: "box-shadow 200ms ease",
        contain: "layout style"
      },
      onMouseEnter: () => {
        setHovered(true);
        onHoverStart(data.id);
      },
      onMouseLeave: () => {
        setHovered(false);
        onHoverEnd(data.id);
      },
      onMouseDownCapture: (event) => {
        if (!referenceSelectionState) onSelectCapture?.(event, data.id);
      },
      onContextMenu: (event) => {
        if (referenceSelectionState) event.preventDefault();
        else onContextMenu(event, data.id);
      }
    },
    !referenceSelectionState && (isSelected || hovered || isEditingTitle) && /* @__PURE__ */ React.createElement("div", { className: "absolute left-3 top-[-28px] z-[65] max-w-[calc(100%-24px)]", onMouseDown: (event) => event.stopPropagation(), onPointerDown: (event) => event.stopPropagation() }, isEditingTitle ? /* @__PURE__ */ React.createElement(
      "input",
      {
        ref: titleInputRef,
        value: titleDraft,
        maxLength: 120,
        "aria-label": `${data.title} \u6807\u9898`,
        className: "h-6 max-w-full border-0 border-b border-dashed bg-transparent px-0 text-left text-xs font-medium outline-none",
        style: { borderColor: theme.node.muted, color: theme.node.text },
        onInput: (event) => {
          setTitleDraft(event.target.value);
          onTitleInput(data.id, event.target.value);
        },
        onBlur: finishTitleEditing,
        onKeyDown: (event) => {
          if (event.isComposing || event.nativeEvent?.isComposing) return;
          if (event.key === "Enter") finishTitleEditing();
          if (event.key === "Escape") {
            finishTitleEditing();
          }
        }
      }
    ) : /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "block max-w-full truncate border-b border-dashed border-transparent px-0 py-0.5 text-left text-xs font-medium opacity-75 transition hover:border-current hover:opacity-100",
        style: { color: theme.node.text },
        title: t("canvas.node.renameHint"),
        onDoubleClick: (event) => {
          event.stopPropagation();
          setIsEditingTitle(true);
          onEditingChange(true);
        }
      },
      data.title || t("canvas.node.untitled")
    )),
    /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "relative h-full w-full overflow-visible rounded-3xl border-2",
        style: {
          background: isGroup ? "transparent" : hasImageContent || hasVideoContent || transparentBg ? "transparent" : theme.node.fill,
          borderColor: isGroup ? isGroupDropTarget || isActive ? selectionBlue : theme.node.stroke : hasImageContent ? imageBorderColor : isActive ? selectionBlue : isRelated ? theme.node.muted : transparentBg ? "transparent" : theme.node.stroke,
          borderStyle: isGroup ? "dashed" : "solid",
          boxShadow: isGroupDropTarget ? `0 0 0 2px ${selectionBlue}66, inset 0 0 0 999px ${selectionBlue}10` : isActive ? `0 0 0 1px ${selectionBlue}55` : isRelated ? `0 0 0 1px ${theme.node.muted}55, 0 18px 48px rgba(0,0,0,.14)` : void 0
        },
        onMouseDown: (event) => {
          if (!referenceSelectionState) onMouseDown(event, data.id);
          else if (event.button === 0 && referenceSelectionState === "available") {
            event.stopPropagation();
            onSelectReference?.(data.id);
          }
        },
        onDoubleClick: (event) => {
          if (referenceSelectionState) {
            event.stopPropagation();
            return;
          }
          if (definition?.onDoubleClick && pluginContext) {
            if (definition.onDoubleClick(pluginContext)) event.stopPropagation();
            return;
          }
          if (data.type === CanvasNodeType.Image && hasImageContent) {
            event.stopPropagation();
            onViewImage?.(data);
            return;
          }
          if (data.type !== CanvasNodeType.Text) return;
          event.stopPropagation();
          setIsEditingContent(true);
          onEditingChange(true);
        }
      },
      /* @__PURE__ */ React.createElement(
        "div",
        {
          className: `relative flex h-full w-full items-center justify-center rounded-[inherit] ${isBatchRoot ? "overflow-visible" : "overflow-hidden"}`,
          style: {
            background: isGroup ? "transparent" : hasImageContent || hasVideoContent || transparentBg ? "transparent" : theme.node.fill,
            pointerEvents: contentInteractive ? void 0 : "none"
          }
        },
        /* @__PURE__ */ React.createElement(
          NodeContent,
          {
            node: data,
            theme,
            isEditingContent,
            textareaRef,
            isBatchRoot,
            batchCount,
            batchExpanded,
            scale,
            renderNodeContent,
            pluginContext,
            mentionReferences,
            onContentChange,
            onStopEditing: () => stopContentEditing(),
            onRetry,
            onToggleBatch: () => onToggleBatch?.(data.id),
            onSetBatchPrimary: (itemId) => onSetBatchPrimary?.(data.id, itemId),
            onDuplicateBatchImage: (imageId) => onDuplicateBatchImage?.(data, imageId),
            onDownloadBatchImage: (imageId) => onDownloadBatchImage?.(data, imageId),
            onRetryBatchImage: (imageId) => onRetryBatchImage?.(data, imageId),
            onDeleteBatchImage: (imageId) => onDeleteBatchImage?.(data.id, imageId),
            onViewBatchImage: (imageId) => onViewImage?.(data, imageId),
            groupChildCount
          }
        )
      ),
      showImageInfo && hasImageContent ? /* @__PURE__ */ React.createElement(ImageInfoBar, { node: data }) : null,
      !isGroup && !hasImageContent && !hasVideoContent && !hasAudioContent ? /* @__PURE__ */ React.createElement("div", { className: "pointer-events-none absolute inset-x-0 bottom-0 h-12", style: { background: `linear-gradient(to top, ${theme.canvas.background}66, transparent)` } }) : null,
      referenceSelectionState && (referenceSelectionState !== "available" || hovered) ? /* @__PURE__ */ React.createElement("div", { className: "pointer-events-none absolute inset-0 z-[60] grid place-items-center rounded-[inherit]", style: { background: `color-mix(in srgb, ${theme.canvas.background} ${referenceSelectionState === "target" ? 78 : referenceSelectionState === "disabled" ? 60 : 34}%, transparent)`, boxShadow: referenceSelectionState === "available" ? `inset 0 0 0 2px ${selectionBlue}` : void 0 } }, referenceSelectionState !== "disabled" ? /* @__PURE__ */ React.createElement("span", { className: "rounded-lg px-3 py-2 text-sm font-medium shadow-sm", style: { background: theme.toolbar.panel, color: theme.node.text } }, t(referenceSelectionState === "target" ? "canvas.references.selecting" : "canvas.references.choose")) : null) : null,
      !referenceSelectionState ? /* @__PURE__ */ React.createElement(ResizeHandle, { corner: "top-left" }) : null,
      !referenceSelectionState ? /* @__PURE__ */ React.createElement(ResizeHandle, { corner: "top-right" }) : null,
      !referenceSelectionState ? /* @__PURE__ */ React.createElement(ResizeHandle, { corner: "bottom-left" }) : null,
      !referenceSelectionState ? /* @__PURE__ */ React.createElement(ResizeHandle, { corner: "bottom-right" }) : null
    ),
    !referenceSelectionState && !isGroup && definition.hasTargetHandle ? /* @__PURE__ */ React.createElement(ConnectionHandleDot, { nodeId: data.id, side: "left", visible: hovered || isSelected || isConnecting, onMouseDown: (event) => onConnectStart(event, data.id, "target") }) : null,
    !referenceSelectionState && (definition?.hasSourceHandle ?? true) && data.type !== CanvasNodeType.Config ? /* @__PURE__ */ React.createElement(ConnectionHandleDot, { nodeId: data.id, side: "right", visible: hovered || isSelected || isConnecting, onMouseDown: (event) => onConnectStart(event, data.id, "source") }) : null,
    showPanel && !isGroup && renderPanel ? /* @__PURE__ */ React.createElement("div", { className: "absolute left-1/2 top-full z-[70] w-[600px] pt-4", style: { transform: `translateX(-50%) scale(${1 / scale})`, transformOrigin: "top center" }, "data-node-panel": data.id }, renderPanel(data)) : null
  );
});
function NodeContent(props) {
  if (props.node.type === CanvasNodeType.Config && props.renderNodeContent) return props.renderNodeContent(props.node);
  if (props.isBatchRoot && props.node.type === CanvasNodeType.Image) return /* @__PURE__ */ React.createElement(ImageNodeContent, { ...props });
  if (props.node.type === CanvasNodeType.Text && props.node.metadata?.texts?.length && (props.node.metadata.status !== "error" || props.node.metadata.texts.some((text) => text.content))) return /* @__PURE__ */ React.createElement(TextContent, { ...props });
  if (props.node.metadata?.status === "loading") return /* @__PURE__ */ React.createElement(LoadingContent, { theme: props.theme });
  if (props.node.metadata?.status === "error") return /* @__PURE__ */ React.createElement(ErrorContent, { node: props.node, theme: props.theme, onRetry: props.onRetry });
  const Renderer = nodeContentRenderers[props.node.type];
  if (Renderer) return /* @__PURE__ */ React.createElement(Renderer, { ...props });
  const definition = props.node.definition;
  if (definition?.Content && props.pluginContext) {
    const PluginContent = definition.Content;
    return /* @__PURE__ */ React.createElement(PluginContent, { ctx: props.pluginContext });
  }
  return /* @__PURE__ */ React.createElement(MissingPluginContent, { theme: props.theme, type: props.node.type });
}
const nodeContentRenderers = {
  [CanvasNodeType.Text]: TextContent,
  [CanvasNodeType.Image]: ImageNodeContent,
  [CanvasNodeType.Config]: EmptyImageContent,
  [CanvasNodeType.Video]: VideoNodeContent,
  [CanvasNodeType.Audio]: AudioNodeContent,
  [CanvasNodeType.Group]: GroupNodeContent
};
function GroupNodeContent({ node, theme, groupChildCount }) {
  const { t } = useTranslation();
  return /* @__PURE__ */ React.createElement("div", { className: "pointer-events-none flex h-full w-full p-3" }, /* @__PURE__ */ React.createElement("div", { className: "flex h-7 max-w-full items-center gap-2 px-1 text-xs font-medium", style: { color: theme.node.text } }, /* @__PURE__ */ React.createElement(Group, { className: "size-3.5 shrink-0", style: { color: theme.node.muted } }), /* @__PURE__ */ React.createElement("span", { className: "truncate" }, node.title || t("canvas.node.group")), /* @__PURE__ */ React.createElement("span", { className: "shrink-0 text-[11px] font-normal", style: { color: theme.node.muted } }, t("canvas.node.nodeCount", { count: groupChildCount }))));
}
function LoadingContent({ theme }) {
  const { t } = useTranslation();
  return /* @__PURE__ */ React.createElement("div", { className: "flex h-full w-full flex-col items-center justify-center gap-3", style: { color: theme.node.activeStroke } }, /* @__PURE__ */ React.createElement("div", { className: "size-10 animate-spin rounded-full border-2", style: { borderColor: theme.node.stroke, borderTopColor: theme.node.activeStroke } }), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] tracking-[0.2em]" }, t("canvas.node.generating")));
}
function ErrorContent({ node, theme, onRetry }) {
  const { t } = useTranslation();
  return /* @__PURE__ */ React.createElement("div", { className: "flex max-w-[260px] flex-col items-center gap-3 px-5 text-center" }, /* @__PURE__ */ React.createElement("div", { className: "text-xs leading-5 text-red-300" }, node.metadata?.errorDetails || t("canvas.node.failed")), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      className: "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition hover:scale-[1.02]",
      style: { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text },
      onClick: (event) => {
        event.stopPropagation();
        onRetry?.(node);
      },
      onMouseDown: (event) => event.stopPropagation()
    },
    /* @__PURE__ */ React.createElement(RefreshCw, { className: "size-3.5" }),
    t("canvas.node.retry")
  ));
}
function MissingPluginContent({ theme, type }) {
  const { t } = useTranslation();
  return /* @__PURE__ */ React.createElement("div", { className: "flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center", style: { color: theme.node.placeholder } }, /* @__PURE__ */ React.createElement(Puzzle, { className: "size-7 opacity-40" }), /* @__PURE__ */ React.createElement("span", { className: "text-sm" }, t("canvas.node.missingPlugin")), /* @__PURE__ */ React.createElement("span", { className: "text-[11px] opacity-70" }, t("canvas.node.missingPluginDescription", { type })));
}
function TextContent({ node, theme, isEditingContent, textareaRef, mentionReferences, batchExpanded, onContentChange, onStopEditing, onToggleBatch, onSetBatchPrimary }) {
  const { t } = useTranslation();
  const fontSize = node.metadata?.fontSize || 14;
  const textStyle = { fontSize: `${fontSize}px`, lineHeight: `${Math.round(fontSize * 1.65)}px`, color: theme.node.text, boxSizing: "border-box" };
  const texts = node.metadata?.texts || [];
  const batchCount = texts.length;
  const isBatchRoot = batchCount > 1;
  const primaryTextId = node.metadata?.primaryTextId || texts[0]?.id;
  const primaryText = texts.find((text) => text.id === primaryTextId);
  const content = primaryText?.content || node.metadata?.content || "";
  const paddingClass = isBatchRoot ? "px-4 pb-4 pt-14" : "p-4";
  return /* @__PURE__ */ React.createElement(BatchFrame, { batchCount, batchExpanded }, batchExpanded ? texts.filter((text) => text.id !== primaryTextId).map((text, index) => /* @__PURE__ */ React.createElement(ExpandedTextCard, { key: text.id, node, text, index, onSetPrimary: () => onSetBatchPrimary?.(text.id) })) : null, /* @__PURE__ */ React.createElement("div", { className: "flex h-full w-full flex-col overflow-hidden rounded-3xl" }, isEditingContent ? /* @__PURE__ */ React.createElement(
    CanvasResourceMentionTextarea,
    {
      ref: textareaRef,
      "aria-label": `${node.title} \u6587\u5B57\u5185\u5BB9`,
      maxLength: 12e3,
      className: `thin-scrollbar block h-full w-full resize-none overflow-y-auto whitespace-pre-wrap break-words border-none bg-transparent m-0 font-mono outline-none select-text appearance-none ${paddingClass}`,
      style: textStyle,
      value: content,
      references: mentionReferences,
      highlightLabels: false,
      onChange: (value) => onContentChange(node.id, value),
      onBlur: onStopEditing,
      onKeyDown: (event) => {
        if (!(event.isComposing || event.nativeEvent?.isComposing) && event.key === "Escape") {
          event.stopPropagation();
          onStopEditing();
        }
      },
      onMouseDown: (event) => event.stopPropagation(),
      onPointerDown: (event) => event.stopPropagation(),
      onWheel: (event) => event.stopPropagation()
    }
  ) : content ? /* @__PURE__ */ React.createElement("div", { className: `thin-scrollbar block h-full w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent font-mono ${paddingClass}`, style: textStyle, onWheel: (event) => event.stopPropagation() }, content) : primaryText ? /* @__PURE__ */ React.createElement(TextSlotStatus, { text: primaryText }) : /* @__PURE__ */ React.createElement("div", { className: "p-4 font-mono", style: { color: theme.node.placeholder } }, t("canvas.node.editText"))), isBatchRoot ? /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      className: "absolute right-2.5 top-2.5 z-30 flex h-8 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-semibold shadow-[0_6px_18px_rgba(28,25,23,.12)] backdrop-blur-md transition hover:scale-[1.02]",
      style: { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText },
      "aria-label": batchExpanded ? t("canvas.node.textBatchExpanded") : t("canvas.node.textBatchCollapsed"),
      onClick: (event) => {
        event.stopPropagation();
        onToggleBatch?.();
      },
      onMouseDown: (event) => event.stopPropagation(),
      onPointerDown: (event) => event.stopPropagation()
    },
    /* @__PURE__ */ React.createElement("span", { className: "leading-none" }, t("canvas.controls.texts", { count: batchCount })),
    /* @__PURE__ */ React.createElement(ChevronRight, { className: `size-3.5 opacity-80 transition-transform ${batchExpanded ? "rotate-90" : ""}` })
  ) : null);
}
function ExpandedTextCard({ node, text, index, onSetPrimary }) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const { t } = useTranslation();
  const count = node.metadata?.texts?.length || 0;
  const columns = Math.min(count, 4);
  const rows = Math.ceil(count / columns);
  const rootSlot = (rows - 1) * columns;
  const slot = index >= rootSlot ? index + 1 : index;
  const x = slot % columns * (node.width + 18);
  const y = (Math.floor(slot / columns) - rows + 1) * (node.height + 18);
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "absolute z-20 overflow-hidden rounded-3xl border shadow-[0_18px_50px_rgba(28,25,23,.14)]",
      style: {
        left: x,
        top: y,
        width: node.width,
        height: node.height,
        background: theme.node.panel,
        borderColor: theme.node.stroke,
        "--batch-from-x": `${-x}px`,
        "--batch-from-y": `${-y}px`,
        "--batch-from-rotate": `${4 + index * 2}deg`,
        animation: `canvas-batch-child-in 320ms ${index * 35}ms cubic-bezier(.2,.85,.18,1) both`
      },
      onMouseDown: (event) => event.stopPropagation(),
      onPointerDown: (event) => event.stopPropagation()
    },
    text.content ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "thin-scrollbar h-full overflow-y-auto whitespace-pre-wrap break-words px-4 pb-4 pt-14 font-mono text-sm leading-6", style: { color: theme.node.text }, onWheel: (event) => event.stopPropagation() }, text.content), /* @__PURE__ */ React.createElement("button", { type: "button", className: "pointer-events-none absolute right-2.5 top-2.5 flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium opacity-0 transition duration-150 hover:bg-black/5 group-hover/node:pointer-events-auto group-hover/node:opacity-100 dark:hover:bg-white/10", style: { color: theme.node.text }, onClick: (event) => (event.stopPropagation(), onSetPrimary()) }, /* @__PURE__ */ React.createElement(Star, { className: "size-3.5", style: { color: selectionBlue } }), t("canvas.node.setPrimaryText"))) : /* @__PURE__ */ React.createElement(TextSlotStatus, { text })
  );
}
function TextSlotStatus({ text }) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const { t } = useTranslation();
  const failed = text.status === "error";
  const loading = text.status === "loading";
  return /* @__PURE__ */ React.createElement("div", { className: "flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center", style: { background: theme.node.fill, color: failed ? theme.node.text : theme.node.activeStroke } }, failed ? /* @__PURE__ */ React.createElement("span", { className: "text-xs leading-5" }, text.errorDetails || t("canvas.node.failed")) : loading ? /* @__PURE__ */ React.createElement("div", { className: "size-10 animate-spin rounded-full border-2", style: { borderColor: theme.node.stroke, borderTopColor: theme.node.activeStroke } }) : /* @__PURE__ */ React.createElement("span", { className: "text-xs" }, t("apiErrors.noContent")), loading ? /* @__PURE__ */ React.createElement("span", { className: "text-[10px] tracking-[0.2em]" }, t("canvas.node.generating")) : null);
}
function ImageNodeContent(props) {
  if (!props.node.metadata?.content && !props.isBatchRoot) return /* @__PURE__ */ React.createElement(EmptyImageContent, { ...props });
  return /* @__PURE__ */ React.createElement(
    ImageContent,
    {
      node: props.node,
      batchExpanded: props.batchExpanded,
      scale: props.scale,
      onToggleBatch: props.onToggleBatch,
      onSetBatchPrimary: props.onSetBatchPrimary,
      onDuplicateBatchImage: props.onDuplicateBatchImage,
      onDownloadBatchImage: props.onDownloadBatchImage,
      onRetryBatchImage: props.onRetryBatchImage,
      onDeleteBatchImage: props.onDeleteBatchImage,
      onViewBatchImage: props.onViewBatchImage
    }
  );
}
function EmptyImageContent({ theme }) {
  const { t } = useTranslation();
  return /* @__PURE__ */ React.createElement("div", { className: "flex h-full w-full flex-col items-center justify-center gap-3", style: { color: theme.node.placeholder } }, /* @__PURE__ */ React.createElement("div", { className: "flex size-14 items-center justify-center rounded-2xl", style: { background: theme.toolbar.activeBg } }, /* @__PURE__ */ React.createElement(ImageIcon, { className: "size-6 opacity-30" })), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] tracking-[0.18em] opacity-50" }, t("canvas.node.emptyImage")));
}
function VideoNodeContent({ node, theme }) {
  const { t } = useTranslation();
  if (!node.metadata?.content)
    return /* @__PURE__ */ React.createElement("div", { className: "flex h-full w-full flex-col items-center justify-center gap-3", style: { color: theme.node.placeholder } }, /* @__PURE__ */ React.createElement(Video, { className: "size-7 opacity-35" }), /* @__PURE__ */ React.createElement("span", { className: "text-sm" }, t("canvas.node.emptyVideo")));
  return /* @__PURE__ */ React.createElement("video", { src: node.metadata.content, controls: true, className: "h-full w-full rounded-[18px] bg-black object-contain", "data-canvas-video": node.id, "data-canvas-no-zoom": true });
}
function AudioNodeContent({ node, theme }) {
  const { t } = useTranslation();
  if (!node.metadata?.content)
    return /* @__PURE__ */ React.createElement("div", { className: "flex h-full w-full flex-col items-center justify-center gap-2", style: { color: theme.node.placeholder } }, /* @__PURE__ */ React.createElement(Music2, { className: "size-7 opacity-35" }), /* @__PURE__ */ React.createElement("span", { className: "text-sm" }, t("canvas.node.emptyAudio")));
  return /* @__PURE__ */ React.createElement("div", { className: "flex h-full w-full flex-col justify-center gap-3 px-4", style: { background: theme.node.fill, color: theme.node.text } }, /* @__PURE__ */ React.createElement("div", { className: "flex min-w-0 items-center gap-2 text-sm opacity-70" }, /* @__PURE__ */ React.createElement(Music2, { className: "size-4 shrink-0" }), /* @__PURE__ */ React.createElement("span", { className: "truncate" }, t("canvas.node.audio"))), /* @__PURE__ */ React.createElement("audio", { src: node.metadata.content, controls: true, className: "w-full", "data-canvas-no-zoom": true }));
}
function ImageContent({
  node,
  batchExpanded,
  scale,
  onToggleBatch,
  onSetBatchPrimary,
  onDuplicateBatchImage,
  onDownloadBatchImage,
  onRetryBatchImage,
  onDeleteBatchImage,
  onViewBatchImage
}) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const { t } = useTranslation();
  useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
  const images = node.metadata?.images || [];
  const batchCount = images.length;
  const isBatchRoot = batchCount > 1;
  const primaryImageId = node.metadata?.primaryImageId || images[0]?.id;
  const primaryImage = images.find((image) => image.id === primaryImageId);
  const primaryContent = primaryImage?.content || node.metadata?.content;
  const primaryPreviewUrl = previewUrlFor(primaryImage?.storageKey || node.metadata?.storageKey);
  const primarySource = primaryContent ? pickImageSource({
    previewUrl: primaryPreviewUrl,
    originalUrl: primaryContent,
    naturalWidth: primaryImage?.naturalWidth || node.metadata?.naturalWidth,
    naturalHeight: primaryImage?.naturalHeight || node.metadata?.naturalHeight,
    renderedWidth: node.width,
    renderedHeight: node.height,
    scale
  }) : void 0;
  return /* @__PURE__ */ React.createElement(BatchFrame, { batchCount, batchExpanded }, batchExpanded ? images.filter((image) => image.id !== primaryImageId).map((image, index) => /* @__PURE__ */ React.createElement(ExpandedImageCard, { key: image.id, node, image, index, scale, onView: () => onViewBatchImage?.(image.id), onSetPrimary: () => onSetBatchPrimary?.(image.id), onDuplicate: () => onDuplicateBatchImage?.(image.id), onDownload: () => onDownloadBatchImage?.(image.id), onRetry: () => onRetryBatchImage?.(image.id), onDelete: () => onDeleteBatchImage?.(image.id) })) : null, /* @__PURE__ */ React.createElement("div", { className: "h-full w-full overflow-hidden rounded-3xl" }, primaryContent ? /* @__PURE__ */ React.createElement(
    "img",
    {
      src: primarySource,
      alt: node.title,
      draggable: false,
      onDragStart: (event) => event.preventDefault(),
      className: `pointer-events-none block h-full w-full select-none ${node.metadata?.freeResize ? "object-fill" : "object-contain"}`
    }
  ) : /* @__PURE__ */ React.createElement(ImageSlotStatus, { image: primaryImage })), primaryImage?.status === "error" ? /* @__PURE__ */ React.createElement(BatchImageFailureActions, { placement: "left", onRetry: () => onRetryBatchImage?.(primaryImage.id), onDelete: () => onDeleteBatchImage?.(primaryImage.id) }) : null, primaryImage?.content ? /* @__PURE__ */ React.createElement("button", { type: "button", className: "pointer-events-none absolute left-2.5 top-2.5 z-30 flex h-8 items-center gap-1 rounded-lg border px-2 text-[10px] font-medium opacity-0 shadow-[0_6px_18px_rgba(15,23,42,.16)] backdrop-blur-md transition hover:scale-[1.02] group-hover/node:pointer-events-auto group-hover/node:opacity-100", style: { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }, title: t("common.download"), onClick: (event) => (event.stopPropagation(), onDownloadBatchImage?.(primaryImage.id)) }, /* @__PURE__ */ React.createElement(Download, { className: "size-3" }), t("common.download")) : null, isBatchRoot ? /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      className: "absolute right-2.5 top-2.5 z-30 flex h-8 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-semibold shadow-[0_6px_18px_rgba(28,25,23,.16)] backdrop-blur-md transition hover:scale-[1.02]",
      style: { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText },
      "aria-label": batchExpanded ? t("canvas.node.batchExpanded") : t("canvas.node.batchCollapsed"),
      onClick: (event) => {
        event.stopPropagation();
        onToggleBatch?.();
      },
      onMouseDown: (event) => event.stopPropagation(),
      onPointerDown: (event) => event.stopPropagation()
    },
    /* @__PURE__ */ React.createElement("span", { className: "leading-none" }, t("canvas.controls.images", { count: batchCount })),
    /* @__PURE__ */ React.createElement(ChevronRight, { className: `size-3.5 opacity-80 transition-transform ${batchExpanded ? "rotate-90" : ""}` })
  ) : null);
}
function ExpandedImageCard({ node, image, index, scale, onView, onSetPrimary, onDuplicate, onDownload, onRetry, onDelete }) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const { t } = useTranslation();
  useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
  const count = node.metadata?.images?.length || 0;
  const columns = Math.min(count, 4);
  const rows = Math.ceil(count / columns);
  const rootSlot = (rows - 1) * columns;
  const slot = index >= rootSlot ? index + 1 : index;
  const column = slot % columns;
  const row = Math.floor(slot / columns);
  const x = column * (node.width + 18);
  const y = (row - rows + 1) * (node.height + 18);
  const source = image.content ? pickImageSource({
    previewUrl: previewUrlFor(image.storageKey),
    originalUrl: image.content,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    renderedWidth: node.width,
    renderedHeight: node.height,
    scale
  }) : void 0;
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: `absolute z-20 overflow-hidden rounded-3xl ${image.content ? "" : "border shadow-[0_18px_50px_rgba(28,25,23,.18)]"}`,
      style: {
        left: x,
        top: y,
        width: node.width,
        height: node.height,
        background: "transparent",
        borderColor: theme.node.stroke,
        "--batch-from-x": `${-x}px`,
        "--batch-from-y": `${-y}px`,
        "--batch-from-rotate": `${4 + index * 2}deg`,
        animation: `canvas-batch-child-in 320ms ${index * 35}ms cubic-bezier(.2,.85,.18,1) both`
      },
      onMouseDown: (event) => event.stopPropagation(),
      onPointerDown: (event) => event.stopPropagation(),
      onDoubleClick: (event) => {
        if (!image.content || event.target instanceof Element && event.target.closest("button")) return;
        event.stopPropagation();
        onView();
      }
    },
    image.content ? /* @__PURE__ */ React.createElement("img", { src: source, alt: node.title, draggable: false, className: "pointer-events-none h-full w-full select-none object-contain" }) : /* @__PURE__ */ React.createElement(ImageSlotStatus, { image }),
    image.content ? /* @__PURE__ */ React.createElement("div", { className: "pointer-events-none absolute inset-x-2 top-2 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/node:pointer-events-auto group-hover/node:opacity-100" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg border px-1.5 text-[10px] font-medium shadow-[0_6px_18px_rgba(15,23,42,.16)] backdrop-blur-md transition hover:scale-[1.02]", style: { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }, title: t("common.download"), onClick: (event) => (event.stopPropagation(), onDownload()) }, /* @__PURE__ */ React.createElement(Download, { className: "size-3 shrink-0" }), /* @__PURE__ */ React.createElement("span", { className: "truncate" }, t("common.download"))), /* @__PURE__ */ React.createElement("button", { type: "button", className: "flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg border px-1.5 text-[10px] font-medium shadow-[0_6px_18px_rgba(15,23,42,.16)] backdrop-blur-md transition hover:scale-[1.02]", style: { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }, title: t("canvas.node.createCopy"), onClick: (event) => (event.stopPropagation(), onDuplicate()) }, /* @__PURE__ */ React.createElement(Copy, { className: "size-3 shrink-0" }), /* @__PURE__ */ React.createElement("span", { className: "truncate" }, t("canvas.node.createCopy"))), /* @__PURE__ */ React.createElement("button", { type: "button", className: "flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg border px-1.5 text-[10px] font-medium shadow-[0_6px_18px_rgba(15,23,42,.16)] backdrop-blur-md transition hover:scale-[1.02]", style: { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }, title: t("canvas.node.setPrimary"), onClick: (event) => (event.stopPropagation(), onSetPrimary()) }, /* @__PURE__ */ React.createElement(Star, { className: "size-3 shrink-0", style: { color: selectionBlue } }), /* @__PURE__ */ React.createElement("span", { className: "truncate" }, t("canvas.node.setPrimary")))) : null,
    image.status === "error" ? /* @__PURE__ */ React.createElement(BatchImageFailureActions, { placement: "right", onRetry, onDelete }) : null
  );
}
function BatchImageFailureActions({ placement, onRetry, onDelete }) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const { t } = useTranslation();
  return /* @__PURE__ */ React.createElement("div", { className: `absolute top-3 z-30 flex items-center gap-1.5 ${placement === "left" ? "left-3" : "right-3"}` }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium shadow-sm transition hover:scale-[1.02]", style: { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }, onClick: (event) => (event.stopPropagation(), onRetry()) }, /* @__PURE__ */ React.createElement(RefreshCw, { className: "size-3.5" }), t("canvas.node.retry")), /* @__PURE__ */ React.createElement("button", { type: "button", className: "grid size-8 place-items-center rounded-lg border shadow-sm transition hover:scale-[1.02]", style: { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }, onClick: (event) => (event.stopPropagation(), onDelete()), "aria-label": t("common.delete"), title: t("common.delete") }, /* @__PURE__ */ React.createElement(Trash2, { className: "size-3.5" })));
}
function ImageSlotStatus({ image }) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const { t } = useTranslation();
  const failed = image?.status === "error";
  return /* @__PURE__ */ React.createElement("div", { className: "flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center", style: { background: theme.node.fill, color: failed ? theme.node.text : theme.node.activeStroke } }, failed ? /* @__PURE__ */ React.createElement("span", { className: "text-xs leading-5" }, image.errorDetails || t("canvas.node.failed")) : /* @__PURE__ */ React.createElement("div", { className: "size-10 animate-spin rounded-full border-2", style: { borderColor: theme.node.stroke, borderTopColor: theme.node.activeStroke } }), !failed ? /* @__PURE__ */ React.createElement("span", { className: "text-[10px] tracking-[0.2em]" }, t("canvas.node.generating")) : null);
}
function ImageInfoBar({ node }) {
  const width = Math.round(node.metadata?.naturalWidth || node.width);
  const height = Math.round(node.metadata?.naturalHeight || node.height);
  const size = formatBytes(node.metadata?.bytes || 0);
  return /* @__PURE__ */ React.createElement("div", { className: "pointer-events-none absolute bottom-3 right-3 z-40 max-w-[calc(100%-24px)]" }, /* @__PURE__ */ React.createElement("span", { className: "max-w-full truncate rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium leading-none text-white backdrop-blur-sm" }, width, " x ", height, size ? ` \xB7 ${size}` : ""));
}
function BatchFrame({ batchCount, batchExpanded, children }) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const isBatchRoot = batchCount > 1;
  return /* @__PURE__ */ React.createElement("div", { className: "group/batch relative h-full w-full overflow-visible" }, isBatchRoot ? /* @__PURE__ */ React.createElement("div", { className: "pointer-events-none absolute inset-0 overflow-visible" }, Array.from({ length: Math.min(batchCount - 1, 3) }).map((_, index) => /* @__PURE__ */ React.createElement(
    "div",
    {
      key: index,
      className: "absolute rounded-[inherit] border shadow-[0_10px_24px_rgba(68,64,60,.12)] transition-all duration-300 group-hover/batch:translate-x-1",
      style: {
        inset: 0,
        background: `linear-gradient(135deg, ${theme.node.panel}, ${theme.node.fill})`,
        borderColor: theme.node.stroke,
        opacity: batchExpanded ? 0 : 1,
        transform: `translate(${10 + index * 6}px, ${4 + index * 3}px) rotate(${1.5 + index}deg)`,
        zIndex: -index - 1
      }
    }
  ))) : null, children);
}
function ResizeHandle({ corner }) {
  const positionClass = {
    "top-left": "-left-[14px] -top-[14px] cursor-nwse-resize",
    "top-right": "-right-[14px] -top-[14px] cursor-nesw-resize",
    "bottom-left": "-bottom-[14px] -left-[14px] cursor-nesw-resize",
    "bottom-right": "-bottom-[14px] -right-[14px] cursor-nwse-resize"
  }[corner];
  return /* @__PURE__ */ React.createElement("div", { className: `absolute z-50 size-7 ${positionClass}`, "data-resize": corner, role: "button", "aria-label": `\u8C03\u6574\u5361\u7247\u5927\u5C0F\uFF1A${corner}` });
}
function ConnectionHandleDot({ nodeId, side, visible, onMouseDown }) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: `absolute top-1/2 z-30 flex size-12 -translate-y-1/2 cursor-crosshair items-center justify-center transition-opacity duration-150 ${side === "left" ? "-left-6" : "-right-6"} ${visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`,
      "data-input": side === "left" ? nodeId : void 0,
      "data-output": side === "right" ? nodeId : void 0,
      role: "button",
      "aria-label": side === "left" ? "\u8F93\u5165" : "\u8FDE\u63A5",
      onMouseDown
    },
    /* @__PURE__ */ React.createElement("div", { className: "size-3 rounded-full border-2 transition-all hover:scale-125", style: { background: theme.node.panel, borderColor: theme.node.muted } })
  );
}
export {
  CanvasNode
};
