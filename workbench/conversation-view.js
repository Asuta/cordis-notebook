/** Public metadata excludes traces, credentials and session paths. @param {import('./conversation-types').Conversation} item */
export function threadSummary(item) {
  return { id: item.id, appId: item.appId, title: item.title, revision: item.revision || 0,
    browserVerificationEnabled: item.browserVerificationEnabled === true, contextUsage: item.contextUsage,
    hasImages: !!item.hasImages, canCompact: !!item.sessionFile, running: !!item.running,
    messageCount: item.messages.length, turnCount: (item.turns || []).length }
}

// Page by complete turns, so a tool trace is never detached from its user message.
// Older pre-turn records each occupy one slot. Cursors are stable while appending.
/** @param {import('./conversation-types').Conversation} item
 * @param {{before?:number|string, limit?:number|string, since?:number|string}} options
 * @returns {import('./conversation-types').PublicThread}
 */
export function threadPage(item, { before, limit = 20, since } = {}) {
  const summary = threadSummary(item)
  if (before === undefined && since !== undefined && Number(since) === summary.revision) return { id: item.id, revision: summary.revision, unchanged: true }
  if (!Number.isInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 100) throw Object.assign(Error('每页需为 1–100 轮'), { status: 400 })
  const turns = item.turns || [], known = new Set(turns.map(turn => turn.id))
  const legacy = item.messages.filter(message => !message.turnId || !known.has(message.turnId))
    .map((message, index) => ({ ...message, id: message.id || 'legacy-' + index }))
  const total = legacy.length + turns.length, end = before === undefined ? total : Number(before)
  if (!Number.isInteger(end) || end < 0 || end > total) throw Object.assign(Error('历史游标无效'), { status: 400 })
  const start = Math.max(0, end - Number(limit)), selected = turns.slice(Math.max(0, start - legacy.length), Math.max(0, end - legacy.length))
  const ids = new Set(selected.map(turn => turn.id))
  return { ...summary, turns: selected,
    messages: [...legacy.slice(start, Math.min(end, legacy.length)), ...item.messages.filter(message => message.turnId && ids.has(message.turnId))],
    commands: (item.commands || []).filter(command => command.turnId && ids.has(command.turnId)), history: { before: start, end, total } }
}
