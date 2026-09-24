// Missing type belongs to the original plain-text storage format.
export const noteType = note => note?.type || 'plain'
export function snapshotNote(note) {
  if (note === undefined) return undefined
  const freeze = value => {
    if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value) }
    return value
  }
  return freeze(structuredClone(note))
}
