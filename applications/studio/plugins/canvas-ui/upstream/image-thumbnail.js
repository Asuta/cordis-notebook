// Adapted from basketikun/infinite-canvas@3a6b64b (MIT). See LICENSE and ../../../INFINITE-CANVAS.md.
const CANVAS_IMAGE_PREVIEW_MAX_EDGE = 768;
function pickImageSource({ previewUrl, originalUrl, naturalWidth, naturalHeight, renderedWidth, renderedHeight, scale, devicePixelRatio = globalThis.devicePixelRatio || 1, previewMaxEdge = CANVAS_IMAGE_PREVIEW_MAX_EDGE }) {
  if (!previewUrl) return originalUrl;
  const naturalLongEdge = Math.max(naturalWidth || 0, naturalHeight || 0);
  const previewLongEdge = naturalLongEdge > 0 ? Math.min(previewMaxEdge, naturalLongEdge) : previewMaxEdge;
  const requiredLongEdge = Math.max(renderedWidth, renderedHeight) * scale * devicePixelRatio;
  return requiredLongEdge > previewLongEdge ? originalUrl : previewUrl;
}
export {
  CANVAS_IMAGE_PREVIEW_MAX_EDGE,
  pickImageSource
};
