/** 专注计时器的纯状态逻辑：不触碰 DOM，便于独立测试。 */

export const FOCUS_DURATION_MS = 25 * 60 * 1000
export const FINISH_MESSAGE = '本轮专注结束，休息一下吧。'

export function createTimer(duration = FOCUS_DURATION_MS) {
  return { status: 'idle', duration, remainingMs: duration, endsAt: 0 }
}

/** 运行中按结束时间计算，暂停或待机时沿用已保存的剩余时间。 */
export function remainingMsOf(timer, now) {
  return timer.status === 'running' ? Math.max(0, timer.endsAt - now) : timer.remainingMs
}

export function startTimer(timer, now) {
  if (timer.status === 'running') return timer
  // 结束后再开始视为新的一轮；暂停后继续沿用剩余时间。
  const remaining = timer.status === 'paused' && timer.remainingMs > 0 ? timer.remainingMs : timer.duration
  return { ...timer, status: 'running', remainingMs: remaining, endsAt: now + remaining }
}

export function pauseTimer(timer, now) {
  if (timer.status !== 'running') return timer
  return { ...timer, status: 'paused', remainingMs: remainingMsOf(timer, now), endsAt: 0 }
}

export function resetTimer(timer) {
  return { ...timer, status: 'idle', remainingMs: timer.duration, endsAt: 0 }
}

/** 返回校正后的状态；finished 只在本轮首次走完时为 true。 */
export function syncTimer(timer, now) {
  if (timer.status !== 'running') return { timer, finished: false }
  const remaining = timer.endsAt - now
  if (remaining > 0) return { timer: { ...timer, remainingMs: remaining }, finished: false }
  return { timer: { ...timer, status: 'finished', remainingMs: 0, endsAt: 0 }, finished: true }
}

/** 秒数向上取整，倒计时从整分开始显示且不会出现负数。 */
export function formatDuration(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60), seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function actionLabel(status) {
  return status === 'running' ? '暂停' : status === 'paused' ? '继续' : '开始'
}
