// Adapted from infinite-canvas@3a6b64b CanvasConfigNodePanel / CanvasNodePromptPanel (MIT).
// See ../canvas-ui/upstream/LICENSE and ../../INFINITE-CANVAS.md.
import React from "react";
const stop = (event) => event.stopPropagation();
const icon = (kind) => /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 24 24", width: "16", height: "16", fill: "none", stroke: "currentColor", strokeWidth: "1.7", "aria-hidden": "true" }, kind === "play" ? /* @__PURE__ */ React.createElement("path", { d: "m8 5 11 7-11 7z" }) : kind === "up" ? /* @__PURE__ */ React.createElement("path", { d: "M12 20V4m-7 7 7-7 7 7" }) : kind === "image" ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("rect", { x: "3", y: "3", width: "18", height: "18", rx: "3" }), /* @__PURE__ */ React.createElement("circle", { cx: "8", cy: "8", r: "1" }), /* @__PURE__ */ React.createElement("path", { d: "m3 17 6-6 4 4 3-3 5 5" })) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M4 6h16M4 12h16M4 18h16" }), /* @__PURE__ */ React.createElement("path", { d: "M8 3v6m8 0v6m-8 0v6" })));
function Controls({ node, providers, provider, change, settingsKey }) {
  return /* @__PURE__ */ React.createElement("div", { className: "studio-config-controls", onPointerDown: stop }, /* @__PURE__ */ React.createElement("select", { "aria-label": node.title + " 图片服务", value: node.provider || "", onChange: (event) => change({ provider: event.target.value }) }, /* @__PURE__ */ React.createElement("option", { value: "" }, providers[0]?.model || "图片服务不可用"), providers.map((item) => /* @__PURE__ */ React.createElement("option", { key: item.id, value: item.id }, item.model || item.label)), node.provider && !provider && /* @__PURE__ */ React.createElement("option", { value: node.provider }, node.provider, "（不可用）")), /* @__PURE__ */ React.createElement("details", { className: "studio-config-settings", key: settingsKey }, /* @__PURE__ */ React.createElement("summary", { "aria-label": node.title + " 生成设置" }, icon("settings"), " ", node.ratio, " · ", node.resolution), /* @__PURE__ */ React.createElement("div", { className: "studio-config-settings-popover" }, [["ratio", "比例", provider?.ratios], ["resolution", "分辨率", provider?.resolutions]].map(([key, label, values]) => /* @__PURE__ */ React.createElement("label", { key }, label, /* @__PURE__ */ React.createElement("select", { "aria-label": node.title + " " + label, value: node[key], onChange: (event) => change({ [key]: event.target.value }) }, [.../* @__PURE__ */ new Set([node[key], ...values || []])].filter(Boolean).map((value) => /* @__PURE__ */ React.createElement("option", { key: value, value }, value))))))));
}
function Run({ busy, canGenerate, run, compact }) {
  return /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      className: "studio-config-run" + (compact ? " compact" : ""),
      "aria-label": busy ? "停止生成" : "生成图片",
      disabled: !busy && !canGenerate,
      onPointerDown: (event) => event.preventDefault(),
      onClick: run
    },
    busy ? "■" : icon(compact ? "up" : "play"),
    (!compact || busy) && (busy ? "停止生成" : "生成")
  );
}
function ConfigPanel(props) {
  const { incoming, togglePanel, status } = props;
  return /* @__PURE__ */ React.createElement("div", { className: "studio-config-content flex h-full w-full cursor-move flex-col px-3 pb-3 pt-7 text-sm", onWheel: stop }, /* @__PURE__ */ React.createElement("div", { className: "mb-2 flex items-center justify-between gap-3" }, /* @__PURE__ */ React.createElement("strong", null, "生成配置"), /* @__PURE__ */ React.createElement("span", { className: "studio-config-mode" }, icon("image"), " 生图")), /* @__PURE__ */ React.createElement("div", { className: "mb-2 flex flex-wrap gap-1.5" }, /* @__PURE__ */ React.createElement("span", { className: "studio-config-chip" }, "提示词 ", incoming.filter((item) => item.from.type === "text").length, " 条"), /* @__PURE__ */ React.createElement("span", { className: "studio-config-chip" }, "参考图 ", incoming.filter((item) => item.from.type === "image").length, " 张"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "studio-config-chip", onClick: togglePanel }, icon("settings"), " 编排")), /* @__PURE__ */ React.createElement(Controls, { ...props }), /* @__PURE__ */ React.createElement("div", { className: "studio-config-status", role: "status", title: status }, status), /* @__PURE__ */ React.createElement(Run, { ...props }));
}
function PromptPanel(props) {
  const { incoming, editor, reorder, disconnect, imageUrl, togglePanel } = props;
  return /* @__PURE__ */ React.createElement("div", { "data-canvas-no-zoom": true, className: "studio-prompt-panel rounded-2xl border p-3 shadow-2xl backdrop-blur", onMouseDown: stop, onPointerDown: stop, onWheel: stop }, /* @__PURE__ */ React.createElement("div", { className: "studio-reference-bar" }, incoming.length === 0 && /* @__PURE__ */ React.createElement("span", null, "连接文字或图片，作为生成参考"), incoming.map(({ edge, from }, index) => /* @__PURE__ */ React.createElement("div", { key: edge.id, className: "studio-reference", title: from.title }, from.type === "image" ? /* @__PURE__ */ React.createElement("img", { src: imageUrl(from.assetId), alt: from.title }) : /* @__PURE__ */ React.createElement("span", { className: "studio-reference-text" }, from.text || "T"), /* @__PURE__ */ React.createElement("small", null, index + 1, ". ", from.title), /* @__PURE__ */ React.createElement("button", { "aria-label": "前移参考：" + from.title, disabled: index === 0, onClick: () => reorder(index) }, "↑"), /* @__PURE__ */ React.createElement("button", { "aria-label": "断开参考：" + from.title, onClick: () => disconnect(edge.id) }, "×")))), editor("prompt", { className: "studio-prompt-input", placeholder: "描述你想生成的画面…" }), /* @__PURE__ */ React.createElement("div", { className: "mt-2 flex min-w-0 items-center justify-between gap-2" }, /* @__PURE__ */ React.createElement(Controls, { ...props }), /* @__PURE__ */ React.createElement(Run, { ...props, compact: true })), /* @__PURE__ */ React.createElement("button", { className: "studio-prompt-close", "aria-label": "收起提示词", onClick: togglePanel }, "×"));
}
export {
  ConfigPanel,
  PromptPanel
};
