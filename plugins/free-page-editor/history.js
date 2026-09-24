export function createHistory(limit = 80) {
  const undo = [], redo = []
  let group = null
  return {
    get canUndo() { return !!undo.length },
    get canRedo() { return !!redo.length },
    breakGroup() { group = null },
    record(before, key = null) {
      if (!key || group !== key) { undo.push(structuredClone(before)); if (undo.length > limit) undo.shift() }
      group = key; redo.length = 0
    },
    undo(current) { if (!undo.length) return null; redo.push(structuredClone(current)); group = null; return undo.pop() },
    redo(current) { if (!redo.length) return null; undo.push(structuredClone(current)); group = null; return redo.pop() },
  }
}
