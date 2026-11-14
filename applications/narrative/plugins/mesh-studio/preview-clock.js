/** Keep fractional frame time: Mesh Avatar advance() rounds each call to whole 60 Hz steps. */
export function createPreviewStepper(avatar) {
  let pending = 0
  return elapsed => {
    pending += Math.max(0, Math.min(.05, elapsed))
    const steps = Math.floor(pending * 60 + 1e-9)
    if (!steps) return
    avatar.advance(steps / 60)
    pending = Math.max(0, pending - steps / 60)
  }
}
