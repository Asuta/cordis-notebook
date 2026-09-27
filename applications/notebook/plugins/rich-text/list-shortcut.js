const period = event => ['Period', 'NumpadDecimal'].includes(event.code) ||
  ['.', '。', '．', 'Decimal'].includes(event.key) || [190, 110].includes(event.keyCode)
const modified = event => !event.shiftKey && ((event.altKey && !event.ctrlKey && !event.metaKey) ||
  ((event.ctrlKey || event.metaKey) && !event.altKey))

// IMEs may hide or rewrite keydown, while keyup still identifies the physical
// key. Handle either event once, never replace normal composition or plain '.'.
export function createListShortcut({ toggle, composing, editable }) {
  let down = null
  const consume = event => { event.preventDefault(); event.stopPropagation(); return true }
  return {
    reset() { down = null },
    keydown(event) {
      const chord = modified(event), isPeriod = period(event)
      if (!isPeriod && !(chord && (event.key === 'Process' || event.keyCode === 229))) {
        if (!['Control', 'Alt', 'Meta', 'Shift'].includes(event.key)) down = null
        return false
      }
      const blocked = event.isComposing || composing() || !editable()
      down = { chord, blocked, handled: false }
      if (!chord || !isPeriod || blocked) return false
      down.handled = true
      if (!event.repeat) toggle()
      return consume(event)
    },
    keyup(event) {
      if (!period(event)) return false
      const previous = down
      down = null
      if (previous?.handled) return consume(event)
      if (!(modified(event) || previous?.chord) || previous?.blocked ||
          event.isComposing || composing() || !editable()) return false
      toggle()
      return consume(event)
    },
  }
}
