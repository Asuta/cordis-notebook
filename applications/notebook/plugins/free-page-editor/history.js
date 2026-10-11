/** @template T @param {number} limit */
export function createHistory(limit = 80) {
  /** @type {T[]} */
  const undo = []
  /** @type {T[]} */
  const redo = []
  /** @type {string|null} */
  let group = null
  return {
    get canUndo() { return !!undo.length },
    get canRedo() { return !!redo.length },
    breakGroup() { group = null },
    /** @param {T} before @param {string|null} key */
    record(before, key = null) {
      if (!key || group !== key) { undo.push(structuredClone(before)); if (undo.length > limit) undo.shift() }
      group = key; redo.length = 0
    },
    /** @param {T} current */
    undo(current) { if (!undo.length) return null; redo.push(structuredClone(current)); group = null; return undo.pop() },
    /** @param {T} current */
    redo(current) { if (!redo.length) return null; undo.push(structuredClone(current)); group = null; return redo.pop() },
  }
}
