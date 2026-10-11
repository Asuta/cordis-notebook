/** @template T @param {T[]|undefined} first @param {T[]|undefined} second @param {(value:T)=>string|number} key @param {boolean} preferFirst */
const merge = (first = [], second = [], key, preferFirst = false) => {
  const values = new Map(first.map(value => [key(value), value]))
  for (const value of second) if (!preferFirst || !values.has(key(value))) values.set(key(value), value)
  return [...values.values()]
}
/** @param {import('../conversation-types').Message} message */
const messageKey = message => message.id || [message.turnId, message.messageId, message.role, message.text].join(':')

/** Merge summaries, paged history and SSE without discarding previously loaded turns.
 * @param {import('../conversation-types').PublicThread | undefined} previous
 * @param {import('../conversation-types').PublicThread} incoming
 * @param {{older?:boolean, detail?:boolean}} options
 * @returns {import('../conversation-types').PublicThread}
 */
export function mergeThread(previous, incoming, { older = false, detail = false } = {}) {
  if (!previous) return { ...incoming, ...(detail ? { detailRevision: incoming.revision } : {}) }
  const stale = (incoming.revision || 0) < (previous.revision || 0)
  const result = stale ? { ...incoming, ...previous } : { ...previous, ...incoming }
  if (incoming.messages) {
    const gap = !older && incoming.history && previous.history && incoming.history.before > previous.history.end
    const first = gap ? { id: incoming.id } : previous
    // Page position determines order; revision separately determines overlapping content.
    const prepend = incoming.history && first.history ? incoming.history.before < first.history.before : older
    const a = prepend ? incoming : first, b = prepend ? first : incoming
    const preferFirst = prepend ? !stale : stale
    result.messages = merge(a.messages, b.messages, messageKey, preferFirst)
    result.turns = merge(a.turns, b.turns, turn => turn.id, preferFirst)
    result.commands = merge(a.commands, b.commands, command => command.session_id, preferFirst)
    if (incoming.history) result.history = { before: gap ? incoming.history.before : Math.min(previous.history?.before ?? incoming.history.before, incoming.history.before),
      end: Math.max(previous.history?.end || 0, incoming.history.end), total: Math.max(previous.history?.total || 0, incoming.history.total) }
    if (detail && !older && !stale) result.detailRevision = incoming.revision
  }
  return result
}
