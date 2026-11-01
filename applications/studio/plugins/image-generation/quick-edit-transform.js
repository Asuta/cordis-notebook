export function normalizedAngle(angle) {
  const value = Number(angle)
  if (!Number.isFinite(value)) return 0
  const wrapped = ((value % 360) + 360) % 360
  return Math.abs(wrapped - 360) < 1e-9 ? 0 : wrapped
}

export function rotatedSize(width, height, angle) {
  const radians = normalizedAngle(angle) * Math.PI / 180
  const cos = Math.abs(Math.cos(radians)), sin = Math.abs(Math.sin(radians))
  return {
    width: Math.max(1, Math.ceil(width * cos + height * sin - 1e-6)),
    height: Math.max(1, Math.ceil(width * sin + height * cos - 1e-6)),
  }
}

export function workspaceToSource(x, y, { width, height, sourceWidth, sourceHeight, angle, mirrored = false }) {
  const pointX = mirrored ? width - x : x
  const radians = normalizedAngle(angle) * Math.PI / 180
  const cos = Math.cos(radians), sin = Math.sin(radians)
  const dx = pointX - width / 2, dy = y - height / 2
  return {
    x: sourceWidth / 2 + dx * cos + dy * sin,
    y: sourceHeight / 2 - dx * sin + dy * cos,
  }
}

export function clampCrop(rect, width, height) {
  if (!rect) return null
  const rawX = Number(rect.x) || 0, rawY = Number(rect.y) || 0
  const rawW = Math.max(0, Number(rect.w) || 0), rawH = Math.max(0, Number(rect.h) || 0)
  const left = Math.max(0, Math.min(width, rawX))
  const top = Math.max(0, Math.min(height, rawY))
  const right = Math.max(0, Math.min(width, rawX + rawW))
  const bottom = Math.max(0, Math.min(height, rawY + rawH))
  const x = Math.max(0, Math.min(Math.max(0, width - 1), Math.round(left)))
  const y = Math.max(0, Math.min(Math.max(0, height - 1), Math.round(top)))
  const w = Math.max(0, Math.min(width - x, Math.round(right - left)))
  const h = Math.max(0, Math.min(height - y, Math.round(bottom - top)))
  return w >= 2 && h >= 2 ? { x, y, w, h } : null
}
